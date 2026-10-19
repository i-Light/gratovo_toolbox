import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/skill_group.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_providers.dart';
import 'package:gratovo_toolbox/features/skills/application/skill_export.dart';
import 'package:gratovo_toolbox/features/skills/application/skill_import.dart';
import 'package:gratovo_toolbox/features/skills/application/skills_revision.dart';

/// The Skills page's top level: every group, alphabetically. One card deck
/// (`SkillGroupController`) is loaded per group only once it is opened.
class SkillsController extends AsyncNotifier<List<SkillGroup>> {
  @override
  Future<List<SkillGroup>> build() async {
    ref.watch(skillsRevisionProvider);
    final repo = ref.watch(skillsLibraryRepositoryProvider);
    return repo.listGroups();
  }

  Future<SkillGroup> createGroup(String name) async {
    final repo = ref.read(skillsLibraryRepositoryProvider);
    final group = await repo.createGroup(name);
    ref.read(skillsRevisionProvider.notifier).bump();
    return group;
  }

  Future<void> renameGroup(String id, String name) async {
    final repo = ref.read(skillsLibraryRepositoryProvider);
    await repo.renameGroup(id, name);
    ref.read(skillsRevisionProvider.notifier).bump();
  }

  Future<void> deleteGroup(String id) async {
    final repo = ref.read(skillsLibraryRepositoryProvider);
    await repo.deleteGroup(id);
    ref.read(skillsRevisionProvider.notifier).bump();
  }

  /// Re-exports every group's `.md` file — for when a card that other skills
  /// transclude changed and their exported files are now stale (a single
  /// group's own edits export themselves; see `SkillGroupController.flush`).
  Future<Map<String, bool>> exportAll() => exportAllSkillGroups(ref);

  /// The `.md` files under `data/gemini skills/` not yet brought in as a
  /// deck — see `skill_import.dart`.
  Future<List<String>> listImportable() => listImportableSkillFiles(ref);

  Future<SkillGroup?> importFile(String path) async {
    final group = await importSkillMarkdownFile(ref, path);
    ref.invalidateSelf();
    return group;
  }
}

final skillsControllerProvider =
    AsyncNotifierProvider<SkillsController, List<SkillGroup>>(
  SkillsController.new,
);
