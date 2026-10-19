import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_progress_parser.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';

/// Where the pipeline's shared-state download stands right now.
enum PipelineWarmupStatus {
  /// No local pipeline to warm — web, or a phone. Nothing to show.
  unavailable,

  /// Nothing has been tried yet this session.
  idle,

  /// A `search.py --pull-only` is in flight.
  running,

  /// A pull finished. [PipelineWarmupState.completedAt] says when, which is
  /// what decides whether a search still has to do one itself.
  ready,

  /// The last attempt failed. Not fatal, and deliberately not loud: the
  /// search still runs, it just pays for the pull itself the way it always
  /// did.
  failed,
}

/// How long a completed pull counts as fresh enough for a search to skip its
/// own. Must match `DEFAULT_PULL_MAX_AGE_SECONDS` in `pipeline/search.py`,
/// which is the side that actually enforces it — this copy only decides what
/// the search page says.
const pipelineWarmupFreshness = Duration(minutes: 15);

class PipelineWarmupState {
  const PipelineWarmupState({
    required this.status,
    this.completedAt,
    this.error,
    this.step,
  });

  final PipelineWarmupStatus status;

  /// What the running pull last said it was doing (`[step]` / `[sync-io]`
  /// lines, see `search_progress_parser.dart`), or null when it has said
  /// nothing yet or is not running. A routine pull says nothing and is over
  /// in seconds; a machine's first sync moves thousands of objects and this
  /// is how that reads as progress rather than a stuck spinner.
  final String? step;

  /// When the last *successful* pull finished, or null if none has this
  /// session. A pull done by a previous session (or by a search) still counts
  /// on the Python side — `search.py` reads its own stamp out of
  /// `gratovo.db` — so a null here means "this app session doesn't know",
  /// not "the data is definitely stale".
  final DateTime? completedAt;

  /// The tail of what the failed attempt printed, for the tooltip.
  final String? error;

  bool get isRunning => status == PipelineWarmupStatus.running;

  bool get isFresh {
    final at = completedAt;
    return at != null &&
        DateTime.now().difference(at) < pipelineWarmupFreshness;
  }

  /// How long ago the last successful pull finished, or null if there wasn't
  /// one this session.
  Duration? get age {
    final at = completedAt;
    return at == null ? null : DateTime.now().difference(at);
  }

  PipelineWarmupState copyWith({
    PipelineWarmupStatus? status,
    DateTime? completedAt,
    String? error,
    bool clearError = false,
    String? step,
    bool clearStep = false,
  }) {
    return PipelineWarmupState(
      status: status ?? this.status,
      completedAt: completedAt ?? this.completedAt,
      error: clearError ? null : (error ?? this.error),
      step: clearStep ? null : (step ?? this.step),
    );
  }
}

/// Pulls the team's shared catalog into the local database *ahead* of a
/// search, in the background, so pressing Start starts searching.
///
/// `search.py` begins every run by applying the R2 catalog segments it has
/// not seen and downloading the objects they name (`--pull-only` does the
/// same on its own). That is what lets a run skip channels a teammate has
/// already found and scraped. Done here — shortly after the app opens and
/// again when the search page is opened, at a moment when nobody is waiting
/// on it — a run finds a recent pull already done and skips its own.
///
/// The sync engine runs the same pull on its tick (`mirror_engine_io.dart`),
/// and the pipeline's own freshness window means the two never do the work
/// twice: whichever runs second sees a recent stamp and returns at once.
///
/// A search waits on this in exactly one case — a pull already in flight, see
/// [waitForInFlight]. If it never finishes, or never runs at all, every search
/// still works; it pulls for itself, which is seconds.
///
/// Everything here is best-effort. A machine with no Python, no R2 keys in
/// `data/.env`, or no network simply fails the warm-up and the search behaves
/// exactly as it did before this existed — which is why nothing in the app
/// blocks on it, and why the search page reports it as a small line rather
/// than an error.
class PipelineWarmupNotifier extends Notifier<PipelineWarmupState> {
  /// How long to wait after the app opens before starting the pull.
  ///
  /// Two reasons, and the second is the one that matters. It keeps a
  /// subprocess launch off the first-frame path, where the mirror is already
  /// opening and syncing; and [pythonEnvironmentProvider] loads the
  /// interpreter path and project-root override from `SharedPreferences`
  /// asynchronously, so warming instantly could launch the default `python`
  /// on a machine whose Settings name a different one. Getting that wrong is
  /// not harmful — the warm-up just fails and the search pulls for itself —
  /// but it would fail for no reason on exactly the machines that were
  /// configured most carefully.
  static const _startupDelay = Duration(seconds: 2);

  /// The in-flight pull, so a second caller waits for the first rather than
  /// launching a second interpreter against the same database.
  Future<void>? _inFlight;

  /// The pending [warmInBackground] delay, held so it can be cancelled. A
  /// timer that outlives the provider would launch a subprocess for an app
  /// that is closing, and in a widget test it is an outright failure.
  Timer? _pending;

  /// Set once the provider is gone, so a pull that is still running when the
  /// app closes does not try to write state that no longer exists.
  bool _disposed = false;

  @override
  PipelineWarmupState build() {
    final canRun = ref.read(capabilitiesProvider).canRunSearch;
    ref.onDispose(() {
      _disposed = true;
      _pending?.cancel();
    });
    return PipelineWarmupState(
      status:
          canRun ? PipelineWarmupStatus.idle : PipelineWarmupStatus.unavailable,
    );
  }

  /// Called once as the app starts and again whenever the search page opens.
  /// Does nothing if a pull is already running or a recent one already
  /// landed, so it is safe to call from a `build`.
  void warmInBackground({Duration delay = _startupDelay}) {
    if (state.status == PipelineWarmupStatus.unavailable) return;
    if (state.isRunning || state.isFresh || _searchIsRunning) return;
    _pending?.cancel();
    _pending = Timer(delay, () {
      _pending = null;
      // Re-checked after the delay: a search (or the search page) may have
      // pulled while we were waiting -- and, crucially, a search may have
      // *started*. See [_searchIsRunning].
      if (_disposed || state.isRunning || state.isFresh || _searchIsRunning) {
        return;
      }
      unawaited(refresh());
    });
  }

  /// Whether a search process is going right now, in which case there is
  /// nothing to warm and a great deal to break.
  ///
  /// This is the second half of the guard in
  /// `ActiveSearchRunNotifier.startSearch`, and the half whose absence was a
  /// real failure rather than a theoretical one. That method waits for a pull
  /// that is *already in flight*; it cannot wait for one that is merely
  /// scheduled. On an app launch that auto-resumes an interrupted run, the
  /// delay above was still counting down when the run started -- so the run
  /// saw no pull in flight and did not wait, and the timer then fired and
  /// launched a second interpreter into the running search. Both wrote
  /// `gratovo.db` in the same second and the run died on its first statement:
  ///
  ///     sqlite3.OperationalError: database is locked
  ///
  /// A pull skipped here costs nothing: the run pulls for itself, and this is
  /// best-effort by design.
  bool get _searchIsRunning {
    try {
      return ref.read(activeSearchRunControllerProvider.notifier).isRunning;
    } catch (_) {
      // The controller is not available (a test container, a disposed
      // container). Not a reason to refuse a warm-up.
      return false;
    }
  }

  /// Runs the pull and completes when it has finished, successfully or not.
  ///
  /// [force] is the "Refresh now" path: somebody asking for it explicitly
  /// means it, so it passes `--force-pull` and ignores the freshness window
  /// on the Python side too.
  Future<void> refresh({bool force = false}) {
    if (state.status == PipelineWarmupStatus.unavailable) {
      return Future<void>.value();
    }
    // Including the explicit "Refresh now" press: the run is already pulling
    // (or has just pulled) into the same file, and a second writer against it
    // is what "database is locked" is made of. Joining an in-flight pull below
    // is fine; starting a fresh one underneath a run is not.
    if (_inFlight == null && _searchIsRunning) return Future<void>.value();
    // A forced refresh still joins an in-flight one rather than racing it:
    // the pull already running is downloading the same rows.
    return _inFlight ??= _run(force: force).whenComplete(() {
      _inFlight = null;
    });
  }

  /// What the Start button waits on, and only when a pull is already in
  /// flight: letting it finish is cheaper than racing it, and it means the run
  /// finds the freshness stamp already written and skips its own pull. Returns
  /// straight away otherwise — a stale or failed warm-up is not worth delaying
  /// a run for, because `search.py` pulls for itself in that case.
  Future<void> waitForInFlight() => _inFlight ?? Future<void>.value();

  Future<void> _run({required bool force}) async {
    if (_disposed) return;
    final env = ref.read(pythonEnvironmentProvider);
    final override = env.projectRootOverride.trim();
    final paths = ScraperProcess.resolvePaths(
      projectRootOverride: override.isEmpty ? null : override,
    );
    if (paths == null) {
      state = state.copyWith(status: PipelineWarmupStatus.unavailable);
      return;
    }

    state = state.copyWith(
      status: PipelineWarmupStatus.running,
      clearError: true,
      clearStep: true,
    );
    try {
      final result = await ScraperProcess.pullSharedState(
        pythonExecutable: env.pythonExecutable,
        paths: paths,
        force: force,
        onLine: (line) {
          if (_disposed || !state.isRunning) return;
          if (parseSearchProgressLine(line) case StepReported(:final step)) {
            state = state.copyWith(step: step);
          }
        },
      );
      if (_disposed) return;
      if (result.succeeded) {
        state = state.copyWith(
          status: PipelineWarmupStatus.ready,
          completedAt: DateTime.now(),
          clearError: true,
          clearStep: true,
        );
        return;
      }
      state = state.copyWith(
        status: PipelineWarmupStatus.failed,
        error: _tail(result.output),
        clearStep: true,
      );
    } catch (error, stackTrace) {
      // Deliberately broad, and deliberately quiet. A missing interpreter, an
      // unreadable pipeline folder and a dead network all mean the same thing
      // here: no head start this time. The search still works.
      developer.log(
        'Background shared-state pull failed; the next search will do its own.',
        name: 'gratovo.pipeline.warmup',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
      if (_disposed) return;
      state = state.copyWith(
        status: PipelineWarmupStatus.failed,
        error: '$error',
        clearStep: true,
      );
    }
  }

  /// The last few lines of the process output — what a failure actually says
  /// is at the end, and the whole of a pull's output does not belong in a
  /// tooltip.
  static String _tail(String output, {int lines = 3}) {
    final trimmed = output.trim();
    if (trimmed.isEmpty) return 'The pull exited without saying why.';
    final split = trimmed.split('\n');
    return split.length <= lines
        ? trimmed
        : split.sublist(split.length - lines).join('\n');
  }
}

final pipelineWarmupProvider =
    NotifierProvider<PipelineWarmupNotifier, PipelineWarmupState>(
  PipelineWarmupNotifier.new,
);
