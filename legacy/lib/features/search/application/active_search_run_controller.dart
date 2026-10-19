import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/local_pipeline_db.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/core/presence/live_data_service.dart';
import 'package:gratovo_toolbox/core/presence/presence_service.dart';
import 'package:gratovo_toolbox/core/sync/sync_providers.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/features/search/application/pipeline_warmup_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_keywords_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_progress_parser.dart';
import 'package:gratovo_toolbox/features/search/application/video_catchup_controller.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';

/// The live view of a [SearchRun] *this app session* started -- fed
/// directly from the launched process' own stdout/stderr for [logLines] and
/// for every field of live progress (which keyword, which step, how many
/// done -- see `search_progress_parser.dart`), and from a short local
/// `gratovo.db` poll (every 2s while running, same file
/// `LocalSearchRepository`/`local_pipeline_db.dart` read elsewhere,
/// concurrent-read-safe per store.py's own WAL-mode design) for the numeric
/// [SearchRun.channelsFound]/[SearchRun.videosFound] counts -- more reliable
/// than scraping search.py's `print()` lines for numbers it never prints in a
/// single consistent place.
///
/// This is intentionally NOT part of [SearchRepository]/
/// `LocalSearchRepository`: starting a process and watching it live is a
/// UI-session action tied to *this* running app instance, not a stateless
/// data read every repository method in this codebase otherwise is.
/// `entity_providers.dart`'s `currentSearchRunProvider` prefers this
/// controller's state when non-null, falling back to
/// `SearchRepository.getCurrentRun()`'s local-DB-only snapshot otherwise
/// (see that repository's doc comment for why the two don't overlap).
class ActiveSearchRunNotifier extends Notifier<SearchRun?> {
  /// How many of the pipeline's most recent output lines the panel keeps.
  ///
  /// A discovery run prints per keyword, per channel and per video, so a broad
  /// run emits thousands of lines. Every one of them used to be appended to an
  /// immutable list (copying the whole list each time) and rendered as its own
  /// `Text` in a non-lazy column, so the cost of one more line grew with the
  /// number already shown and the app ground to a halt part-way through a run.
  /// Nobody scrolls back through five thousand lines of a live log; the tail is
  /// what says whether the run is still moving.
  static const _maxLogLines = 400;

  /// How long output accumulates before it reaches the panel. The pipeline
  /// prints in bursts, and one rebuild per burst shows the same thing as one
  /// rebuild per line.
  ///
  /// Shortened from 250ms when the pipeline started reporting each step: the
  /// header now names what is happening right now, and at a quarter of a
  /// second that name visibly lagged the log line it came from. Six or seven
  /// rebuilds a second is still an order of magnitude fewer than one per line
  /// during a burst, which is what this exists to prevent.
  static const _flushInterval = Duration(milliseconds: 150);

  /// How often `gratovo.db`'s `runs` row is re-read for the channel/video
  /// counters. A short-lived read-only SQLite connection over a WAL database
  /// is cheap, and this is the only source for numbers the pipeline never
  /// prints.
  static const _pollInterval = Duration(seconds: 2);

  Timer? _pollTimer;
  Timer? _flushTimer;
  StreamSubscription<String>? _stdoutSub;

  /// The running process' own stop hook, held so the Stop button has
  /// something to call. Null between runs.
  Future<bool> Function()? _stop;

  /// Set by [stopSearch] so the exit handler can tell "somebody stopped this"
  /// apart from "this fell over", which are shown very differently.
  bool _stopRequested = false;

  /// Lines that have arrived since the last flush -- see [_appendLine].
  final List<String> _pendingLines = [];

  /// Progress parsed out of those lines, applied on the same flush so one
  /// burst of output costs one rebuild rather than one per event.
  String? _pendingKeyword;
  int? _pendingKeywordIndex;
  final List<String> _pendingCompleted = [];
  String? _pendingStep;

  /// Keywords started and not yet finished, oldest first, with their index.
  /// One at most on an ordinary run; with parallel search, one per worker --
  /// and a keyword finishing must not blank the panel while others are still
  /// in flight, which is what a single "current keyword" did.
  final KeywordsInFlight _inFlight = KeywordsInFlight();

  /// The run's connections as last reported (`[route]` lines).
  SearchRouteUsage? _pendingRoute;

  /// Whether a keyword event arrived at all since the last flush. Needed
  /// because [_pendingKeyword] has two different nulls: "no keyword news this
  /// burst, keep showing what you were showing" and "the keyword just
  /// finished, stop highlighting it".
  bool _keywordChanged = false;

  int? _pendingBackoffTotal;
  int? _pendingBackoffRemaining;
  String? _pendingBackoffReason;

  /// Whether a line touching the backoff countdown arrived since the last
  /// flush — same two-null problem as [_keywordChanged]: [_pendingBackoffTotal]
  /// null can mean "no news" or "the wait just ended," and only this flag
  /// tells them apart.
  bool _backoffTouched = false;

  /// When [_backoffTouched], whether this flush should clear the countdown
  /// (any line other than another `[backoff]` tick means the wait ended) or
  /// apply [_pendingBackoffTotal]/[_pendingBackoffRemaining].
  bool _clearBackoff = false;

  /// This run's resolved pipeline paths, held so [skipBackoffWait] can signal
  /// the same install `startSearch` launched without re-deriving it from
  /// Settings. Null between runs.
  ScraperProcessPaths? _paths;

  /// Whether the pipeline reported sharing results to the bucket since the
  /// last flush — its `Shared: N object(s) uploaded, M catalog op(s).` line.
  /// That is the moment teammates have something to pull, so it is the
  /// moment to tell them: one Broadcast per keyword, sent by the app on the
  /// pipeline's behalf (Python has no Supabase client).
  bool _sharedSinceFlush = false;

  @override
  SearchRun? build() {
    ref.onDispose(() {
      _pollTimer?.cancel();
      _flushTimer?.cancel();
      _stdoutSub?.cancel();
    });
    return null;
  }

  bool get isRunning => state?.status == SearchRunStatus.running;

  /// Writes this run's keyword manifest and settings, then launches
  /// `search.py`. Throws if this platform can't resolve a local pipeline
  /// install (should never happen from UI code, which only ever calls this
  /// from behind `DesktopOnly`).
  ///
  /// [keywords] is written to `keywords.json` verbatim and is normally
  /// exactly what the run will work, in order — a resumed run passes only
  /// what is left to do. [keywordTotal] is what the *progress counter*
  /// should count towards and [alreadyCompleted] what it starts from, so
  /// resuming a 12-keyword list with 5 already done reads "5/12" rather than
  /// restarting at "0/7". The one exception is a manual "start at #"
  /// (`search_screen.dart`'s `_startSearch`): there [keywords] is the whole
  /// box, unfiltered, and `runConfigJson['start_at_index']` tells
  /// `search.py` itself where in that list to begin — so [keywordTotal]
  /// still equals `keywords.length` and the offset math below stays a no-op.
  Future<void> startSearch({
    required List<String> keywords,
    required Map<String, Object?> runConfigJson,
    required String startedByLabel,
    int? keywordTotal,
    List<String> alreadyCompleted = const [],
  }) async {
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
    _paths = paths;

    _resetBuffers();
    _inFlight.clear();
    _pollTimer?.cancel();
    _flushTimer?.cancel();
    _stopRequested = false;
    _stop = null;
    // Fire-and-forget: cancelling a subscription from a run this method is
    // about to replace doesn't need to be waited on before starting the new
    // one -- same reasoning as the exitCode future below.
    unawaited(_stdoutSub?.cancel() ?? Future<void>.value());

    state = SearchRun(
      id: 'live-${DateTime.now().millisecondsSinceEpoch}',
      keywords: keywords,
      startedBy: startedByLabel,
      startedAt: DateTime.now(),
      status: SearchRunStatus.running,
      logLines: const [],
      keywordTotal: keywordTotal ?? keywords.length,
      completedKeywords: List.unmodifiable(alreadyCompleted),
      keywordsDone: alreadyCompleted.length,
      currentStep: 'Starting the pipeline...',
    );

    // The mirror and this run want the same connection, and this run is the
    // one somebody is waiting on. Told rather than inferred, because the sync
    // engine is built at launch and has no way to see a search run.
    //
    // Not a nicety: the sync log shows the last clean pass finishing at
    // 13:05:46 and a run starting at 13:05:45, after which every download
    // timed out at every page size for an hour — while single-row requests
    // over the same connection kept answering in under a second. Downloading
    // underneath a run does not work and slows the run down trying.
    _setSyncBusy(true, 'A search is running');
    _announceSearching(started: DateTime.now());

    // The one thing still worth waiting for, and only when it is already
    // happening: a background pull in flight (pipeline_warmup_controller.dart).
    // Starting a run into one means two interpreters writing the same rows of
    // the same SQLite file for no gain, and the run would skip its own pull on
    // the strength of a stamp the other process has not written yet — so it
    // would search with the shared state it was trying to avoid missing.
    //
    // This is a few seconds now, not the minute it was. The pull no longer
    // downloads the `videos` table (45 of its original 50 seconds, for rows
    // nothing in a search reads — see `sync.pull_all`), and a run skips it
    // outright when a recent one landed, which after this wait it has.
    //
    // The warm-up's own guard is the other half of this and the half that was
    // missing: `warmInBackground` arms a *timer*, so on an app launch that
    // auto-resumes an interrupted run the timer was still pending here,
    // `isRunning` was false, this did not wait, and the timer then fired and
    // launched a pull into the run that had just started. Both interpreters
    // wrote `gratovo.db` in the same second and the run died on its first
    // statement with `sqlite3.OperationalError: database is locked`. The state
    // above is already `running` by this point, which is what
    // `PipelineWarmupNotifier` now checks before it launches anything.
    if (ref.read(pipelineWarmupProvider).isRunning) {
      state = state?.copyWith(currentStep: 'Fetching shared data...');
      await ref.read(pipelineWarmupProvider.notifier).waitForInFlight();
      state = state?.copyWith(currentStep: 'Starting the pipeline...');
    }

    // The background video-catch-up sweep (video_catchup_controller.dart) is
    // the lowest-priority thing that ever touches gratovo.db, precisely so a
    // search never has to wait for it the way it waits for the pull above —
    // it is told to stop instead. Losing an in-flight pass costs nothing: the
    // channels it already touched are already marked, and the rest are still
    // in the backlog for its next turn.
    if (ref.read(videoCatchUpControllerProvider.notifier).isRunning) {
      await ref.read(videoCatchUpControllerProvider.notifier).stopAndWait();
    }

    final PipelineLaunchResult launch;
    try {
      launch = await ScraperProcess.startSearch(
        pythonExecutable: pythonEnv.pythonExecutable,
        paths: paths,
        keywords: keywords,
        runConfigJson: runConfigJson,
      );
    } catch (error) {
      // Everything from here up to a launched process can throw -- a missing
      // pipeline folder, an interpreter that is not there, an unwritable data
      // directory. The state was set to `running` before any of it, and
      // without this it stays that way: no process to produce an exit code, so
      // the exit handler below never runs, and the panel sits on "Starting the
      // pipeline..." with a spinner for the rest of the session. The Stop
      // button cannot clear it either -- `_stop` is still null, so it returns
      // immediately -- and the sync engine stays marked busy, which silently
      // blocks the mirror from downloading anything.
      _failLaunch(error);
      rethrow;
    }
    _stop = launch.stop;

    // On disk before the first keyword is worked: from here on, a session that
    // is killed (app closed, crash) leaves this set, and the next launch reads
    // it as "a search was interrupted" and resumes what is left. Awaited so the
    // marker is genuinely written before this method hands back.
    await ref.read(searchKeywordsProvider.notifier).markRunStarted();

    _stdoutSub = launch.stdoutLines.listen(
      _appendLine,
      // Without this, an error on the output stream is an unhandled async
      // error -- which is what a malformed byte from the interpreter used to
      // produce, and it read to the user as the app crashing on Start rather
      // than as one bad log line. `scraper_process_io.dart` now decodes
      // leniently so this should not fire at all, but a stream that can carry
      // errors must have somewhere to put them: surface it in the log panel
      // the user is already watching and let the run carry on -- the process
      // itself is still going, and its exit code is what decides the outcome.
      onError: (Object error) => _appendLine('[app] log output error: $error'),
    );

    _pollTimer = Timer.periodic(_pollInterval, (_) {
      final run = LocalPipelineDb.readLatestSearchRun(paths.dbPath);
      final current = state;
      if (run == null || current == null) return;
      if (run.channelsUpserted == current.channelsFound &&
          run.videosUpserted == current.videosFound) {
        return;
      }
      state = current.copyWith(
        channelsFound: run.channelsUpserted,
        videosFound: run.videosUpserted,
      );
    });

    unawaited(
      launch.exitCode.then((code) {
        _pollTimer?.cancel();
        _stop = null;
        // The tail of a failed run is the part worth reading, so the last
        // buffered lines must land before the panel stops updating.
        _flush();
        final run = LocalPipelineDb.readLatestSearchRun(paths.dbPath);
        final current = state;
        if (current == null) return;
        final status = _stopRequested
            ? SearchRunStatus.stopped
            : (code == 0 ? SearchRunStatus.completed : SearchRunStatus.failed);
        state = current.copyWith(
          status: status,
          finishedAt: DateTime.now(),
          channelsFound: run?.channelsUpserted ?? current.channelsFound,
          videosFound: run?.videosUpserted ?? current.videosFound,
          // A run that has stopped is not still working a keyword. Leaving
          // these set is what would keep the keyword box highlighting a line
          // nothing is happening on and the counter stuck at "5/12".
          clearCurrentKeyword: true,
          activeKeywords: const [],
          clearCurrentStep: true,
        );
        _setSyncBusy(false, null);
        _announceSearching(ended: true);
        // The end of a run is the last share, and the one most worth
        // announcing: whatever the run's final keyword found is in the
        // bucket now.
        _announceShared();
        // Only a run that finished its list or was stopped by hand is a
        // deliberate end — those clear the interrupted-run marker so the next
        // launch leaves it alone. A run that fell over on its own keeps the
        // marker set, exactly like a session killed mid-run, so the next
        // launch resumes the keywords it had left.
        if (status == SearchRunStatus.completed ||
            status == SearchRunStatus.stopped) {
          unawaited(ref.read(searchKeywordsProvider.notifier).markRunEnded());
        }
      }),
    );
  }

  /// Puts the run back into a finished state after a launch that never
  /// produced a process, and undoes the two things [startSearch] had already
  /// done on the strength of one starting.
  ///
  /// Separate from the exit handler because there is no exit code to read and
  /// nothing in `gratovo.db` to read counts from: nothing ran.
  void _failLaunch(Object error) {
    _pollTimer?.cancel();
    _flushTimer?.cancel();
    _resetBuffers();
    _stop = null;
    final current = state;
    if (current != null) {
      state = current.copyWith(
        status: SearchRunStatus.failed,
        finishedAt: DateTime.now(),
        logLines: [
          ...current.logLines,
          '[app] could not start the run: $error'
        ],
        clearCurrentKeyword: true,
        activeKeywords: const [],
        clearCurrentStep: true,
      );
    }
    _setSyncBusy(false, null);
    _announceSearching(ended: true);
    // The interrupted-run marker is left exactly as it was found. On a fresh
    // Start it was never set (markRunStarted runs only once a process exists),
    // so there is nothing to clear. On an auto-resume it is still set, and a
    // launch that could not get a process off the ground is not a deliberate
    // end — the next launch should try the resume again.
  }

  /// Hands the sync engine the news, if there is one to hand it to.
  ///
  /// Never throws: a search run must not fail because the local copy is
  /// switched off, unavailable on this platform, or already closed.
  void _setSyncBusy(bool busy, String? reason) {
    try {
      ref.read(syncEngineProvider)?.setBusy(busy: busy, reason: reason);
    } catch (_) {
      // Nothing here is worth interrupting a run for.
    }
  }

  /// Asks the running pipeline to stop. Safe to call when nothing is running.
  ///
  /// The state does not flip to [SearchRunStatus.stopped] here — it flips
  /// when the process actually exits, which is the only moment the run has
  /// genuinely ended. Until then the panel says it is stopping, which is
  /// true: the pipeline finishes the batch it is in before it goes.
  Future<void> stopSearch() async {
    final stop = _stop;
    if (stop == null || !isRunning) return;
    _stopRequested = true;
    // Stopping is a deliberate end. Clear the marker now rather than waiting
    // for the exit handler, so closing the app in the gap between pressing
    // Stop and the process actually exiting does not look like an interruption.
    unawaited(ref.read(searchKeywordsProvider.notifier).markRunEnded());
    state = state?.copyWith(currentStep: 'Stopping after the current step...');
    final signalled = await stop();
    if (!signalled) {
      // The process was already gone; the exit handler either has run or is
      // about to, and it owns the final state.
      _stopRequested = false;
    }
  }

  void _resetBuffers() {
    _pendingLines.clear();
    _pendingCompleted.clear();
    _pendingKeyword = null;
    _pendingKeywordIndex = null;
    _sharedSinceFlush = false;
    _pendingStep = null;
    _pendingRoute = null;
    _keywordChanged = false;
    _pendingBackoffTotal = null;
    _pendingBackoffRemaining = null;
    _pendingBackoffReason = null;
    _backoffTouched = false;
    _clearBackoff = false;
  }

  /// Buffers one output line and whatever progress it reports, flushing at
  /// most once per [_flushInterval].
  void _appendLine(String line) {
    final event = parseSearchProgressLine(line);
    // A backoff tick prints every couple of seconds for as long as a wait
    // runs -- a 15-minute wait is a few hundred of them, which would push
    // everything else clean out of the capped log for no reason anyone reads
    // it. The countdown they drive is shown structured instead (see
    // `search_progress_panel.dart`), so only that state needs to change here.
    if (event is! BackoffWaiting) {
      _pendingLines.add(line);
      // Bound the buffer too: a burst longer than one interval should not be
      // able to hold more lines than the panel will ever show.
      if (_pendingLines.length > _maxLogLines) {
        _pendingLines.removeRange(0, _pendingLines.length - _maxLogLines);
      }
    }

    switch (event) {
      case KeywordStarted(:final keyword, :final index):
        _inFlight.started(keyword, index);
        _pendingKeyword = keyword;
        _pendingKeywordIndex = index;
        _keywordChanged = true;
        _backoffTouched = true;
        _clearBackoff = true;
      case KeywordFinished(:final keyword):
        _pendingCompleted.add(keyword);
        _inFlight.finished(keyword);
        // Cleared rather than left pointing at the keyword just finished: the
        // gap before the next one starts is short, and highlighting a
        // finished line during it reads as the run having stalled on it. On
        // a parallel run another keyword is usually still going; that one
        // takes over.
        _pendingKeyword = _inFlight.current;
        if (!_inFlight.isEmpty) _pendingKeywordIndex = _inFlight.currentIndex;
        _keywordChanged = true;
        _backoffTouched = true;
        _clearBackoff = true;
      case RoutePoolReported(
          :final gateways,
          :final proxies,
          :final includesDirect,
          :final gapSeconds,
          :final workers,
          :final parallel,
          :final pacing,
        ):
        _pendingRoute = _route().copyWith(
          gateways: gateways,
          proxies: proxies,
          includesDirect: includesDirect,
          gapSeconds: gapSeconds,
          workers: workers,
          parallel: parallel,
          pacing: pacing,
        );
        _backoffTouched = true;
        _clearBackoff = true;
      case RouteUsed(
          :final awsRequests,
          :final proxyRequests,
          :final directRequests,
          :final lastKind,
          :final lastLabel,
        ):
        _pendingRoute = _route().copyWith(
          awsRequests: awsRequests,
          proxyRequests: proxyRequests,
          directRequests: directRequests,
          lastKind: lastKind,
          lastLabel: lastLabel,
        );
        _backoffTouched = true;
        _clearBackoff = true;
      case StepReported(:final step):
        _pendingStep = step;
        _backoffTouched = true;
        _clearBackoff = true;
      case BackoffWaiting(
          :final totalSeconds,
          :final remainingSeconds,
          :final reason
        ):
        _pendingBackoffTotal = totalSeconds;
        _pendingBackoffRemaining = remainingSeconds;
        _pendingBackoffReason = reason;
        _backoffTouched = true;
        _clearBackoff = false;
      case _:
        _backoffTouched = true;
        _clearBackoff = true;
    }
    if (line.contains('catalog op(s).')) _sharedSinceFlush = true;

    _flushTimer ??= Timer(_flushInterval, _flush);
  }

  SearchRouteUsage _route() =>
      _pendingRoute ?? state?.route ?? const SearchRouteUsage();

  /// Asks the running pipeline to stop waiting out the current YouTube
  /// backoff and retry right now — the Search screen's "Try again now"
  /// button, shown only while [SearchRun.backoffTotalSeconds] is set.
  ///
  /// A no-op if nothing is running or nothing is currently waiting;
  /// `scrapetube._skip_wait_requested` consumes the signal file itself, so
  /// there is nothing here to undo if the wait already ended on its own.
  Future<void> skipBackoffWait() async {
    final paths = _paths;
    if (paths == null || !isRunning) return;
    await PipelineSettings.requestSkipWait(paths);
  }

  /// One presence update with where the run has got to. Called once per
  /// flush that changed the keyword or the counts — never per channel.
  void _announceSearching({DateTime? started, bool ended = false}) {
    final run = state;
    final presence = ref.read(presenceControllerProvider.notifier);
    if (ended || run == null) {
      unawaited(presence.setSearching(null));
      return;
    }
    unawaited(presence.setSearching(SearchingStatus(
      keyword: run.currentKeyword ?? '',
      channelsFound: run.channelsFound,
      startedAt: started ?? run.startedAt,
      backoffRemainingSeconds: run.backoffRemainingSeconds,
      backoffReason: run.backoffReason,
    )));
  }

  /// One Broadcast saying the bucket has new scraped rows.
  void _announceShared() {
    _sharedSinceFlush = false;
    ref.read(liveDataControllerProvider.notifier).announce(const {
      'channels',
      'videos',
      'channel_keywords',
      'channel_archive',
    });
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
        _pendingCompleted.isEmpty &&
        !_keywordChanged &&
        _pendingStep == null &&
        _pendingRoute == null &&
        !_backoffTouched) {
      return;
    }

    final merged = [...current.logLines, ..._pendingLines];
    final completed = _pendingCompleted.isEmpty
        ? current.completedKeywords
        : [
            ...current.completedKeywords,
            // A resumed run is handed keywords it may already have recorded
            // as done in a previous session; adding them twice would push the
            // counter past its own total.
            for (final keyword in _pendingCompleted)
              if (!current.completedKeywords.contains(keyword)) keyword,
          ];

    // Write the finished-keyword list straight through on every change, so a
    // run that is interrupted resumes from where it actually got to — not from
    // where it was the last time the Search screen happened to be open. The
    // screen's own listener does this too when it is mounted; `setCompleted`
    // is idempotent, so the overlap is harmless.
    if (!identical(completed, current.completedKeywords)) {
      ref.read(searchKeywordsProvider.notifier).setCompleted(completed);
    }

    final keyword = _pendingKeyword;
    final keywordChanged = _keywordChanged;
    // `search.py` only ever sees the keywords *this* run was launched with, so
    // its `[keyword i/n]` prints — and therefore `_pendingKeywordIndex` — count
    // from 1 within that slice. A resumed run was handed only what was left, so
    // the panel's "Keyword i of N" (N being the whole list) has to add back the
    // keywords that were already finished when the run started, or a run
    // picking up at number six reads "Keyword 1 of 12". The offset is the whole
    // list minus what this run was actually given.
    final priorKeywords = current.keywords.isEmpty
        ? 0
        : (current.keywordTotal - current.keywords.length)
            .clamp(0, current.keywordTotal);
    final keywordIndex = _pendingKeywordIndex == null
        ? null
        : _pendingKeywordIndex! + priorKeywords;
    final step = _pendingStep;
    final route = _pendingRoute;
    final shared = _sharedSinceFlush;
    final backoffTotal = _pendingBackoffTotal;
    final backoffRemaining = _pendingBackoffRemaining;
    final backoffReason = _pendingBackoffReason;
    final backoffTouched = _backoffTouched;
    final clearBackoff = _clearBackoff;
    _resetBuffers();

    state = current.copyWith(
      logLines: merged.length > _maxLogLines
          ? merged.sublist(merged.length - _maxLogLines)
          : merged,
      completedKeywords: completed,
      currentKeyword: keyword,
      clearCurrentKeyword: keywordChanged && keyword == null,
      currentKeywordIndex: keywordIndex,
      activeKeywords: keywordChanged ? _inFlight.keywords : null,
      route: route,
      currentStep: step,
      backoffTotalSeconds: backoffTouched ? backoffTotal : null,
      backoffRemainingSeconds: backoffTouched ? backoffRemaining : null,
      backoffReason: backoffTouched ? backoffReason : null,
      clearBackoff: backoffTouched && clearBackoff,
    );
    // Backoff changes announce too, not just a keyword change: a teammate
    // stuck on the same keyword for fifteen minutes because YouTube is
    // refusing it is exactly the case Part 2 exists to surface — without
    // this, `SearchingStatus` would keep whatever backoff state it had at
    // the last keyword change until the next one, however stale.
    if ((keywordChanged || backoffTouched) &&
        current.status == SearchRunStatus.running) {
      _announceSearching();
    }
    if (shared) _announceShared();
  }
}

final activeSearchRunControllerProvider =
    NotifierProvider<ActiveSearchRunNotifier, SearchRun?>(
  ActiveSearchRunNotifier.new,
);
