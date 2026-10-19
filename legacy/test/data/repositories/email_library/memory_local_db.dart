import 'package:gratovo_toolbox/core/local_db/local_db_types.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/email_library_schema.dart';
import 'package:sqlite3/sqlite3.dart';

/// A real, in-memory SQLite database carrying the Email Critique Library's real schema.
///
/// Same reasoning as `test/data/repositories/mirror/memory_mirror.dart`: the
/// thing worth testing in the repository is the SQL, and an upsert, a cascade
/// delete and a multi-tag AND filter are each something that can be subtly
/// wrong in a way no type checker catches and no hand-written fake reproduces.
///
/// The schema comes from [emailLibrarySpec] — the same migration list the real
/// opener runs — so a test cannot pass against a table the app does not have.
class MemoryLocalDb implements LocalDb {
  MemoryLocalDb() : _db = sqlite3.openInMemory() {
    // Foreign keys are ON in production (see local_db_io.dart) and the cascade
    // from records to their tag rows depends on it, so a test database with
    // them off would quietly test something else.
    _db.execute('PRAGMA foreign_keys = ON');
    for (final migration in emailLibrarySpec.migrations) {
      _db.execute(migration);
    }
  }

  final Database _db;

  @override
  List<Map<String, Object?>> select(
    String sql, [
    List<Object?> parameters = const [],
  ]) {
    return [
      for (final row in _db.select(sql, parameters))
        Map<String, Object?>.from(row),
    ];
  }

  @override
  void execute(String sql, [List<Object?> parameters = const []]) {
    _db.execute(sql, parameters);
  }

  @override
  void transaction(void Function() body) {
    _db.execute('BEGIN');
    try {
      body();
      _db.execute('COMMIT');
    } catch (_) {
      _db.execute('ROLLBACK');
      rethrow;
    }
  }

  @override
  void close() => _db.close();
}
