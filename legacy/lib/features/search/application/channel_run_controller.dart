import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/core/sync/sync_providers.dart';
import 'package:gratovo_toolbox/data/models/channel_run.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/pipeline_warmup_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_progress_parser.dart';
import 'package:gratovo_toolbox/features/search/application/video_catchup_controller.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';

/// What every single-channel pipeline job shares: launching one interpreter
/// against the local pipeline, tailing its stdout into a bounded log, parsing
/// the `[step]` lines out of it, and turning the exit code into a finished
/// [ChannelRun]. `BackfillRunNotifier` and `ReenrichRunNotifier` are this
/// plus what each launches and what each does when it is over.
///
/// Deliberately global rather than owned by the widget that starts it: a run
/// can walk several paced, HTML-scraped pages before it ever reaches the
/// API-quota part, so it is usually still going after the person has
/// navigated away from the profile or the archive row it was started from.
/// Its progress is shown on the Search page (`ChannelRunProgressPanel`)
/// precisely so it survives that navigation, and
/// `pipeline_badge_controller.dart` surfaces it on the nav icon so leaving
/// the page does not mean losing track of it.
abstract class ChannelRunNotifier extends Notifier<ChannelRun?> {
  /// Same reasoning as [ActiveSearchRunNotifier._maxLogLines]: one channel
  /// can still print a few hundred lines, and nobody scrolls back through
  /// them — only the tail says whether it is still going.
  static const _maxLogLines = 400;

  static const _flushInterval = Duration(milliseconds: 150);

  Timer? _flushTimer;
  StreamSubscription<String>? _stdoutSub;

  final List<String> _pendingLines = [];
  String? _pendingStep;
  int? _pendingVideosAdded;

  /// `  backfill : saved 12 video(s) across 1 channel(s) (cutoff 2026-03-01)`
  /// -- enrich.py's own summary line, printed once at the very end. Matched
  /// loosely (leading whitespace, trailing text) rather than reproducing the
  /// whole line, since only the count is ever displayed.
  static final _savedPattern = RegExp(r'saved ([\d,]+) video');

  @override
  ChannelRun? build() {
    ref.onDispose(() {
      _flushTimer?.cancel();
      _stdoutSub?.cancel();
    });
    return null;
  }

  bool get isRunning => state?.status == ChannelRunStatus.running;

  /// Called once per run, whether it finished on its own or never started.
  /// The subclass decides what the run leaves behind: an activity-log entry,
  /// which data domains to bump.
  @protected
  void didFinish(ChannelRun run, {required bool succeeded});

  /// Runs one job to completion in the background.
  ///
  /// Throws [StateError] if any pipeline job that shares `gratovo.db` and the
  /// YouTube quota is already in flight — two interpreters writing the same
  /// rows would split a budget neither would then honour. [otherJobRunning]
  /// is the sibling single-channel job; a search someone is actively
  /// watching is checked here for both. Unlike the background video catch-up
  /// (which gets told to stop), neither is something this can safely
  /// interrupt on its own — the person who started it decides.
  @protected
  Future<void> launch({
    required ChannelRunKind kind,
    required String handle,
    int? months,
    required bool otherJobRunning,
    required Future<PipelineLaunchResult> Function(
      String pythonExecutable,
      ScraperProcessPaths paths,
    ) start,
  }) async {
    if (isRunning) {
      throw StateError('A ${kind.name} is already running.');
    }
    if (ref.read(activeSearchRunControllerProvider.notifier).isRunning) {
      throw StateError('A search is currently running.');
    }
    if (otherJobRunning) {
      throw StateError('Another channel job is currently running.');
    }

    final pythonEnv = ref.read(pythonEnvironmentProvider);
    final paths = ScraperProcess.resolvePaths(
      projectRootOverride: pythonEnv.projectRootOverride.trim().isEmpty
          ? null
          : pythonEnv.projectRootOverride.trim(),
    );
    if (paths == null) {
      throw StateError(
        'No local pipeline install could be resolved on this platform.',
      );
    }

    _resetBuffers();
    _flushTimer?.cancel();
    unawaited(_stdoutSub?.cancel() ?? Future<void>.value());

    state = ChannelRun(
      id: '${kind.name}-${DateTime.now().millisecondsSinceEpoch}',
      kind: kind,
      handle: handle,
      months: months,
      startedAt: DateTime.now(),
      status: ChannelRunStatus.running,
      currentStep: 'Starting…',
    );

    // Same two courtesies `ActiveSearchRunNotifier.startSearch` pays before
    // it launches: wait out a shared-state pull already in flight (racing it
    // is a `database is locked` crash waiting to happen), and tell the
    // lowest-priority background job to get out of the way rather than
    // compete for the same file.
    if (ref.read(pipelineWarmupProvider).isRunning) {
      state = state?.copyWith(currentStep: 'Fetching shared data...');
      await ref.read(pipelineWarmupProvider.notifier).waitForInFlight();
      state = state?.copyWith(currentStep: 'Starting…');
    }
    if (ref.read(videoCatchUpControllerProvider.notifier).isRunning) {
      await ref.read(videoCatchUpControllerProvider.notifier).stopAndWait();
    }

    final PipelineLaunchResult launch;
    try {
      launch = await start(pythonEnv.pythonExecutable, paths);
    } catch (error) {
      _failLaunch(kind, error);
      rethrow;
    }

    _stdoutSub = launch.stdoutLines.listen(
      _appendLine,
      onError: (Object error) => _appendLine('[app] log output error: $error'),
    );

    unawaited(
      launch.exitCode.then((code) {
        _flush();
        final current = state;
        if (current == null) return;
        final succeeded = code == 0;
        final finished = current.copyWith(
          status:
              succeeded ? ChannelRunStatus.completed : ChannelRunStatus.failed,
          finishedAt: DateTime.now(),
          clearCurrentStep: true,
        );
        state = finished;
        if (succeeded) {
          // The pipeline pushes what it saved to Supabase before it exits,
          // but the app's own screens read the local mirror, not Supabase
          // directly -- a mirror nothing asks to catch up stays exactly as
          // stale as it was before the run, however many videos actually
          // landed on the server. `search_screen.dart` does the same thing
          // when a search run finishes; `mirrorChangeAnnouncerProvider`
          // (app_shell.dart) is what turns "the mirror pulled something"
          // into the domain bump the subclass asks for, once the pull this
          // triggers actually lands.
          ref.read(mirrorCatchUpProvider).request();
        }
        didFinish(finished, succeeded: succeeded);
      }),
    );
  }

  /// Bumps [domains] so screens re-read the mirror. For [didFinish].
  @protected
  void bump(Set<DataDomain> domains) => ref.bumpData(domains);

  void _failLaunch(ChannelRunKind kind, Object error) {
    _flushTimer?.cancel();
    _resetBuffers();
    final current = state;
    if (current == null) return;
    final failed = current.copyWith(
      status: ChannelRunStatus.failed,
      finishedAt: DateTime.now(),
      logLines: [
        ...current.logLines,
        '[app] could not start the ${kind.name}: $error',
      ],
      clearCurrentStep: true,
    );
    state = failed;
    didFinish(failed, succeeded: false);
  }

  void _resetBuffers() {
    _pendingLines.clear();
    _pendingStep = null;
    _pendingVideosAdded = null;
  }

  void _appendLine(String line) {
    _pendingLines.add(line);
    if (_pendingLines.length > _maxLogLines) {
      _pendingLines.removeRange(0, _pendingLines.length - _maxLogLines);
    }

    if (parseSearchProgressLine(line) case StepReported(:final step)) {
      _pendingStep = step;
    }
    final savedMatch = _savedPattern.firstMatch(line);
    if (savedMatch != null) {
      _pendingVideosAdded =
          int.tryParse(savedMatch.group(1)!.replaceAll(',', ''));
    }

    _flushTimer ??= Timer(_flushInterval, _flush);
  }

  void _flush() {
    _flushTimer?.cancel();
    _flushTimer = null;
    final current = state;
    if (current == null) {
      _resetBuffers();
      return;
    }
    if (_pendingLines.isEmpty &&
        _pendingStep == null &&
        _pendingVideosAdded == null) {
      return;
    }

    final merged = [...current.logLines, ..._pendingLines];
    final step = _pendingStep;
    final videosAdded = _pendingVideosAdded;
    _resetBuffers();

    state = current.copyWith(
      logLines: merged.length > _maxLogLines
          ? merged.sublist(merged.length - _maxLogLines)
          : merged,
      currentStep: step,
      videosAdded: videosAdded,
    );
  }
}
