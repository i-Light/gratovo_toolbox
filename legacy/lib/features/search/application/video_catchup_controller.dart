import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/backfill_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/pipeline_warmup_controller.dart';
import 'package:gratovo_toolbox/features/search/application/reenrich_run_controller.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';

/// Where the automatic video-catch-up sweep stands right now.
enum VideoCatchUpStatus {
  /// No local pipeline to run this on — web, or a phone.
  unavailable,

  /// Nothing has been tried yet this session.
  idle,

  /// `search.py --catch-up-videos` is in flight.
  running,

  /// The last pass finished (whether or not it cleared the whole backlog).
  done,

  /// The pass was asked to step aside so a search, a backfill or a re-enrich
  /// could have the database, and did.
  ///
  /// Split out of [failed] because it is not one, and because it is the
  /// common case rather than the rare one: killing the process is exactly how
  /// [stopAndWait] works, so every search anyone starts ends the pass with a
  /// non-zero exit code. Reported as a failure it would say "something broke"
  /// every time somebody pressed Start.
  paused,

  /// The last attempt failed. Not fatal and deliberately quiet — a search
  /// still discovers new channels' videos itself; this only ever clears the
  /// backlog faster than that trickle would.
  failed,
}

/// What the sweep is doing, in enough detail to be worth showing.
///
/// Everything below [error] exists because this job was invisible. It runs
/// unattended for as long as an hour on a store with a real backlog, and the
/// only thing the app knew about it was that a subprocess was alive — so the
/// one place its existence leaked into the UI (the newest `runs` row, which
/// the Search page rendered as a search that had found nothing but videos)
/// was also the only place anybody could see it, and it said the wrong thing.
class VideoCatchUpState {
  const VideoCatchUpState({
    required this.status,
    this.error,
    this.startedAt,
    this.channelsDone = 0,
    this.backlogTotal,
    this.currentHandle,
    this.scannedInBatch = 0,
    this.fetchedInBatch = 0,
    this.sharedObjects,
    this.sharingTotal,
    this.sharingSince,
    this.spentSharing = Duration.zero,
  });

  final VideoCatchUpStatus status;

  /// The tail of what a failed attempt printed.
  final String? error;

  /// When the pass in [status] started, or null before the first one.
  final DateTime? startedAt;

  /// Channels whose uploads this pass has read, straight from the pipeline's
  /// own count (`[catchup] done=…`) rather than counted here — the pipeline is
  /// the side that knows a channel it touched but could not fetch is still
  /// finished with.
  final int channelsDone;

  /// How many channels the pass set out to work through: [channelsDone] plus
  /// what is still in the backlog, as of the last batch. Null until the first
  /// `[catchup]` line, and it can move — a search running alongside adds
  /// channels to the backlog as it discovers them.
  final int? backlogTotal;

  /// The handle whose uploads are being read this second.
  final String? currentHandle;

  /// Channels the *current* outer batch (`_CATCH_UP_BATCH_SIZE` of them) has
  /// read the upload list of so far — the first of the two per-channel
  /// sub-steps, from `[catchup-io] scanned=…`. Batch-local: it resets to zero
  /// each time a `[catchup] done=` line folds a finished batch into
  /// [channelsDone]. Zero until the first `[catchup-io]` line.
  final int scannedInBatch;

  /// Channels in the current outer batch whose uploads have not just been read
  /// but actually fetched from the YouTube API and saved — the second
  /// sub-step, from `[catchup-io] fetched=…`. Always ≤ [scannedInBatch]: the
  /// metadata fetch is batched across channels and lags the scrape. Resets
  /// with [scannedInBatch].
  final int fetchedInBatch;

  /// Objects the between-batch R2 share has handled so far, from
  /// `[sync-io] shared=…`, or null when the pass is not sharing. Paired with
  /// [sharingTotal].
  ///
  /// This phase exists on screen because it was once invisible, and the way
  /// it was invisible was the whole complaint: after every batch the sweep
  /// uploads what it finished, which is usually a few dozen objects and a
  /// few seconds — but the first share after an upgrade that reset the upload
  /// stamps is every channel the machine ever finished. Thousands. The panel
  /// sat on "Now reading @whoever" for twenty minutes, and nothing anywhere
  /// said that a different job was running and getting somewhere.
  final int? sharedObjects;

  /// How many objects the current share set out to upload. Null when the pass
  /// is not sharing.
  final int? sharingTotal;

  /// When the current share started, or null when the pass is not sharing.
  /// Together with [spentSharing], what lets the panel's rate and time-left
  /// count only the time spent actually reading channels.
  final DateTime? sharingSince;

  /// Time this pass has spent in finished share phases. Excluded from the
  /// panel's throughput estimate: 50 channels in one minute and then twenty
  /// minutes of upload is 50 channels/min, not 2.
  final Duration spentSharing;

  bool get isRunning => status == VideoCatchUpStatus.running;

  /// Whether the pass is currently uploading finished channels to the team
  /// store rather than reading uploads.
  bool get isSharing => sharingTotal != null;

  /// How long this pass has spent reading channels, as of [now] — the pass's
  /// age minus every share phase, finished or in progress.
  Duration readingElapsed(DateTime now) {
    final started = startedAt;
    if (started == null) return Duration.zero;
    var elapsed = now.difference(started) - spentSharing;
    final since = sharingSince;
    if (since != null) elapsed -= now.difference(since);
    return elapsed.isNegative ? Duration.zero : elapsed;
  }

  /// Channels whose upload list has been read so far this pass — the
  /// pipeline's own finished-batch count ([channelsDone]) plus the current
  /// batch's within-batch scan count, so it advances every channel rather
  /// than jumping once per outer batch the way [channelsDone] alone does.
  int get channelsRead => channelsDone + scannedInBatch;

  /// Channels whose videos have actually been fetched and saved so far this
  /// pass. The metadata fetch is batched across channels, so this trails
  /// [channelsRead] and is never ahead of it.
  int get channelsSaved => channelsDone + fetchedInBatch;

  /// Whether there is anything worth putting on screen. A session where this
  /// never ran (or cannot) has nothing to say and should take up no space.
  bool get hasProgressToShow =>
      status != VideoCatchUpStatus.unavailable &&
      status != VideoCatchUpStatus.idle &&
      startedAt != null;

  /// 0..1 for the solid, primary fill of the progress bar — channels whose
  /// videos have actually been fetched and saved — or null while the total is
  /// unknown, which an indeterminate bar renders honestly where a bar sitting
  /// at zero would not. The pipeline's own [channelsDone] count (whole
  /// finished batches) plus the current batch's fetched-so-far.
  double? get fraction {
    final total = backlogTotal;
    if (total == null || total <= 0) return null;
    return ((channelsDone + fetchedInBatch) / total).clamp(0.0, 1.0);
  }

  /// 0..1 for the lighter, secondary fill drawn behind [fraction] — channels
  /// whose upload list has been read, whether or not the metadata fetch that
  /// follows has caught up to them yet. Same denominator as [fraction], and
  /// never below it, so the two stack into one bar with a solid head chasing a
  /// translucent one. Null on the same "total unknown" condition.
  double? get readingUploadsFraction {
    final total = backlogTotal;
    if (total == null || total <= 0) return null;
    return ((channelsDone + scannedInBatch) / total).clamp(0.0, 1.0);
  }

  VideoCatchUpState copyWith({
    VideoCatchUpStatus? status,
    String? error,
    bool clearError = false,
    DateTime? startedAt,
    int? channelsDone,
    int? backlogTotal,
    String? currentHandle,
    bool clearCurrentHandle = false,
    int? scannedInBatch,
    int? fetchedInBatch,
    int? sharedObjects,
    int? sharingTotal,
    DateTime? sharingSince,
    bool clearSharing = false,
    Duration? spentSharing,
  }) {
    return VideoCatchUpState(
      status: status ?? this.status,
      error: clearError ? null : (error ?? this.error),
      startedAt: startedAt ?? this.startedAt,
      channelsDone: channelsDone ?? this.channelsDone,
      backlogTotal: backlogTotal ?? this.backlogTotal,
      currentHandle:
          clearCurrentHandle ? null : (currentHandle ?? this.currentHandle),
      scannedInBatch: scannedInBatch ?? this.scannedInBatch,
      fetchedInBatch: fetchedInBatch ?? this.fetchedInBatch,
      sharedObjects:
          clearSharing ? null : (sharedObjects ?? this.sharedObjects),
      sharingTotal: clearSharing ? null : (sharingTotal ?? this.sharingTotal),
      sharingSince: clearSharing ? null : (sharingSince ?? this.sharingSince),
      spentSharing: spentSharing ?? this.spentSharing,
    );
  }
}

/// `[catchup] done=120 total=5336`, the one line `search.py --catch-up-videos`
/// prints purely for this app — see its own comment there. Kept next to the
/// state it fills in, and free of anything Flutter, so the parse is testable
/// on its own the way `parseSearchProgressLine` is.
final _catchUpProgressPattern = RegExp(r'^\[catchup\] done=(\d+) total=(\d+)$');

/// `[catchup-io] scanned=40 fetched=12 batch=200` — the finer line
/// `backfill_missing_videos` adds (see its comment in `pipeline.py`) purely so
/// the panel's two-layer bar has something to move between the sparse
/// `[catchup]` lines, which land only once per ~200-channel outer batch and
/// so minutes apart. `scanned`/`fetched` count channels *within* the current
/// batch — the upload list read, then the metadata actually fetched — so they
/// are added onto the last `[catchup] done=`, not read as absolutes.
final _catchUpIoPattern =
    RegExp(r'^\[catchup-io\] scanned=(\d+) fetched=(\d+) batch=(\d+)$');

/// `[step] Backfill: @somebody` — the channel currently being read.
final _catchUpHandlePattern = RegExp(r'^\[step\] Backfill: (\S+)$');

/// `[sync-io] shared=25 of=5672` — `sync.push_blobs`' position through the
/// upload it does after each outer batch (see `PUSH_PROGRESS_EVERY` in
/// `sync.py`). Absolute within one share, unlike `[catchup-io]`'s counts.
final _sharingPattern = RegExp(r'^\[sync-io\] shared=(\d+) of=(\d+)$');

/// The progress carried by one line of the sweep's output, or null if it
/// carries none.
({int done, int total})? catchUpProgress(String line) {
  final match = _catchUpProgressPattern.firstMatch(line.trim());
  if (match == null) return null;
  final done = int.tryParse(match.group(1)!);
  final total = int.tryParse(match.group(2)!);
  if (done == null || total == null) return null;
  return (done: done, total: total);
}

/// The within-batch scanned/fetched channel counts one `[catchup-io]` line
/// carries, or null if the line is anything else. `batch` (the outer batch's
/// size) is matched so a malformed line is rejected cleanly, but the panel
/// scales against [catchUpProgress]'s `total` instead of it.
({int scanned, int fetched})? catchUpIoProgress(String line) {
  final match = _catchUpIoPattern.firstMatch(line.trim());
  if (match == null) return null;
  final scanned = int.tryParse(match.group(1)!);
  final fetched = int.tryParse(match.group(2)!);
  if (scanned == null || fetched == null) return null;
  return (scanned: scanned, fetched: fetched);
}

/// The handle one line of the sweep's output says it is working on, or null.
String? catchUpHandle(String line) {
  final match = _catchUpHandlePattern.firstMatch(line.trim());
  return match?.group(1);
}

/// The position one `[sync-io]` line reports through the current share, or
/// null if the line is anything else.
({int shared, int total})? catchUpSharing(String line) {
  final match = _sharingPattern.firstMatch(line.trim());
  if (match == null) return null;
  final shared = int.tryParse(match.group(1)!);
  final total = int.tryParse(match.group(2)!);
  if (shared == null || total == null) return null;
  return (shared: shared, total: total);
}

/// [state] after one line of the sweep's stdout, which may or may not carry
/// progress. The whole of what `VideoCatchUpNotifier` does with a line, kept
/// free of anything Flutter so the transitions are testable on their own.
///
/// Only four shapes are read (see [catchUpProgress], [catchUpIoProgress],
/// [catchUpHandle] and [catchUpSharing]); every other line returns [state]
/// itself. Nothing here throws on a line it does not recognise, which
/// matters more here than in the search parser: this output is nobody's
/// foreground task, so a parse that broke would surface as a panel that
/// never moves rather than as anything anybody would think to report.
///
/// [now] is only consulted when a share phase begins or ends, to keep the
/// time it takes out of the panel's throughput estimate.
VideoCatchUpState applyCatchUpLine(
  VideoCatchUpState state,
  String line, {
  DateTime Function() now = DateTime.now,
}) {
  final sharing = catchUpSharing(line);
  if (sharing != null) {
    return state.copyWith(
      sharedObjects: sharing.shared,
      sharingTotal: sharing.total,
      sharingSince: state.sharingSince ?? now(),
      // The handle on screen belongs to the last channel of the batch just
      // finished; left beside "sharing", it reads as that channel being the
      // thing that is slow.
      clearCurrentHandle: true,
    );
  }
  final progress = catchUpProgress(line);
  final io = progress == null ? catchUpIoProgress(line) : null;
  final handle = progress == null && io == null ? catchUpHandle(line) : null;
  if (progress == null && io == null && handle == null) return state;

  // Any line about reading channels means the share, if one was in flight,
  // is over — `push_blobs` prints its final `shared=N of=N`, then
  // `write_segment` and the next batch's first `[step] Backfill:` follow
  // within seconds. Bank the time it took before moving on.
  final resumed = _endSharing(state, now);
  if (progress != null) {
    return resumed.copyWith(
      channelsDone: progress.done,
      backlogTotal: progress.total,
      // The outer batch those `[catchup-io]` counts belonged to has just
      // been folded into `done`; the next batch starts counting from zero,
      // and until its first line lands the bar should read exactly
      // `done/total` on both layers.
      scannedInBatch: 0,
      fetchedInBatch: 0,
      // The batch this handle belonged to is finished with; what follows is
      // the share, then the next batch's own first `[step] Backfill:`.
      clearCurrentHandle: true,
    );
  }
  if (io != null) {
    return resumed.copyWith(
      scannedInBatch: io.scanned,
      fetchedInBatch: io.fetched,
    );
  }
  return resumed.copyWith(currentHandle: handle);
}

VideoCatchUpState _endSharing(
    VideoCatchUpState state, DateTime Function() now) {
  final since = state.sharingSince;
  if (since == null) return state;
  return state.copyWith(
    clearSharing: true,
    spentSharing: state.spentSharing + now().difference(since),
  );
}

/// Runs `search.py --catch-up-videos` in the background so the thousands of
/// channels a search discovered but never got back around to fetching videos
/// for (see `pipeline.py`'s `get_video_backfill_candidates` docstring — a
/// scoped run's own backlog sweep only ever reaches a fraction of the whole
/// store) get their normal ~15-video window eventually, without anyone
/// having to run search after search waiting for the 25-channels-per-keyword
/// trickle to clear it.
///
/// This is NOT the wide, multi-month, per-channel `tools/enrich.py` backfill
/// (`BackfillRunNotifier`) — it only ever fetches the same shallow window
/// ordinary discovery already fetches for a new channel, which costs no more
/// quota per channel than discovery does. That is what makes it safe to run
/// unattended with a generous cap rather than needing the careful
/// budget-ceiling UI a manual "pull more" needs.
///
/// Deliberately the lowest-priority pipeline job in the app: it only ever
/// starts when nothing else wants the local database, and it gets out of the
/// way — via [PipelineLaunchResult.stop] — the moment a search or a manual
/// backfill needs it. Losing an in-flight catch-up pass costs nothing: the
/// channels it already touched are already marked, and the rest stay in the
/// backlog for the next pass.
class VideoCatchUpNotifier extends Notifier<VideoCatchUpState> {
  /// How long to wait after the app opens before starting a pass — later
  /// than [PipelineWarmupNotifier]'s, so the one thing a person is actually
  /// waiting on (a search's own shared-state pull) is never made to queue
  /// behind a maintenance job nobody asked for this session.
  static const _startupDelay = Duration(seconds: 8);

  /// How many channels one pass asks for — see `search.py`'s own
  /// `--catch-up-limit` default for why this number is generous rather than
  /// conservative: the whole point is that this job is cheap.
  static const _limit = 3000;

  Future<void>? _inFlight;
  Timer? _pending;
  Future<bool> Function()? _stop;
  bool _disposed = false;

  final List<String> _tail = [];

  /// Whether the pass now ending was killed by [stopAndWait] rather than
  /// having ended on its own. See there.
  bool _steppingAside = false;

  /// How long after the job that displaced this one ends before trying
  /// again. Long enough that a search's own final push and the mirror
  /// catch-up it triggers are done first, since those want the connection
  /// too.
  static const _resumeDelay = Duration(seconds: 20);

  @override
  VideoCatchUpState build() {
    final canRun = ref.read(capabilitiesProvider).canRunSearch;

    // A search or a manual backfill stops this mid-pass (see [stopAndWait]),
    // and without this the backlog would then sit untouched until the next
    // app launch — on a machine somebody searches from all day, that is
    // every launch stopped a minute in and no progress ever made. Picking
    // the pass back up when the pipeline is free again is the whole
    // difference between "clears eventually" and "never finishes".
    //
    // Subscribed through the container rather than `ref.listen` on purpose.
    // `ref.listen` would make this provider a dependent of each of those
    // three, and each of those three `ref.read`s this one right before it
    // launches (to tell it to step aside) — Riverpod's debug-mode check
    // reads that as a provider depending on itself and refuses to start
    // the search with a `CircularDependencyError`. A container subscription
    // fires the same callback without joining the dependency graph.
    final subscriptions = [
      ref.container.listen(activeSearchRunControllerProvider, (previous, next) {
        _resumeIfFreed();
      }),
      ref.container.listen(backfillRunControllerProvider, (previous, next) {
        _resumeIfFreed();
      }),
      ref.container.listen(reenrichRunControllerProvider, (previous, next) {
        _resumeIfFreed();
      }),
    ];
    ref.onDispose(() {
      _disposed = true;
      _pending?.cancel();
      for (final sub in subscriptions) {
        sub.close();
      }
    });

    return VideoCatchUpState(
      status: canRun ? VideoCatchUpStatus.idle : VideoCatchUpStatus.unavailable,
    );
  }

  void _resumeIfFreed() {
    if (state.status == VideoCatchUpStatus.unavailable) return;
    if (state.isRunning || _othersAreRunning) return;
    runInBackground(delay: _resumeDelay);
  }

  bool get isRunning => state.isRunning;

  /// Called once as the app starts. Does nothing if unavailable, already
  /// running, or if a search/backfill is already using the database — this
  /// is the one pipeline job allowed to simply skip its turn rather than
  /// wait, since there is always a next app launch to try again on.
  void runInBackground({Duration delay = _startupDelay}) {
    if (state.status == VideoCatchUpStatus.unavailable) return;
    if (state.isRunning || _othersAreRunning) return;
    _pending?.cancel();
    _pending = Timer(delay, () {
      _pending = null;
      if (_disposed || state.isRunning || _othersAreRunning) return;
      unawaited(_run());
    });
  }

  bool get _othersAreRunning {
    try {
      return ref.read(activeSearchRunControllerProvider.notifier).isRunning ||
          ref.read(backfillRunControllerProvider.notifier).isRunning ||
          // The third job that owns `gratovo.db` while it runs. It was missing
          // here, and the gap is not theoretical: a search finishing while a
          // re-enrich is going asks this, is told the pipeline is free, and
          // launches a second interpreter into it — `database is locked`, for
          // both of them. Invisible until now, since a catch-up that died had
          // nowhere to say so.
          ref.read(reenrichRunControllerProvider.notifier).isRunning;
    } catch (_) {
      return false;
    }
  }

  /// Signals a running pass to stop and waits for it to actually exit —
  /// what a search or a manual backfill calls before launching, so the two
  /// processes never write `gratovo.db` at the same time. Safe to call when
  /// nothing is running.
  Future<void> stopAndWait() async {
    final stop = _stop;
    final inFlight = _inFlight;
    if (stop == null || inFlight == null) return;
    // Set before the kill, not after it: the exit code is all the pass has to
    // go on afterwards, and a killed process is indistinguishable from a
    // crashed one by that alone. Without this the panel would announce a
    // failure every time somebody pressed Start.
    _steppingAside = true;
    await stop();
    await inFlight;
  }

  Future<void> _run() {
    return _inFlight ??= _runNow().whenComplete(() {
      _inFlight = null;
      _stop = null;
    });
  }

  Future<void> _runNow() async {
    if (_disposed) return;
    final env = ref.read(pythonEnvironmentProvider);
    final override = env.projectRootOverride.trim();
    final paths = ScraperProcess.resolvePaths(
      projectRootOverride: override.isEmpty ? null : override,
    );
    if (paths == null) {
      state = state.copyWith(status: VideoCatchUpStatus.unavailable);
      return;
    }

    // The one thing worth waiting for: a shared-state pull already in
    // flight. Racing it is the same "database is locked" failure
    // `ActiveSearchRunNotifier.startSearch` guards against for a search.
    if (ref.read(pipelineWarmupProvider).isRunning) {
      await ref.read(pipelineWarmupProvider.notifier).waitForInFlight();
      if (_disposed || _othersAreRunning) return;
    }

    _tail.clear();
    _steppingAside = false;
    // A whole new state rather than a copy: the counts and the handle belong
    // to the pass that printed them, and carrying last pass's numbers into
    // this one's first seconds is exactly the kind of stale-but-plausible
    // progress this panel exists to stop showing.
    state = VideoCatchUpState(
      status: VideoCatchUpStatus.running,
      startedAt: DateTime.now(),
    );

    final PipelineLaunchResult launch;
    try {
      launch = await ScraperProcess.catchUpMissingVideos(
        pythonExecutable: env.pythonExecutable,
        paths: paths,
        limit: _limit,
      );
    } catch (error) {
      if (_disposed) return;
      state =
          state.copyWith(status: VideoCatchUpStatus.failed, error: '$error');
      return;
    }
    _stop = launch.stop;

    final sub = launch.stdoutLines.listen((line) {
      _tail.add(line);
      if (_tail.length > 20) _tail.removeAt(0);
      _readProgress(line);
    });

    final code = await launch.exitCode;
    await sub.cancel();
    if (_disposed) return;
    // A pass killed to make room for a search is not a failed one — see
    // [stopAndWait]. It is also the ordinary way a pass ends on a machine
    // somebody searches from, which is why it gets its own status rather than
    // a quieter error message.
    final steppedAside = _steppingAside && code != 0;
    _steppingAside = false;
    state = state.copyWith(
      status: switch ((code == 0, steppedAside)) {
        (true, _) => VideoCatchUpStatus.done,
        (false, true) => VideoCatchUpStatus.paused,
        (false, false) => VideoCatchUpStatus.failed,
      },
      error: code == 0 || steppedAside ? null : _tail.join('\n'),
      clearError: code == 0 || steppedAside,
      clearCurrentHandle: true,
    );
    if (code != 0 && !steppedAside) {
      developer.log(
        'Background video catch-up failed; the backlog will be smaller next '
        'time a search chips away at it instead.',
        name: 'gratovo.pipeline.catchup',
        level: 900,
      );
    }
  }

  /// Turns one line of the sweep's stdout into progress, if it carries any —
  /// see [applyCatchUpLine], which is the whole of it.
  void _readProgress(String line) {
    final next = applyCatchUpLine(state, line);
    if (!identical(next, state)) state = next;
  }
}

final videoCatchUpControllerProvider =
    NotifierProvider<VideoCatchUpNotifier, VideoCatchUpState>(
  VideoCatchUpNotifier.new,
);
