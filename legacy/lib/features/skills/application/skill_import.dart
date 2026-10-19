import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/skills_markdown_export.dart';
import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/data/models/skill_group.dart';
import 'package:gratovo_toolbox/data/models/skill_section.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_providers.dart';
import 'package:gratovo_toolbox/features/skills/application/skill_markdown.dart';
import 'package:gratovo_toolbox/features/skills/application/skills_revision.dart';

/// The `.md` files already sitting in `data/gemini skills/` — the keyword
/// generator, the channel classifier, and any other hand-written skill —
/// that have not yet been brought into the database as an editable deck.
///
/// A file already imported (its base name matches an existing group's name)
/// is left off this list: importing again would create a second, disconnected
/// copy rather than updating the one already being edited.
Future<List<String>> listImportableSkillFiles(Ref ref) async {
  final dir = ref.read(skillsExportDirProvider);
  if (dir == null) return const [];
  final repo = ref.read(skillsLibraryRepositoryProvider);
  final existingNames = {for (final g in await repo.listGroups()) g.name};
  final files = await listSkillMarkdownFiles(dir);
  return [
    for (final path in files)
      if (!existingNames.contains(_baseNameWithoutExtension(path))) path,
  ];
}

/// Reads [path], splits it into cards with [parseSkillMarkdownSections], and
/// creates a new group from them — the one-time bridge from a file the team
/// already hand-wrote to a deck this page can edit. Returns null if the file
/// could not be read.
///
/// The new group is marked exported immediately at the file's own
/// modification instant is not tracked here, so "now" is used instead — the
/// point is only that "never exported" would be misleading for a group whose
/// very first version already IS the file on disk.
Future<SkillGroup?> importSkillMarkdownFile(Ref ref, String path) async {
  final content = await readSkillMarkdownFile(path);
  if (content == null) return null;

  final repo = ref.read(skillsLibraryRepositoryProvider);
  final name = _baseNameWithoutExtension(path);
  final group = await repo.createGroup(name);

  final parsed = parseSkillMarkdownSections(content, title: name);
  final now = DateTime.now();
  for (var i = 0; i < parsed.length; i++) {
    await repo.saveSection(SkillSection(
      id: localUuid(),
      groupId: group.id,
      heading: parsed[i].heading,
      body: parsed[i].body,
      position: i,
      createdAt: now,
      updatedAt: now,
    ));
  }
  await repo.markGroupExported(group.id, now);
  ref.read(skillsRevisionProvider.notifier).bump();
  return group;
}

String _baseNameWithoutExtension(String path) {
  final normalized = path.replaceAll('\\', '/');
  final base = normalized.substring(normalized.lastIndexOf('/') + 1);
  return base.endsWith('.md') ? base.substring(0, base.length - 3) : base;
}
