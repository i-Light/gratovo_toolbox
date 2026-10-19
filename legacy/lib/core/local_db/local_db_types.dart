/// The platform-independent half of the local-only database support (see
/// `local_db.dart`). No `dart:io` and no `package:sqlite3` in this file, so
/// everything that only needs to *speak SQL* — the repositories — compiles on
/// every platform this project targets, web included.
///
/// This exists for the same reason `core/sync/sync_engine_types.dart` does,
/// and is deliberately a much smaller idea than that one. The mirror is a
/// cache of a server; this is for data that has no server at all and lives
/// only on the machine that typed it.
library;

/// One local SQLite file, described declaratively.
///
/// [migrations] is the whole schema history, in order: element 0 creates the
/// first version, element 1 upgrades that to the second, and so on. The
/// current version is therefore just `migrations.length`, and upgrading is
/// "run every script the file has not run yet" — recorded in SQLite's own
/// `user_version` pragma rather than a table of our own.
///
/// The contrast worth stating: the sync mirror deletes and recreates its file
/// on a version mismatch, which is right for a cache the server can refill.
/// Nothing can refill *this*, so a schema change must always be expressed as
/// an appended migration and existing rows must survive it. Never edit an
/// element that has already shipped — append a new one.
///
/// That covers a SCHEMA change. If instead a build needs to replace the file's
/// DATA — a re-generated `email_library.db` shipped in `pipeline_data_seed/`
/// that should supersede the copy each teammate already has — a migration
/// cannot do it (migrations evolve a schema, they do not swap contents). Add an
/// action naming the file to `data/reset_manifest.json`: the app then sets the
/// old copy aside on the next launch and the freshly seeded one takes its
/// place. See `lib/core/native/pipeline_reset.dart`.
class LocalDbSpec {
  const LocalDbSpec({required this.fileName, required this.migrations});

  /// The file's name inside the project's `data/` folder, e.g.
  /// `email_library.db`.
  final String fileName;

  /// Schema scripts, oldest first. Each runs inside one transaction.
  final List<String> migrations;

  int get version => migrations.length;
}

/// A handle on an open [LocalDbSpec] file.
///
/// Synchronous, because SQLite is: wrapping these in futures would only add
/// microtasks between a keystroke and the row it writes. Repositories built on
/// top still expose async methods, so a future implementation that is genuinely
/// asynchronous can replace one of them without touching a screen.
abstract class LocalDb {
  /// Rows as plain maps, safe to keep after the next query runs.
  List<Map<String, Object?>> select(String sql, [List<Object?> parameters]);

  void execute(String sql, [List<Object?> parameters]);

  /// Runs [body] in one transaction, rolling back if it throws.
  ///
  /// Synchronous on purpose — see [LocalDb]. An `await` inside a transaction
  /// would let an unrelated write interleave into it.
  void transaction(void Function() body);

  void close();
}
