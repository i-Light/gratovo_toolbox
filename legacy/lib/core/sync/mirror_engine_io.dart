import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart'
    show kDebugMode, kProfileMode, visibleForTesting;
import 'package:gratovo_toolbox/core/sync/mirror_database.dart';
import 'package:gratovo_toolbox/core/sync/mirror_fault.dart';
import 'package:gratovo_toolbox/core/sync/mirror_network.dart';
import 'package:gratovo_toolbox/core/sync/mirror_puller.dart';
import 'package:gratovo_toolbox/core/sync/mirror_uploader.dart';
import 'package:gratovo_toolbox/core/sync/pipeline_bridge.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine_types.dart';
import 'package:gratovo_toolbox/core/sync/sync_log_file_io.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/local_archive.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

export 'package:gratovo_toolbox/core/sync/sync_engine_types.dart';

/// How often a connected machine asks what changed — Supabase for the
/// typed-in tables, the R2 catalog (through the pipeline) for everything
/// scraped.
///
/// The honest trade of dropping replication: changes arrive within the
/// interval rather than instantly. A local edit does not wait for this — it is
/// written to the local file immediately and the person who made it sees it
/// at once; the tick is only how long until everyone else does. Nor does a
/// teammate's edit: their machine sends one Broadcast message when its upload
/// lands, and `MirrorCatchUp` asks for a pass within seconds of it.
const _interval = Duration(hours: 3);

/// How long to wait before trying again after a pass that failed.
///
/// Without these, [_interval] was also the retry interval — and three hours is
/// far too long to sit on a failure that is usually over in seconds. The first
/// pass runs the moment [_MirrorEngine.connect] is called, which on a laptop
/// resuming from sleep is very often before the network is back; that one
/// unlucky attempt then left Settings reading "Sync problem: the server did not
/// answer" and every list showing the rows it had at launch, for the rest of
/// the morning, with nothing between the person and their data but a restart.
///
/// Short enough at the front that a blip is invisible, long enough at the back
/// that a genuinely unreachable server is not asked once a minute all day. A
/// pass that succeeds clears the count, so this is a ladder a machine climbs
/// only while it is actually failing.
const _retryDelays = [
  Duration(seconds: 30),
  Duration(minutes: 2),
  Duration(minutes: 10),
  Duration(minutes: 30),
];

/// How long one pass may spend downloading before it stops and banks what it
/// has.
///
/// The ceiling that was missing. Every request had a deadline, so nothing hung
/// in the strict sense — but a pass could still spend twenty-eight minutes
/// discovering, table by table and retry by retry, what its first fifteen
/// seconds had already established. That is what "it just loads forever" was.
///
/// Two minutes is far more than a healthy pass needs (a full 500-row page of
/// channels measures 0.6 s) and little enough that a person watching a spinner
/// gets an answer while they are still watching it.
const _passBudget = Duration(minutes: 2);

/// How soon to continue after a pass that stopped on its own budget.
///
/// Short, because this is not a failure and there is nothing to back off from:
/// page cursors are written as each page lands, so the next pass resumes where
/// this one stopped. A first sync of a large table arrives over a handful of
/// passes a few seconds apart instead of one long one — which is also what
/// keeps the app responsive while it happens.
const _continueDelay = Duration(seconds: 5);

/// How long the engine will hold off for a search run before syncing anyway.
///
/// A deferral has to expire. Search runs on this team can occupy an afternoon,
/// and a mirror that quietly stopped updating for one would be a worse failure
/// than the timeouts it is avoiding — silent, rather than merely slow.
const _maxDeferral = Duration(minutes: 20);

/// How often to look again while holding off for a search run.
///
/// Mostly a safety net: the run tells the engine when it finishes and a pass
/// is scheduled from there. This is what covers the case where that message
/// never arrives — a run that died with the app, say — and what lets
/// [_maxDeferral] expire on its own.
const _deferredRecheck = Duration(minutes: 1);

/// How soon to run a pass after the local copy has refused a read or a write.
///
/// A pass is the only thing that can clear a local fault, because it is the
/// only thing that touches the file whether or not any screen is open: it
/// writes pages into the same tables the repositories read. If it gets through,
/// the file works and the app goes back to reading it.
///
/// Longer than [_continueDelay] because a machine whose disk is genuinely full
/// should not be asked every five seconds, and far shorter than [_interval]
/// because the cost of staying wrong is every screen in the app running over
/// the network for the rest of the afternoon.
const _localFaultRecheck = Duration(seconds: 45);

/// The most of a pass the upload queue may take before the download gets its
/// turn.
///
/// Sending comes first — a local edit has to reach the server before the
/// download that would otherwise overwrite it — but "first" must not mean
/// "instead of". A machine with a long queue would otherwise spend every pass
/// sending and never read anything back.
const _uploadShare = Duration(seconds: 45);

/// How long to wait before the next automatic pass, given how many have failed
/// in a row. Zero failures means the ordinary [_interval].
///
/// Top-level and visible to tests because it is the whole recovery policy in
/// one expression, and the thing that would go unnoticed if it broke: an engine
/// that quietly went back to waiting [_interval] after a failure would look
/// exactly like one that was working, until somebody noticed their data was
/// hours old.
@visibleForTesting
Duration mirrorSyncDelay(int failures) {
  if (failures <= 0) return _interval;
  return _retryDelays[math.min(failures, _retryDelays.length) - 1];
}

/// Opens the local database at [databasePath] — `data/database/gratovo.db`,
/// shared with the pipeline — and returns the engine that syncs it, or null
/// if the file cannot be opened.
///
/// [logDirectory] is where the sync log goes. [pipeline] is how the engine
/// asks `search.py` to pull the R2 catalog and to archive channels; without
/// it (tests) those steps are skipped.
Future<SyncEngine?> openSyncEngine({
  required SupabaseClient client,
  required String databasePath,
  required String logDirectory,
  PipelineBridge? pipeline,
}) async {
  // Opened before the database, so that a failure to open the database is
  // itself written down somewhere durable.
  final directory = logDirectory;
  final sink = FileSyncLogSink.open(directory);
  final diagnostics = SyncDiagnostics(sink: sink);
  sink?.writeHeader({
    'os': Platform.operatingSystem,
    'osVersion': Platform.operatingSystemVersion,
    'dart': Platform.version.split(' ').first,
    // Which build this is, because it changes what the numbers below mean.
    //
    // A debug build is a different machine wearing the same name: Dart runs
    // unoptimised under the JIT, assertions are live, the VM service is
    // attached, and every frame does work a release build never does. Dart
    // reads sockets on the isolate carrying all of that, so a large response
    // arrives in chunks that each wait their turn -- and a page can spend its
    // whole budget without a single thing being wrong with the server, the
    // query or the network.
    //
    // Written down because that failure is indistinguishable, in every other
    // line of this log, from a server that never answered. It cost days of
    // looking at the server before anyone noticed the release build was fine.
    'mode': kDebugMode
        ? 'debug'
        : kProfileMode
            ? 'profile'
            : 'release',
    'dir': directory,
  });

  try {
    return _MirrorEngine(
      MirrorDatabase.open(databasePath),
      client,
      diagnostics,
      pipeline: pipeline,
    );
  } catch (error, stackTrace) {
    diagnostics.log(
      'open.failed',
      'Could not open the local database; the app has nothing to read.',
      level: SyncLogLevel.error,
      error: error,
      stackTrace: stackTrace,
    );
    // Deliberately broad, and deliberately not rethrown. The caller reports
    // it in Settings; the app runs on the in-memory mocks so it at least
    // opens and says what is wrong.
    return null;
  }
}

class _MirrorEngine implements SyncEngine {
  _MirrorEngine(this._database, SupabaseClient client, this._log,
      {PipelineBridge? pipeline})
      : _pipeline = pipeline,
        _puller = MirrorPuller(
          database: _database,
          client: client,
          diagnostics: _log,
        ),
        _uploader = MirrorUploader(
          database: _database,
          client: client,
          pipeline: pipeline,
          diagnostics: _log,
        ) {
    // Everything above the engine gets the guarded view, never the database
    // itself. That is what makes a broken file a change of source rather than
    // a broken app — see `mirror_fault.dart`.
    _guarded = GuardedMirrorDb(_database, onFault: _noteLocalFault);
    _status = SyncSnapshot(
      hasSynced: _puller.hasSynced,
      lastSyncedAt: _puller.lastSyncedAt,
    );
    _log.log('engine.open', 'Mirror opened.', fields: {
      'path': _database.path,
      'hasSynced': _puller.hasSynced,
      'lastSyncedAt': _puller.lastSyncedAt?.toIso8601String(),
    });
  }

  final MirrorDatabase _database;

  /// What [db] hands out: the mirror, wrapped so a local failure reports
  /// itself. The puller and uploader keep the raw [_database] — their failures
  /// are already accounted for by the pass they run inside, and routing them
  /// through the guard would count one broken pass as a fault twice.
  late final GuardedMirrorDb _guarded;

  final MirrorPuller _puller;
  final MirrorUploader _uploader;
  final PipelineBridge? _pipeline;
  final SyncDiagnostics _log;

  final _controller = StreamController<SyncSnapshot>.broadcast();
  final _uploads = StreamController<Set<String>>.broadcast();
  late SyncSnapshot _status;

  /// Whether the pipeline has been found on this machine. Once a pull says
  /// "nothing to run", the engine stops asking — and says so once.
  bool _pipelineAbsent = false;

  Timer? _timer;
  bool _closed = false;

  /// The pass currently running, or null when nothing is.
  ///
  /// Held as a future rather than a bool so a second caller can *join* it
  /// instead of being turned away. Two passes must still never overlap — a
  /// second one while the first is paging would advance the same cursors from
  /// two places and interleave two transactions on one connection — but
  /// "turned away" was the wrong way to say no to [syncNow]: it returned
  /// immediately, the button announced "Up to date" on the strength of that,
  /// and the spinner it left behind belonged to a pass that was still running.
  Future<void>? _inFlight;

  /// How many passes have failed in a row, which is the rung of [_retryDelays]
  /// the next attempt waits on. Reset by the first pass that gets through.
  int _failures = 0;

  /// Why downloads are being held back, and since when. See [setBusy].
  String? _busyReason;
  DateTime? _busySince;

  bool get _shouldDefer {
    final since = _busySince;
    if (_busyReason == null || since == null) return false;
    return DateTime.now().difference(since) < _maxDeferral;
  }

  @override
  LocalSyncDb get db => _guarded;

  @override
  Stream<Set<String>> get uploadedTables => _uploads.stream;

  @override
  SyncDiagnostics get diagnostics => _log;

  @override
  SyncSnapshot get status => _status;

  @override
  Stream<SyncSnapshot> get statusStream => _controller.stream;

  @override
  Future<void> connect() async {
    if (_closed || _timer != null) return;

    _log.log('engine.connect', 'Connecting.');
    _emit(_status.copyWith(connecting: true));
    // Armed before the first pass rather than after it, so [_timer] reads as
    // "connected" from this moment on and a second connect() cannot start a
    // second schedule. The pass replaces it as it ends.
    _schedule(_interval);
    await _tick('connect');
  }

  @override
  Future<void> syncNow() async {
    // Disconnected means signed out or never connected — nothing to reach,
    // and no timer to reschedule. Matches connect()'s own no-op guard.
    if (_closed || _timer == null) return;

    // Awaits whatever is already running when a pass is in flight, so this
    // returns when the sync the caller asked about has actually finished.
    //
    // Nothing is rescheduled here: every pass arms the next attempt as it
    // ends, measured from when it ended, so a manual sync just before the
    // automatic one would have fired cannot leave two ticks stacked minutes
    // apart.
    await _tick('manual');
  }

  /// Set by a catch-up that knows the bucket changed; read and cleared by
  /// the next pass's pipeline pull so it runs past its freshness window.
  bool _scrapedHint = false;

  @override
  Future<void> catchUp({bool scraped = false}) async {
    if (_closed || _timer == null) return;
    _scrapedHint = _scrapedHint || scraped;
    // Any trigger name other than the literal 'manual' respects
    // `_shouldDefer` — see `_pass`'s own `defer` line. Named for what it is
    // rather than reusing 'schedule', so a stalled pass in the log reads as
    // "an automatic catch-up ping" and not as the three-hourly timer.
    await _tick('catchup');
  }

  @override
  void setBusy({required bool busy, String? reason}) {
    if (busy == (_busyReason != null)) return;
    _busyReason =
        busy ? (reason ?? 'Something else is using the connection') : null;
    _busySince = busy ? DateTime.now() : null;
    _log.log(
      busy ? 'engine.busy' : 'engine.free',
      busy
          ? 'Holding downloads back: $_busyReason.'
          : 'The connection is free again; syncing resumes.',
      fields: {'busy': busy},
    );

    if (busy) {
      _emit(_status.copyWith(deferredReason: _busyReason));
      return;
    }
    _emit(_status.copyWith(clearDeferred: true));
    // The run that was holding the connection has just written a batch of
    // channels to the server, so this is the moment the mirror is most out of
    // date and least contended — exactly when a pass is worth running.
    if (!_closed && _timer != null) _schedule(_continueDelay);
  }

  @override
  Future<void> disconnect() async {
    _log.log('engine.disconnect', 'Disconnecting; the local copy is kept.');
    _timer?.cancel();
    _timer = null;
    _emit(_status.copyWith(
      connected: false,
      connecting: false,
      downloading: false,
      uploading: false,
    ));
  }

  @override
  Future<void> forgetSession() async {
    await disconnect();
    // The data stays: it is this machine's working copy of the team's work,
    // shared with the pipeline, and some of it may not have been uploaded
    // yet. Only the pull cursors go, so the next person to sign in on this
    // machine starts with a full (small) pull rather than a delta from
    // somebody else's watermark — and any row the previous account could see
    // and this one cannot is replaced, not kept.
    try {
      _database.wipeData();
    } catch (error, stackTrace) {
      _log.log(
        'engine.forget.failed',
        'Could not clear the pull cursors on sign-out; the next sync will '
            'reconcile.',
        level: SyncLogLevel.error,
        error: error,
        stackTrace: stackTrace,
      );
    }
    _emit(
        SyncSnapshot(hasSynced: false, dataRevision: _status.dataRevision + 1));
  }

  @override
  Future<void> close() async {
    _timer?.cancel();
    _timer = null;
    if (!_closed) {
      // Same reasoning as the delete above: this runs while the app is going
      // away, and a database handle that will not close is not a reason to
      // stop the shutdown half-done and leak the log sink and the stream with
      // it. Marked closed either way — a connection this object can no longer
      // use is closed as far as everything above it is concerned.
      try {
        _database.close();
      } catch (error) {
        _log.log(
          'engine.close.failed',
          'The local copy did not close cleanly.',
          level: SyncLogLevel.warn,
          error: error,
        );
      }
      _closed = true;
    }
    _log.dispose();
    if (!_uploads.isClosed) await _uploads.close();
    if (!_controller.isClosed) await _controller.close();
  }

  /// Takes the local copy out of service after it refused a read or a write.
  ///
  /// Called by [GuardedMirrorDb] from inside whatever repository call hit the
  /// failure, before that call's error reaches the screen. By the time it does,
  /// `localMirrorProvider` has already gone null and every repository provider
  /// has rebuilt against Supabase — so the refetch Riverpod runs off that
  /// rebuild goes to the network and succeeds, and what the person sees is a
  /// list that loaded, not one that broke.
  ///
  /// Only the first fault of a stretch does anything. A list screen can have
  /// half a dozen queries in flight when the file goes, and they would
  /// otherwise each re-emit, re-log and re-arm the timer for the same event.
  void _noteLocalFault(MirrorFault fault) {
    if (_closed || !_status.localUsable) return;

    _log.log(
      'local.fault',
      'The local copy refused a query; every screen reads from the server '
          'until a sync pass proves the file is working again.',
      level: SyncLogLevel.error,
      fields: {'operation': fault.operation},
      error: fault.cause,
      stackTrace: fault.stackTrace,
    );
    _emit(_status.copyWith(localError: fault));

    // Nothing else will ever clear this on its own — the repositories have
    // stopped reading the file by now, so a pass is the only thing left that
    // touches it. See [_localFaultRecheck].
    if (_timer != null) _schedule(_localFaultRecheck);
  }

  /// Puts the local copy back in service after a pass proved the file works.
  ///
  /// "Proved" is doing real work here: the pass that just ran read the cursors
  /// out of `_sync_meta` and wrote its pages into the same tables the
  /// repositories read, in the same transactions, through the same connection.
  /// A file that took that is a file a `SELECT` will take.
  void _clearLocalFault() {
    if (_status.localUsable) return;
    _log.log(
      'local.recovered',
      'The local copy is working again; screens read from it once more.',
    );
    _emit(_status.copyWith(clearLocalError: true));
  }

  /// Runs a pass, or hands back the one already running.
  ///
  /// See [_inFlight] for why joining beats declining: every caller of this —
  /// the timer, the first connect, the button in the app chrome — gets a
  /// future that completes when the sync it asked about is genuinely over.
  Future<void> _tick(String trigger) {
    if (_closed) return Future<void>.value();

    final running = _inFlight;
    if (running != null) {
      _log.log(
        'pass.join',
        'A $trigger sync joined the pass already running.',
        level: SyncLogLevel.debug,
      );
      return running;
    }

    final pass = _pass(trigger);
    _inFlight = pass;
    return pass;
  }

  /// One pass: send first, then receive.
  ///
  /// The order matters. Sending first means a local edit reaches the server
  /// before the download that would otherwise overwrite it with the row it is
  /// about to change — without it, every edit would visibly flicker back to its
  /// old value for one tick.
  ///
  /// Upload and download failures are tracked separately because they mean
  /// different things and have different fixes: a refused write is usually a
  /// permission or a stale migration, a refused read is usually the network.
  ///
  /// Neither half can hang, and neither can grind. Every request underneath
  /// carries its own deadline, so a server that stops answering ends the
  /// request rather than leaving `downloading` true forever — and the whole
  /// pass carries [_passBudget] over the top of those, because per-request
  /// deadlines alone still multiply into half an hour of spinner across
  /// enough retries, pages and tables. Running out of the pass budget is not a
  /// failure: cursors are banked page by page, so the next pass continues.
  Future<void> _pass(String trigger) async {
    final startedAt = DateTime.now();
    var failed = false;
    var incomplete = false;
    var uploaded = 0;
    var downloaded = 0;

    // A search run and the mirror both want the connection, and the mirror is
    // the one that can wait. An explicit "sync now" is a person asking on
    // purpose and overrides it.
    // Read once, together, and used from these locals afterwards. The upload
    // half below has an `await` in it, and a run finishing during that await
    // clears both fields — so reading them again on the other side is a null
    // dereference on the rare pass that happens to straddle the end of a
    // search.
    final defer = trigger != 'manual' && _shouldDefer;
    final deferReason = _busyReason;
    final deferSince = _busySince;
    // Nullable and started inside the `try` below, so that every statement
    // this method runs is covered by the `finally`. Nothing here is expected to
    // throw — but a throw from *before* the try is the one failure shape this
    // engine cannot survive: `_inFlight` would stay pointing at a pass that
    // ended, every later tick would join that dead future and return at once,
    // and no timer would ever be re-armed. Sync would be over for the life of
    // the process, silently, with Settings still reading "up to date".
    _Heartbeat? heartbeat;

    try {
      final clock = MirrorDeadline(_passBudget);
      heartbeat = _Heartbeat.start();

      _log.log('pass.start', 'Sync pass started ($trigger).', fields: {
        'trigger': trigger,
        'deferred': defer,
        'budgetSec': _passBudget.inSeconds,
        'consecutiveFailures': _failures,
        'hasSynced': _status.hasSynced,
        'lastSyncedAt': _status.lastSyncedAt?.toIso8601String(),
      });
      // The upload half runs even while deferring. An outgoing edit is a few
      // hundred bytes and one round trip — the log shows small requests
      // answering in well under a second throughout the stretch where every
      // page timed out — and holding somebody's edit back for an afternoon of
      // searching is exactly the risk the outbox exists to avoid.
      _emit(_status.copyWith(uploading: true, connecting: false));
      try {
        // The archive sweep first, so the tombstones it writes and the R2
        // side it queues go out in this same drain. Its own failure is not
        // the upload's: a broken sweep is logged and the queue still drains.
        try {
          final swept = await sweepDueArchives(_database);
          if (swept > 0) {
            _log.log('archive.sweep', 'Archived $swept due channel(s).',
                fields: {'count': swept});
            _emit(_status.copyWith(dataRevision: _status.dataRevision + 1));
          }
        } catch (error) {
          _log.log('archive.sweep.failed', 'The archive sweep failed: $error',
              level: SyncLogLevel.error, fields: {'error': '$error'});
        }
        final report = await _uploader.drain(
          deadline: clock.within(_uploadShare),
        );
        uploaded = report.sent;
        _emit(_status.copyWith(uploading: false, clearUploadError: true));
        // The one Broadcast per human action: whoever is listening (the live
        // data service) tells every other open app which tables moved, and
        // their engines catch up within seconds. Sent after the upload has
        // landed, never before — a ping for rows the server does not hold yet
        // would have everyone pull nothing.
        if (report.tables.isNotEmpty && !_uploads.isClosed) {
          _uploads.add(report.tables);
        }
      } catch (error) {
        failed = true;
        _emit(_status.copyWith(uploading: false, uploadError: error));
      }

      if (defer) {
        _log.log(
          'pull.deferred',
          'Skipped the download: $deferReason.',
          fields: {
            'reason': deferReason,
            'deferredForSec': deferSince == null
                ? null
                : DateTime.now().difference(deferSince).inSeconds,
          },
        );
        _emit(_status.copyWith(
          downloading: false,
          deferredReason: deferReason,
          clearDownloadError: true,
        ));
        return;
      }

      _emit(_status.copyWith(downloading: true, clearDeferred: true));
      try {
        final report = await _puller.pull(deadline: clock);
        downloaded = report.written;
        incomplete = report.incomplete;

        // A pass with a table missing is a failed pass, even though most of it
        // worked — it retries on the short ladder and says so in Settings. What
        // it is NOT is a pass that throws away the five tables that did come
        // down: those rows are in the mirror and the revision bump below tells
        // the open screens to read them.
        failed = failed || !report.ok;

        // A clean pass read this file's cursors and wrote this file's pages
        // and timestamps, through the same connection the repositories use. If
        // it was out of service, that is the evidence to put it back.
        if (report.ok) _clearLocalFault();

        // The scraped half: the R2 catalog and the objects it names, through
        // the pipeline. Runs after the Supabase pull so a channel's typed-in
        // state is here before its scraped row arrives, not the other way
        // round (the influencer list joins the two; either order works, this
        // one just avoids a row flickering from "untouched" to "shortlisted").
        final scraped = await _pullScraped(trigger);

        _emit(_status.copyWith(
          connected: report.ok,
          downloading: false,
          clearDeferred: true,
          hasSynced: _puller.hasSynced,
          lastSyncedAt: _puller.lastSyncedAt,
          // Only when rows actually landed. A pull that found nothing new is
          // the common case, and announcing it would have every open list in
          // the app re-read itself every few hours for no reason.
          dataRevision: report.written > 0 || scraped
              ? _status.dataRevision + 1
              : _status.dataRevision,
          downloadError:
              report.ok ? null : MirrorPullException(report.failures),
          clearDownloadError: report.ok,
        ));
      } catch (error, stackTrace) {
        // Only a bug reaches here now — `pull()` reports table failures in its
        // report rather than throwing. Kept, and logged loudly, because a pass
        // that died on an unexpected exception used to leave `downloading` true
        // for the rest of the process' life.
        failed = true;
        _log.log(
          'pass.crashed',
          'The download half of the pass threw, which it is not supposed to.',
          level: SyncLogLevel.error,
          error: error,
          stackTrace: stackTrace,
        );
        _emit(_status.copyWith(
          connected: false,
          downloading: false,
          downloadError: error,
        ));
      }
    } catch (error, stackTrace) {
      // The backstop, and it should never be reached: both halves of the pass
      // above catch their own failures. What it is here for is everything
      // else — a snapshot listener that threw, a clock that could not be
      // created, whatever the next change to this method introduces. The pass
      // is counted as failed and the `finally` below re-arms the next one,
      // which is the whole point: an engine that stops scheduling is an app
      // that silently stops syncing.
      failed = true;
      _log.log(
        'pass.escaped',
        'The sync pass threw outside both halves, which it is not supposed to.',
        level: SyncLogLevel.error,
        error: error,
        stackTrace: stackTrace,
      );
      _emit(_status.copyWith(
        downloading: false,
        uploading: false,
        downloadError: error,
      ));
    } finally {
      _inFlight = null;
      final loopLate = heartbeat?.stop() ?? Duration.zero;

      // A deferred pass is not a failed one and must not climb the retry
      // ladder: it did not try. Neither is one that stopped on its own budget
      // with pages banked and more to fetch.
      if (!defer) _failures = failed ? _failures + 1 : 0;
      final next = defer
          // A run that ended while this pass was deferring means the
          // connection is free now and the mirror is at its most out of date —
          // wait the short continue, not the full recheck.
          ? (_shouldDefer ? _deferredRecheck : _continueDelay)
          : (incomplete && !failed
              ? _continueDelay
              : mirrorSyncDelay(_failures));

      _log.log(
        'pass.end',
        defer
            ? 'Sync pass held back.'
            : failed
                ? 'Sync pass finished with problems.'
                : incomplete
                    ? 'Sync pass finished a part; more to fetch.'
                    : 'Sync pass finished.',
        level: failed ? SyncLogLevel.error : SyncLogLevel.info,
        fields: {
          'trigger': trigger,
          'deferred': defer,
          'incomplete': incomplete,
          'uploaded': uploaded,
          'downloaded': downloaded,
          'elapsedMs': DateTime.now().difference(startedAt).inMilliseconds,
          // How late a one-second timer ran during this pass. The number that
          // separates "the connection was contended" from "this app's own
          // event loop was blocked and could not read the socket" — two
          // failures that look identical from the outside and have nothing in
          // common. Single digits are healthy; seconds mean the loop is the
          // problem and no network change will help.
          'loopLateMs': loopLate.inMilliseconds,
          'consecutiveFailures': _failures,
          'nextAttemptInSec': next.inSeconds,
          'uploadError': _status.uploadError?.toString(),
          'downloadError': _status.downloadError?.toString(),
        },
      );

      // A null timer means disconnect() ran while this pass was in the air, and
      // a disconnected engine must not quietly keep syncing.
      if (!_closed && _timer != null) _schedule(next);
    }
  }

  /// Runs `search.py --pull-only` through the bridge and reports whether it
  /// changed anything this machine reads.
  ///
  /// Never throws and never fails the pass: the pipeline reports its own
  /// problems on stdout, which goes to the sync log, and a machine without
  /// the pipeline (nothing to run) is noted once and left alone. A manual
  /// sync forces the pull past the pipeline's own freshness window.
  Future<bool> _pullScraped(String trigger) async {
    final pipeline = _pipeline;
    if (pipeline == null || _pipelineAbsent) return false;
    final force = trigger == 'manual' || _scrapedHint;
    _scrapedHint = false;
    final outcome = await pipeline.pullShared(force: force);
    if (!outcome.ran) {
      _pipelineAbsent = true;
      _log.log(
        'pull.pipeline.absent',
        'The Python pipeline is not on this machine; scraped data will not '
            'be pulled until it is.',
        level: SyncLogLevel.warn,
      );
      return false;
    }
    final changed = _pipelinePullChanged(outcome.output);
    _log.log(
      outcome.succeeded ? 'pull.pipeline' : 'pull.pipeline.failed',
      outcome.succeeded
          ? 'Pulled the shared catalog through the pipeline.'
          : 'The pipeline pull did not finish cleanly.',
      level: outcome.succeeded ? SyncLogLevel.info : SyncLogLevel.warn,
      fields: {'changed': changed, 'tail': _tail(outcome.output)},
    );
    return changed;
  }

  /// Whether a `--pull-only` run brought anything down, read off the two
  /// lines `search.py` prints for exactly this purpose:
  /// `Catalog: N new segment(s)` and `Objects: N applied, …`. A skipped pull
  /// (inside the freshness window) prints neither and reads as unchanged.
  static bool _pipelinePullChanged(String output) {
    final catalog = RegExp(r'Catalog: (\d+) new segment').firstMatch(output);
    final objects = RegExp(r'Objects: (\d+) applied').firstMatch(output);
    final segments = int.tryParse(catalog?.group(1) ?? '') ?? 0;
    final applied = int.tryParse(objects?.group(1) ?? '') ?? 0;
    return segments > 0 || applied > 0;
  }

  static String _tail(String output) {
    final lines = output.trim().split('\n');
    return lines.length <= 4
        ? output.trim()
        : lines.sublist(lines.length - 4).join('\n');
  }

  /// Arms the next automatic pass, replacing whatever was scheduled.
  void _schedule(Duration delay) {
    _timer?.cancel();
    _timer = Timer(delay, () => unawaited(_tick('schedule')));
  }

  void _emit(SyncSnapshot snapshot) {
    _status = snapshot;
    if (!_controller.isClosed) _controller.add(snapshot);
  }
}

/// Measures how late a steady one-second timer runs while a pass is in flight.
///
/// Here to settle a question that cost a long investigation and could not be
/// answered from the logs as they stood. When a download stalls inside the app
/// while the very same request from another process on the same machine
/// finishes in half a second, there are two candidates — the connection is
/// contended, or this app's event loop is too blocked to drain the socket —
/// and they need opposite fixes. A timer that keeps good time during a stalled
/// pass rules the second one out; one running seconds late proves it.
///
/// One timer per pass, cancelled with it.
class _Heartbeat {
  _Heartbeat._(this._startedAt);

  static const _period = Duration(seconds: 1);

  final DateTime _startedAt;
  Timer? _timer;
  int _ticks = 0;
  Duration _worst = Duration.zero;

  static _Heartbeat start() {
    final beat = _Heartbeat._(DateTime.now());
    beat._timer = Timer.periodic(_period, (_) {
      beat._ticks++;
      // Measured against when this tick was due from the start rather than
      // from the last one, so a series of small delays shows up as the drift
      // it is instead of being reset away each time.
      final due = beat._startedAt.add(_period * beat._ticks);
      final late = DateTime.now().difference(due);
      if (late > beat._worst) beat._worst = late;
    });
    return beat;
  }

  Duration stop() {
    _timer?.cancel();
    _timer = null;
    return _worst;
  }
}

/// Field-by-field updates on an immutable snapshot.
///
/// The two `clear` flags exist because `null` already means "no error" and a
/// named argument left off already means "leave it alone" — without them there
/// is no way to say "this succeeded, forget the last failure".
extension on SyncSnapshot {
  SyncSnapshot copyWith({
    bool? connected,
    bool? connecting,
    bool? downloading,
    bool? uploading,
    bool? hasSynced,
    DateTime? lastSyncedAt,
    int? dataRevision,
    Object? uploadError,
    Object? downloadError,
    Object? localError,
    String? deferredReason,
    bool clearUploadError = false,
    bool clearDownloadError = false,
    bool clearLocalError = false,
    bool clearDeferred = false,
  }) {
    return SyncSnapshot(
      connected: connected ?? this.connected,
      connecting: connecting ?? this.connecting,
      downloading: downloading ?? this.downloading,
      uploading: uploading ?? this.uploading,
      hasSynced: hasSynced ?? this.hasSynced,
      lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
      dataRevision: dataRevision ?? this.dataRevision,
      uploadError: clearUploadError ? null : (uploadError ?? this.uploadError),
      downloadError:
          clearDownloadError ? null : (downloadError ?? this.downloadError),
      localError: clearLocalError ? null : (localError ?? this.localError),
      deferredReason:
          clearDeferred ? null : (deferredReason ?? this.deferredReason),
    );
  }
}
