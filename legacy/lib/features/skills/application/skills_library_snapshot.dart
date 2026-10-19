import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/skill_group.dart';
import 'package:gratovo_toolbox/data/models/skill_section.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_providers.dart';
import 'package:gratovo_toolbox/features/skills/application/skills_revision.dart';

/// Every group's cards, all at once — what the cross-skill `@` mention menu
/// and export transclusion (see `skill_markdown.dart`) resolve references
/// against. A skill library is a handful of files at most (four today), so
/// reading every card on every revision bump is cheap; nothing here is on a
/// per-keystroke path.
final skillsLibrarySnapshotProvider =
    FutureProvider<Map<SkillGroup, List<SkillSection>>>((ref) async {
  ref.watch(skillsRevisionProvider);
  final repo = ref.watch(skillsLibraryRepositoryProvider);
  final groups = await repo.listGroups();
  final snapshot = <SkillGroup, List<SkillSection>>{};
  for (final group in groups) {
    snapshot[group] = await repo.listSections(group.id);
  }
  return snapshot;
});
