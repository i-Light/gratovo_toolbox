import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/local_db/local_db.dart';
import 'package:gratovo_toolbox/core/native/outreach_file_store.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_schema.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/sqlite_skills_library_repository.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/unavailable_skills_library_repository.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library_repository.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';

/// The Skills page's wiring, kept out of `repository_providers.dart` for the
/// same reason `email_library_providers.dart` is: that file chooses between
/// Supabase, the local mirror and the mocks for the *team's* database, and
/// this repository reaches none of them.

/// The open `data/database/skills_library.db`, or null when this machine has
/// none. Beside `gratovo.db`, not in the app support folder, so it survives
/// alongside the exported `.md` files it describes — same reasoning as
/// `emailLibraryDbProvider`.
final skillsLibraryDbProvider = Provider<LocalDb?>((ref) {
  final root = ref.watch(
    pythonEnvironmentProvider.select((env) => env.projectRootOverride.trim()),
  );
  final paths = ScraperProcess.resolvePaths(
    projectRootOverride: root.isEmpty ? null : root,
  );
  if (paths == null) return null;

  final db = openLocalDb(
    directory: paths.databaseDir,
    spec: skillsLibrarySpec,
  );
  ref.onDispose(() => db?.close());
  return db;
});

/// `data/gemini skills/`, where a group's combined markdown is exported —
/// the same folder `pipeline/gemini_bridge/actions.py` reads the keyword
/// generator and channel classifier skills from. Null on the same platforms
/// [skillsLibraryDbProvider] is.
final skillsExportDirProvider = Provider<String?>((ref) {
  final root = ref.watch(
    pythonEnvironmentProvider.select((env) => env.projectRootOverride.trim()),
  );
  final paths = ScraperProcess.resolvePaths(
    projectRootOverride: root.isEmpty ? null : root,
  );
  if (paths == null) return null;
  return '${paths.dataDir}/gemini skills';
});

/// The single seam every screen and controller goes through.
final skillsLibraryRepositoryProvider = Provider<SkillsLibraryRepository>(
  (ref) {
    final db = ref.watch(skillsLibraryDbProvider);
    if (db == null) return const UnavailableSkillsLibraryRepository();
    return SqliteSkillsLibraryRepository(db);
  },
);

/// `data/gemini skills/outreach/`, the folder the skill factory exported the
/// old Outreach skill into — found the same way as every other skill file,
/// under [skillsExportDirProvider]. Null where that is null. Only the email
/// library's bench import still reads it (`bench/latest.json`); the cards
/// deck went with decision old-files. Tests override this with an in-memory
/// folder.
final outreachFileStoreProvider = Provider<OutreachFileStore?>((ref) {
  final dir = ref.watch(skillsExportDirProvider);
  if (dir == null) return null;
  return openOutreachFileStore('$dir/outreach');
});
