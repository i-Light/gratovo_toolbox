import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/local_db/local_db.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/email_library_schema.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/sqlite_email_library_repository.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/unavailable_email_library_repository.dart';
import 'package:gratovo_toolbox/data/repositories/email_library_repository.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';

/// The Email Critique Library's wiring, kept out of `repository_providers.dart`
/// deliberately.
///
/// That file's whole job is choosing between Supabase, the local mirror and
/// the mocks — three ways of reaching the *team's* database. This repository
/// reaches none of them, so putting it there would mean explaining, on every
/// read of that file, why one provider does not follow the rule the rest of it
/// exists to state.

/// The open `data/database/email_library.db`, or null when this machine has
/// none.
///
/// **Why the project folder and not the app support folder.** The mirror lives
/// in the support folder because nothing but the app has any business reading a
/// cache. This file is the opposite: the entire point of collecting critiques
/// is that `pipeline/tools/email_library.py` reads them back out for whoever
/// sharpens the drafting skills. Sitting beside `gratovo.db`
/// is what makes that a one-line script rather than a path-discovery problem.
///
/// The path follows Settings → Search Tuning → "Project root" for the same
/// reason every other `data/` read does — see
/// `PythonEnvironmentSettings.projectRootOverride`.
final emailLibraryDbProvider = Provider<LocalDb?>((ref) {
  final root = ref.watch(
    pythonEnvironmentProvider.select((env) => env.projectRootOverride.trim()),
  );
  final paths = ScraperProcess.resolvePaths(
    projectRootOverride: root.isEmpty ? null : root,
  );
  // Null on web — `resolvePaths` is the same "is there a project folder here
  // at all?" check `LocalSearchRepository` makes, and the answer there is no.
  if (paths == null) return null;

  final db = openLocalDb(
    directory: paths.databaseDir,
    spec: emailLibrarySpec,
  );
  // Riverpod disposes this provider when the project root changes, which is
  // exactly when the old handle must be closed before the new path is opened.
  ref.onDispose(() => db?.close());
  return db;
});

/// The single seam every screen and controller goes through.
///
/// Swapping in a shared implementation later is a change to these four lines
/// and nowhere else — see `EmailLibraryRepository`'s doc comment.
final emailLibraryRepositoryProvider = Provider<EmailLibraryRepository>((ref) {
  final db = ref.watch(emailLibraryDbProvider);
  if (db == null) return const UnavailableEmailLibraryRepository();
  return SqliteEmailLibraryRepository(db);
});
