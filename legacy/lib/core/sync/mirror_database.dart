import 'dart:isolate';

import 'package:gratovo_toolbox/core/sync/mirror_schema.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine_types.dart';
import 'package:sqlite3/sqlite3.dart';

/// The local database, as a file on disk — `data/database/gratovo.db`, the
/// same file the Python pipeline reads and writes.
///
/// Implements [LocalSyncDb] — the two-method view the repositories get — and
/// adds the handful of operations only the puller and the outbox need. Keeping
/// those off the interface is what stops a repository from starting to depend
/// on how the sync works, which is the property that keeps the web build
/// compiling and the repository tests runnable against a plain in-memory
/// database.
///
/// Holds the connection open for the app's lifetime, because the influencer
/// list queries it on every keystroke. The pipeline opens the same file from
/// its own process; WAL mode lets both read while one writes, and the busy
/// timeout makes a second writer wait rather than fail.
class MirrorDatabase implements LocalSyncDb, OffThreadReads {
  MirrorDatabase._(this._db, this.path);

  final Database _db;

  final String path;

  /// How long a write waits for the other process to let go of the file.
  ///
  /// The same figure as the pipeline's `BUSY_TIMEOUT_MS`: a search run commits
  /// a batch every few seconds and holds the write lock for milliseconds, so
  /// a wait this long only ever surfaces a genuine deadlock, never ordinary
  /// contention.
  static const _busyTimeoutMs = 15000;

  /// Opens (creating if needed) the database at [path] and brings the
  /// app-owned tables up to [kAppSchemaVersion].
  ///
  /// Never deletes or rebuilds the file. It is shared with the pipeline and
  /// holds unsent local work; the answer to "written by a different version"
  /// is the forward-only migration list in `mirror_schema.dart`.
  ///
  /// Throws on a failure to open. The caller in `mirror_engine_io.dart`
  /// catches it and reports it in Settings; without a local database the app
  /// has nothing to show.
  static MirrorDatabase open(String path) {
    final db = sqlite3.open(path);
    try {
      _applyPragmas(db);
      // Bookkeeping first, so the version can be read; then everything, every
      // statement guarded; then whatever the stored version is missing.
      db.execute(kMirrorBookkeepingDdl);
      _pruneRetiredMeta(db);

      final stored = _readMeta(db, MirrorMetaKeys.schemaVersion);
      final version = stored == null ? 0 : (int.tryParse(stored) ?? 0);

      db.execute(kAppSchemaTablesDdl);
      for (var v = version + 1; v <= kAppSchemaVersion; v++) {
        for (final statement in kAppSchemaMigrations[v] ?? const <String>[]) {
          try {
            db.execute(statement);
          } on SqliteException catch (error) {
            // The one shape allowed here is `ALTER TABLE ADD COLUMN`, which
            // SQLite refuses on a column that is already there. Same idiom as
            // the pipeline's `init_db`.
            if (!error.message.contains('duplicate column')) rethrow;
          }
        }
      }
      // Last: the view reads columns the migrations may just have added.
      db.execute(kInfluencerChannelsViewDdl);
      _writeMeta(db, MirrorMetaKeys.schemaVersion, '$kAppSchemaVersion');

      return MirrorDatabase._(db, path);
    } catch (_) {
      db.close();
      rethrow;
    }
  }

  /// WAL so a long download does not block the reads the list is making while
  /// it runs, and so the pipeline's process can write while this one reads.
  /// NORMAL rather than FULL synchronous: the worst a power cut can cost this
  /// file is the last few milliseconds of commits, all of which are either
  /// re-downloadable or still in the outbox.
  static void _applyPragmas(Database db) {
    db.execute('PRAGMA journal_mode = WAL');
    db.execute('PRAGMA synchronous = NORMAL');
    db.execute('PRAGMA busy_timeout = $_busyTimeoutMs');
    // The pipeline's tables carry foreign keys to each other; this side never
    // writes those tables in a way that would violate them, and enforcing them
    // here would make the pipeline's cascade order this file's problem.
    db.execute('PRAGMA foreign_keys = OFF');
  }

  @override
  Future<List<Map<String, Object?>>> getAll(
    String sql, [
    List<Object?> parameters = const [],
  ]) async {
    final result = _db.select(sql, parameters);
    // Copied out of the `ResultSet` rather than handed over as-is: its rows are
    // views onto shared column-name storage, and a caller that held one after
    // the next query would be reading whatever came back next.
    return [for (final row in result) Map<String, Object?>.from(row)];
  }

  /// One read on a fresh isolate over its own read-only connection to the
  /// same file. WAL lets it read beside this connection (and the pipeline's
  /// writes), and it sees everything committed before it started.
  ///
  /// A new isolate and connection per call rather than a standing reader: it
  /// costs a few milliseconds, which only the reads that take hundreds opt
  /// into, and leaves nothing to keep alive or shut down.
  @override
  Future<List<Map<String, Object?>>> readOffThread(
    String sql, [
    List<Object?> parameters = const [],
  ]) {
    final path = this.path;
    final params = List<Object?>.of(parameters);
    return Isolate.run(() {
      final db = sqlite3.open(path, mode: OpenMode.readOnly);
      try {
        db.execute('PRAGMA busy_timeout = $_busyTimeoutMs');
        final result = db.select(sql, params);
        return [for (final row in result) Map<String, Object?>.from(row)];
      } finally {
        db.close();
      }
    }, debugName: 'mirror-read');
  }

  @override
  Future<void> execute(
    String sql, [
    List<Object?> parameters = const [],
  ]) async {
    executeSync(sql, parameters);
  }

  /// The same write, without the `Future` the interface has to return, for
  /// a caller inside [transactionSync] whose callback must stay synchronous.
  void executeSync(String sql, [List<Object?> parameters = const []]) {
    _db.execute(sql, parameters);
  }

  @override
  Future<void> transaction(void Function(LocalSyncTx tx) body) async {
    final tx = SqliteSyncTx(_db);
    transactionSync(() => body(tx));
  }

  // -------------------------------------------------------------------------
  // Beyond the interface: what the puller and the outbox need.
  // -------------------------------------------------------------------------

  /// Runs [body] inside one transaction, rolling back if it throws.
  ///
  /// Synchronous on purpose: allowing an `await` in the middle of a
  /// transaction would let a second write interleave into it. 500 separate
  /// inserts are 500 fsyncs, and 500 inserts in a transaction is one.
  void transactionSync(void Function() body) {
    _db.execute('BEGIN');
    try {
      body();
      _db.execute('COMMIT');
    } catch (_) {
      try {
        _db.execute('ROLLBACK');
      } catch (_) {}
      rethrow;
    }
  }

  /// A prepared statement, for the insert a page runs once per row.
  /// Callers must dispose it.
  PreparedStatement prepare(String sql) => _db.prepare(sql);

  String? readMeta(String key) => _readMeta(_db, key);

  void writeMeta(String key, String? value) => _writeMeta(_db, key, value);

  /// Empties every PULLED table, leaving `_outbox`, unsent log entries and the
  /// pipeline's tables alone.
  ///
  /// For the one case a delta cannot recover from: a client whose tombstone
  /// cursor has fallen behind the server's purge horizon. Unsent edits
  /// survive, because the server can resend a deal and nothing can resend an
  /// edit that only exists here.
  void wipeData() {
    transactionSync(() {
      for (final table in kAppPulledTables) {
        _db.execute('DELETE FROM $table');
      }
      _db.execute('DELETE FROM activity_log WHERE synced = 1');
      _db.execute(
        "DELETE FROM _sync_meta WHERE key LIKE 'cursor.%' "
        'OR key IN (?, ?)',
        [MirrorMetaKeys.hasSynced, MirrorMetaKeys.lastSyncedAt],
      );
    });
  }

  void close() => _db.close();

  /// Drops the `_sync_meta` rows [kMirrorRetiredMetaKeyPatterns] describes.
  static void _pruneRetiredMeta(Database db) {
    for (final pattern in kMirrorRetiredMetaKeyPatterns) {
      db.execute('DELETE FROM _sync_meta WHERE key LIKE ?', [pattern]);
    }
  }

  static String? _readMeta(Database db, String key) {
    final rows = db.select('SELECT value FROM _sync_meta WHERE key = ?', [key]);
    if (rows.isEmpty) return null;
    return rows.first['value'] as String?;
  }

  static void _writeMeta(Database db, String key, String? value) {
    if (value == null) {
      db.execute('DELETE FROM _sync_meta WHERE key = ?', [key]);
      return;
    }
    db.execute(
      'INSERT INTO _sync_meta (key, value) VALUES (?, ?) '
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }
}

/// A [LocalSyncTx] over a `package:sqlite3` connection — what [MirrorDatabase]
/// hands a transaction body, and what the in-memory test database hands its
/// own, so the two run identical SQL.
class SqliteSyncTx implements LocalSyncTx {
  const SqliteSyncTx(this._db);

  final Database _db;

  @override
  List<Map<String, Object?>> select(
    String sql, [
    List<Object?> parameters = const [],
  ]) {
    final result = _db.select(sql, parameters);
    return [for (final row in result) Map<String, Object?>.from(row)];
  }

  @override
  void execute(String sql, [List<Object?> parameters = const []]) {
    _db.execute(sql, parameters);
  }
}
