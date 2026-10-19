/// The shape of the local-first mirror, with no mention of how it syncs.
///
/// Everything above this line — the repositories, the providers, the widgets —
/// depends on these types and never on `package:sqlite3`. That is what keeps
/// the web build compiling: the FFI-backed implementation reaches the app only
/// through `sync_engine.dart`'s conditional export, exactly the pattern
/// `core/native/local_pipeline_db.dart` and `core/images/image_store.dart`
/// already use for `sqlite3` and `path_provider`.
///
/// This file did not change when PowerSync was replaced by the app's own
/// puller and outbox, which is the whole reason it exists: the two-method seam
/// meant swapping the entire sync mechanism touched nothing above it.
///
/// It is also what makes the sync-backed repositories testable. A test can
/// implement [LocalSyncDb] over a plain in-memory SQLite database and exercise
/// the real SQL, which is the part that can actually be wrong.
library;

import 'package:gratovo_toolbox/core/sync/sync_diagnostics.dart';

export 'package:gratovo_toolbox/core/sync/sync_diagnostics.dart';

/// The slice of a local SQLite connection the repositories need.
///
/// Three methods, deliberately. Batches and change streams exist on the real
/// database and are not used: the UI refreshes by invalidating a provider the
/// way it already does for the network repositories. [transaction] is here
/// because one caller genuinely needs it — the archive sweep, which used to
/// auto-commit eight statements per channel and read as a hung app for a few
/// thousand of them.
abstract class LocalSyncDb {
  Future<List<Map<String, Object?>>> getAll(
    String sql, [
    List<Object?> parameters = const [],
  ]);

  Future<void> execute(String sql, [List<Object?> parameters = const []]);

  /// Runs [body] as one transaction: every statement it issues through [tx]
  /// is committed together, or rolled back together if it throws.
  ///
  /// [body] is synchronous on purpose. The connection is the UI isolate's,
  /// and an `await` inside an open transaction would let any other write on
  /// this isolate interleave into it. Fifty rows of eight statements each are
  /// one fsync this way and four hundred the other.
  Future<void> transaction(void Function(LocalSyncTx tx) body);
}

/// A database that can answer a read on another isolate.
///
/// The connection behind [LocalSyncDb] lives on the UI isolate and SQLite is
/// synchronous FFI, so a read that takes half a second is half a second with
/// no frames. Most reads here take a millisecond and are better where they
/// are; the few that scan a whole table (the dashboard's analytics and the
/// keyword view samples, measured at 340 and 500 ms on a real 1.2 GB
/// database) opt in through [LocalSyncDbReads.getAllOffThread].
abstract interface class OffThreadReads {
  Future<List<Map<String, Object?>>> readOffThread(
    String sql, [
    List<Object?> parameters,
  ]);
}

extension LocalSyncDbReads on LocalSyncDb {
  /// [LocalSyncDb.getAll], answered on a background isolate when this
  /// database can do that, and on the calling one otherwise (a test's
  /// in-memory database, the network fallback).
  ///
  /// Only for reads that do not need to see this connection's own open
  /// transaction -- a separate connection sees what has been committed.
  Future<List<Map<String, Object?>>> getAllOffThread(
    String sql, [
    List<Object?> parameters = const [],
  ]) {
    final self = this;
    return self is OffThreadReads
        ? (self as OffThreadReads).readOffThread(sql, parameters)
        : getAll(sql, parameters);
  }
}

/// The same connection, inside a [LocalSyncDb.transaction].
abstract class LocalSyncTx {
  List<Map<String, Object?>> select(
    String sql, [
    List<Object?> parameters = const [],
  ]);

  void execute(String sql, [List<Object?> parameters = const []]);
}

/// What the mirror is doing right now, for the status strip in Settings.
///
/// Deliberately not an enum. "Connected" and "has ever finished a sync" are
/// different facts and the honest answers differ: a machine that has never
/// synced and one that synced an hour ago and is now offline both read as
/// disconnected, and only one of them has data worth trusting.
class SyncSnapshot {
  const SyncSnapshot({
    this.connected = false,
    this.connecting = false,
    this.downloading = false,
    this.uploading = false,
    this.hasSynced = false,
    this.lastSyncedAt,
    this.dataRevision = 0,
    this.uploadError,
    this.downloadError,
    this.localError,
    this.deferredReason,
  });

  final bool connected;
  final bool connecting;
  final bool downloading;
  final bool uploading;

  /// Why the download is being held back, or null when it is not.
  ///
  /// Not an error, and shown as neither: a search run and the mirror both want
  /// the same connection, and a search run is what the person is standing
  /// there waiting for. Downloading a page of channels underneath it fails —
  /// measurably, every page size, every time — and takes bandwidth from the
  /// run while it does. Holding off and saying so is both the honest status
  /// and the faster one.
  final String? deferredReason;

  bool get deferred => deferredReason != null;

  /// Whether a first full sync has ever completed on this machine. Until it
  /// has, an empty list means "not downloaded yet", not "no channels".
  final bool hasSynced;

  final DateTime? lastSyncedAt;

  /// Bumped once per pull that actually wrote rows.
  ///
  /// This is how a download reaches the rest of the app. Everything above the
  /// mirror re-reads on a change announcement rather than by polling, and until
  /// this existed a pull was invisible to all of it: on a machine running
  /// local-first, a teammate's channels landed in the file on disk and every
  /// open screen went on showing what it had read hours earlier.
  ///
  /// Deliberately not [lastSyncedAt]. That moves on every successful pull,
  /// including the overwhelmingly common one that found nothing new, and
  /// re-reading every list in the app on a timer that says "nothing changed" is
  /// the cost this whole design exists to avoid.
  final int dataRevision;

  /// Kept rather than logged and dropped, for the same reason [SupabaseBoot]
  /// keeps its error: "offline" and "your token was rejected" look identical
  /// to a user and need very different fixes.
  final Object? uploadError;
  final Object? downloadError;

  /// Set when the local copy ITSELF stopped working — a corrupt file, a full
  /// disk, a handle closed underneath a read — as opposed to the server being
  /// unreachable, which is what the two errors above mean.
  ///
  /// The distinction decides where the app reads from, which is why it is a
  /// third field rather than folded into [downloadError]. A server that cannot
  /// be reached leaves the mirror as the best copy there is and the app should
  /// keep reading it. A mirror that cannot be read leaves the server as the
  /// best copy there is, and [localUsable] going false is what moves every
  /// repository back onto it — the same state the app runs in before a first
  /// sync finishes, on the web build, and with the mirror switched off.
  ///
  /// Cleared by the next sync pass that reads and writes the file successfully,
  /// so a one-off — a lock held by an antivirus scan, a momentarily full disk
  /// — costs a few minutes of network reads rather than the rest of the
  /// session.
  final Object? localError;

  /// Whether the local copy is safe to read from.
  bool get localUsable => localError == null;

  /// Whether anything at all is wrong, local or remote. What the sync button's
  /// error color and the Settings row read.
  bool get hasError =>
      uploadError != null || downloadError != null || localError != null;
}

/// A running local-first mirror.
///
/// Opened once at launch and closed when the app exits. [connect] and
/// [disconnect] follow the session rather than the process: the database is
/// readable while signed out (that is the whole point of a local copy), but
/// nothing replicates without a token.
abstract class SyncEngine {
  /// The local database the sync-backed repositories read and write.
  LocalSyncDb get db;

  /// What the sync has actually been doing, kept on this machine.
  ///
  /// On the interface rather than tucked away in the engine because the whole
  /// point of it is to be readable by somebody who is not debugging with a
  /// console attached — Settings shows it, and a person can copy it into a
  /// message. See [SyncDiagnostics].
  SyncDiagnostics get diagnostics;

  SyncSnapshot get status;

  Stream<SyncSnapshot> get statusStream;

  /// Starts replicating. Safe to call when already connected.
  Future<void> connect();

  /// Runs one upload-then-download pass immediately, outside the regular
  /// interval, and reschedules the next automatic tick from now.
  ///
  /// Exists because the interval is a trade against staleness someone can
  /// live with while waiting, not a ceiling on how fresh the data can be —
  /// the "update from server" button in the app chrome calls this so a
  /// person who wants this instant does not have to wait out the interval.
  /// A no-op while disconnected (signed out, or never connected).
  ///
  /// Always runs, even while [setBusy] is holding downloads back — see that
  /// method's doc comment for why an explicit ask overrides it. A caller that
  /// is not a person pressing a button — anything automatic, however
  /// well-meaning — must use [catchUp] instead, or it defeats the entire
  /// point of [setBusy].
  Future<void> syncNow();

  /// Asks for a pass sooner than the regular interval, the way [syncNow]
  /// does, but — unlike it — still defers while [setBusy] is holding
  /// downloads back.
  ///
  /// For `MirrorCatchUp`-shaped callers (`core/sync/sync_providers.dart`):
  /// something on this machine
  /// noticed fresher data might exist (a keyword the search just finished, a
  /// realtime push) and wants the mirror to catch up soon rather than wait
  /// out the regular interval. That is a *courtesy*, not a person asking on
  /// purpose, and it used to call [syncNow] — which meant every keyword a
  /// search finished fired a download attempt that ignored the very flag the
  /// search had just set to stop that from happening. One busy stretch was
  /// enough to turn a handful of keywords into an unbroken chain of two-minute
  /// timeouts for the entire length of the run, each one competing with the
  /// search for the same connection it was already told to leave alone.
  ///
  /// [scraped] forces the pipeline's own pull past its freshness window,
  /// for a catch-up triggered by a teammate sharing search results.
  Future<void> catchUp({bool scraped = false});

  /// Tells the engine that something else on this machine is using the
  /// connection heavily, so it should not try to download over the top.
  ///
  /// The mirror and the Python scraper are two halves of one app competing for
  /// one connection, and the log showed exactly how that ends: the last clean
  /// sync finished at 13:05:46, a search run started at 13:05:45, and every
  /// pass after it timed out at every page size while single-row requests kept
  /// answering in under a second. The engine cannot see the run, so the run
  /// tells it.
  ///
  /// Advisory, not a lock. An explicit [syncNow] still runs, and the engine
  /// stops honouring this after a while on its own rather than let a long
  /// afternoon of searching leave the mirror indefinitely stale.
  void setBusy({required bool busy, String? reason});

  /// Stops replicating and keeps the local data.
  Future<void> disconnect();

  /// Stops replicating and forgets this session's pull cursors, keeping every
  /// row and every unsent edit. Called on sign-out.
  ///
  /// The file is this machine's working copy, shared with the pipeline, and
  /// nothing about signing out makes it somebody else's to delete. What a
  /// sign-out must not leave behind is a watermark: the next account to sign
  /// in starts with a full pull of the (small) typed-in tables rather than a
  /// delta from a stranger's cursor.
  Future<void> forgetSession();

  /// Fires once per upload pass that changed something on the server, with
  /// the server tables it touched. The live data service turns each event
  /// into one Broadcast message so every other open app catches up.
  Stream<Set<String>> get uploadedTables;

  Future<void> close();
}
