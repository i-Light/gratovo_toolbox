import 'package:gratovo_toolbox/core/local_db/local_db_types.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_schema.dart';
import 'package:sqlite3/sqlite3.dart';

/// A real, in-memory SQLite database carrying the Skills page's real schema —
/// the same idea as `memory_local_db.dart` beside the email library tests: the
/// SQL (an upsert, a cascade, a migration) is what is worth testing, and the
/// schema comes from [skillsLibrarySpec], so a test cannot pass against a table
/// the app does not have.
class MemorySkillsDb implements LocalDb {
  /// Opens the database with the first [migrationCount] migrations applied
  /// (all of them by default). A smaller number is a file written by an older
  /// build; [migrate] then plays the upgrade the real opener would.
  MemorySkillsDb({int? migrationCount}) : _db = sqlite3.openInMemory() {
    // Foreign keys are ON in production (see local_db_io.dart) and the cascade
    // from a deck to its gem setup depends on it.
    _db.execute('PRAGMA foreign_keys = ON');
    final count = migrationCount ?? skillsLibrarySpec.migrations.length;
    for (final migration in skillsLibrarySpec.migrations.take(count)) {
      _db.execute(migration);
    }
    _db.execute('PRAGMA user_version = $count');
  }

  final Database _db;

  /// Runs whichever migrations this file has not run yet, as the real opener
  /// does when an older file meets a newer build.
  void migrate() {
    final from = _db.userVersion;
    for (final migration in skillsLibrarySpec.migrations.skip(from)) {
      _db.execute(migration);
    }
    _db.execute('PRAGMA user_version = ${skillsLibrarySpec.version}');
  }

  int get userVersion => _db.userVersion;

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
