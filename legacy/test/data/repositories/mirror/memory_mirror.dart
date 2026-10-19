import 'package:gratovo_toolbox/core/sync/mirror_database.dart';
import 'package:gratovo_toolbox/core/sync/mirror_schema.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine_types.dart';
import 'package:sqlite3/sqlite3.dart';

/// A real SQLite database with the local database's shape, for testing the
/// SQL.
///
/// The point of these tests is the SQL itself: nulls-last ordering under both
/// directions, a JSON array searched with `json_each`, the view over the
/// pipeline's table and the app's — every one of those is something that can
/// be subtly wrong in a way no type checker catches and no mock reproduces.
/// Running it against a genuine SQLite engine is the only check that means
/// anything.
///
/// The shape comes from [kAppSchemaDdl], the same constant the production
/// database applies (which includes the pipeline tables' bootstrap shape).
class MemoryMirror implements LocalSyncDb {
  MemoryMirror() : _db = sqlite3.openInMemory() {
    _db.execute(kAppSchemaDdl);
  }

  final Database _db;

  @override
  Future<List<Map<String, Object?>>> getAll(
    String sql, [
    List<Object?> parameters = const [],
  ]) async {
    final result = _db.select(sql, parameters);
    return [for (final row in result) Map<String, Object?>.from(row)];
  }

  @override
  Future<void> execute(
    String sql, [
    List<Object?> parameters = const [],
  ]) async {
    _db.execute(sql, parameters);
  }

  @override
  Future<void> transaction(void Function(LocalSyncTx tx) body) async {
    _db.execute('BEGIN');
    try {
      body(SqliteSyncTx(_db));
      _db.execute('COMMIT');
    } catch (_) {
      _db.execute('ROLLBACK');
      rethrow;
    }
  }

  /// What the repositories have queued for upload, oldest first.
  ///
  /// Exposed because the queue is now part of what a write means: a repository
  /// that updates the local row and forgets to enqueue looks correct to every
  /// read-back assertion and silently loses the edit on reconnect.
  Future<List<Map<String, Object?>>> outbox() =>
      getAll('SELECT seq, kind, payload FROM _outbox ORDER BY seq');

  void close() => _db.close();
}
