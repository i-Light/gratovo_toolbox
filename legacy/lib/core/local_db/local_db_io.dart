import 'dart:developer' as developer;
import 'dart:io';

import 'package:gratovo_toolbox/core/local_db/local_db_types.dart';
import 'package:sqlite3/sqlite3.dart';

export 'package:gratovo_toolbox/core/local_db/local_db_types.dart';

/// Opens (creating if needed) the local-only database [spec] describes, inside
/// [directory].
///
/// Returns null rather than throwing when it cannot be opened — a missing
/// folder, a file left corrupt by a hard power cut, a platform with no SQLite.
/// Callers treat null as "this machine has no local library", which the UI
/// reports as an empty state with an explanation, and the app keeps running.
/// Same contract as `openSyncEngine` in `core/sync/mirror_engine_io.dart`, for
/// the same reason: a launch screen with a stack trace on it is a much worse
/// failure than a page that says what is wrong.
LocalDb? openLocalDb({required String directory, required LocalDbSpec spec}) {
  final path = '$directory${Platform.pathSeparator}${spec.fileName}';
  Database? db;
  try {
    Directory(directory).createSync(recursive: true);
    db = sqlite3.open(path);
    // WAL so a long read cannot block a write and vice versa. FULL
    // synchronous, unlike the mirror's NORMAL: this file is the only copy of
    // what is in it, so the cost of an fsync per commit is one nobody should
    // be trading away.
    db.execute('PRAGMA journal_mode = WAL');
    db.execute('PRAGMA synchronous = FULL');
    db.execute('PRAGMA foreign_keys = ON');
    _migrate(db, spec);
    return _SqliteLocalDb(db, path);
  } catch (error, stackTrace) {
    db?.close();
    developer.log(
      'Could not open the local database ${spec.fileName}; the feature that '
      'reads it will show as unavailable.',
      name: 'gratovo.localdb',
      level: 1000,
      error: error,
      stackTrace: stackTrace,
    );
    return null;
  }
}

/// Runs whichever of [LocalDbSpec.migrations] this file has not run yet.
///
/// A file from a *newer* build than this one is left completely alone and
/// opened as-is. Refusing would strand somebody who ran a newer build once;
/// migrating backwards is not a thing SQL can do. In practice a newer schema
/// is additive, so the older build reads the columns it knows about.
void _migrate(Database db, LocalDbSpec spec) {
  final from = db.userVersion;
  if (from >= spec.version) return;

  db.execute('BEGIN');
  try {
    for (var i = from; i < spec.migrations.length; i++) {
      db.execute(spec.migrations[i]);
    }
    // Not a parameter: `PRAGMA user_version = ?` is not bindable in SQLite.
    // The value is an int from this file's own list length, never user input.
    db.execute('PRAGMA user_version = ${spec.version}');
    db.execute('COMMIT');
  } catch (_) {
    db.execute('ROLLBACK');
    rethrow;
  }
}

class _SqliteLocalDb implements LocalDb {
  _SqliteLocalDb(this._db, this.path);

  final Database _db;

  /// Kept for log messages — knowing *which* file failed is most of
  /// diagnosing why.
  final String path;

  @override
  List<Map<String, Object?>> select(
    String sql, [
    List<Object?> parameters = const [],
  ]) {
    final result = _db.select(sql, parameters);
    // Copied out of the ResultSet rather than handed over: its rows are views
    // onto shared column-name storage, so one held across the next query would
    // read whatever came back then.
    return [for (final row in result) Map<String, Object?>.from(row)];
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
