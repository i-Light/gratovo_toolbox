import 'dart:io';

import 'package:gratovo_toolbox/core/native/local_pipeline_db_types.dart';
import 'package:sqlite3/sqlite3.dart';

export 'package:gratovo_toolbox/core/native/local_pipeline_db_types.dart';

/// Reads `data/database/gratovo.db` directly -- store.py's own doc comment
/// explicitly designs for this ("WAL mode is enabled so another process (a
/// future dashboard, a Flutter app, etc.) can read the database at any
/// time -- including mid-run -- without waiting for this script to finish
/// or blocking the writer"), so this isn't reaching into a file that isn't
/// meant to be read this way.
///
/// Every method opens a short-lived, read-only connection and disposes it
/// immediately after one query -- simpler and safer than holding a
/// long-lived handle open for the whole app session, and cheap enough for
/// how infrequently this gets polled (see the search screen's progress
/// panel, which re-reads this every few seconds while a run is active, not
/// on every frame). Every method also swallows any error (missing file,
/// locked file, corrupt file, a schema this version of the app doesn't
/// recognize) and returns null/empty rather than throwing -- a progress
/// panel that can't read the DB yet (most commonly: no run has ever
/// started) is a normal, expected state, not an error condition worth
/// surfacing to the user.
class LocalPipelineDb {
  const LocalPipelineDb._();

  /// The most recent *keyword search* in `runs`, or null if there has never
  /// been one on this machine.
  ///
  /// Not simply the newest row, and that distinction is the whole reason this
  /// method reads more than one. `runs` holds every job the pipeline runs, and
  /// two of them are unattended: the background video catch-up, which opens a
  /// row of its own on nearly every app launch and can hold it for the better
  /// part of an hour, and `tools/unarchive_and_enrich.py`. Reading the newest
  /// row meant the app reported a maintenance sweep as a search — a spinner
  /// and "Starting the pipeline…" on a page nobody had pressed Start on — and,
  /// once that sweep ended, meant the last real search's summary was gone.
  static LocalRunProgress? readLatestSearchRun(String dbPath) {
    if (!File(dbPath).existsSync()) return null;
    Database? db;
    try {
      db = sqlite3.open(dbPath, mode: OpenMode.readOnly);
      // A window rather than one row, because the searches are what is being
      // looked for and the unattended jobs are what sits on top of them. Fifty
      // is far more than enough in practice: those jobs open one row per app
      // launch, and this is only consulted between searches anyway.
      //
      // `SELECT *` rather than a column list because of `kind`, which store.py
      // adds by migration: a database last written by an older pipeline has no
      // such column, and naming it would turn every read on that machine into
      // a caught error and a panel that says nothing at all. Reading the whole
      // row and looking for the key takes the new fact where it exists without
      // making it a requirement.
      final rows =
          db.select('SELECT * FROM runs ORDER BY run_id DESC LIMIT 50');
      for (final row in rows) {
        final progress = _progressFrom(row);
        if (progress.isSearch) return progress;
      }
      return null;
    } catch (_) {
      return null;
    } finally {
      db?.close();
    }
  }

  /// Every keyword ever queued on this machine or synced in from a
  /// teammate's -- store.py's `keywords` table, which (unlike `runs`) sync.py
  /// does push and pull, so after a sync this is the whole team's history,
  /// not just this machine's own. Empty (never an error) if the database or
  /// the table isn't there yet -- a fresh checkout with no run yet.
  static List<String> readAllKeywords(String dbPath) {
    if (!File(dbPath).existsSync()) return const [];
    Database? db;
    try {
      db = sqlite3.open(dbPath, mode: OpenMode.readOnly);
      final rows = db.select('SELECT keyword FROM keywords');
      return [for (final row in rows) row['keyword'] as String];
    } catch (_) {
      return const [];
    } finally {
      db?.close();
    }
  }

  static LocalRunProgress _progressFrom(Row row) {
    return LocalRunProgress(
      runId: row['run_id'] as int,
      startedAt: row['started_at'] as String,
      finishedAt: row['finished_at'] as String?,
      status: row['status'] as String,
      keywordsTotal: row['keywords_total'] as int,
      keywordsDone: row['keywords_done'] as int,
      channelsUpserted: row['channels_upserted'] as int,
      videosUpserted: row['videos_upserted'] as int,
      kind: (row['kind'] as String?) ?? 'search',
    );
  }
}
