import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/skills_markdown_export.dart';
import 'package:gratovo_toolbox/data/models/skill_group.dart';
import 'package:gratovo_toolbox/data/models/skill_section.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_providers.dart';
import 'package:gratovo_toolbox/features/skills/application/skill_markdown.dart';
import 'package:gratovo_toolbox/features/skills/application/skills_revision.dart';

/// Rebuilds [groupId]'s combined markdown from the current database state and
/// writes it to `data/gemini skills/<name>.md`, transcluding every `@token`
/// reference against the *whole* library — a card in this group may
/// reference one written in another skill.
///
/// Only [groupId]'s own file is rewritten; a card other groups transclude
/// does not also regenerate their files — see [exportAllSkillGroups] for
/// catching those up. Called from a controller's own `ref` (see
/// `SkillGroupController.flush`), never directly from a widget.
///
/// Returns false if there is nowhere to write to, the group no longer
/// exists, or the write failed.
Future<bool> exportSkillGroup(Ref ref, String groupId) async {
  final dir = ref.read(skillsExportDirProvider);
  if (dir == null) return false;
  final repo = ref.read(skillsLibraryRepositoryProvider);

  final groups = await repo.listGroups();
  SkillGroup? group;
  final library = <SkillGroup, List<SkillSection>>{};
  for (final candidate in groups) {
    final sections = await repo.listSections(candidate.id);
    library[candidate] = sections;
    if (candidate.id == groupId) group = candidate;
  }
  if (group == null) return false;

  final index = buildReferenceIndex(library);
  final markdown = buildSkillMarkdown(group, library[group]!, index);
  final ok = await writeSkillMarkdownFile(
    directory: dir,
    fileName: skillMarkdownFileName(group),
    content: markdown,
  );
  if (ok) {
    await repo.markGroupExported(group.id, DateTime.now());
    ref.read(skillsRevisionProvider.notifier).bump();
  }
  return ok;
}

/// Re-exports every group's file — the "catch up every export" action for
/// when a transcluded card changed and its dependents' files are now stale.
Future<Map<String, bool>> exportAllSkillGroups(Ref ref) async {
  final repo = ref.read(skillsLibraryRepositoryProvider);
  final groups = await repo.listGroups();
  final results = <String, bool>{};
  for (final group in groups) {
    results[group.id] = await exportSkillGroup(ref, group.id);
  }
  return results;
}
