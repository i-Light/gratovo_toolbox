import 'package:gratovo_toolbox/data/models/skill_gem_setup.dart';
import 'package:gratovo_toolbox/data/models/skill_group.dart';
import 'package:gratovo_toolbox/data/models/skill_section.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library_repository.dart';

/// What the app gets when there is nowhere to write: the web build, or a
/// machine whose `skills_library.db` could not be opened. Same reasoning as
/// `UnavailableEmailLibraryRepository` — every read returns nothing and every
/// write is silently dropped, safe because `isAvailable` is false and the
/// page shows an explanation instead of an editor.
class UnavailableSkillsLibraryRepository implements SkillsLibraryRepository {
  const UnavailableSkillsLibraryRepository();

  @override
  bool get isAvailable => false;

  @override
  Future<List<SkillGroup>> listGroups() async => const [];

  @override
  Future<SkillGroup> createGroup(String name) async => SkillGroup(
        id: 'unavailable',
        name: name,
        createdAt: DateTime.now(),
        updatedAt: DateTime.now(),
      );

  @override
  Future<void> renameGroup(String id, String name) async {}

  @override
  Future<void> deleteGroup(String id) async {}

  @override
  Future<void> markGroupExported(String id, DateTime at) async {}

  @override
  Future<List<SkillSection>> listSections(String groupId) async => const [];

  @override
  Future<void> saveSection(SkillSection section) async {}

  @override
  Future<void> deleteSection(String id) async {}

  @override
  Future<void> reorderSections(
    String groupId,
    List<String> orderedIds,
  ) async {}

  @override
  Future<SkillGemSetup?> getGemSetup(String groupId) async => null;

  @override
  Future<void> saveGemSetup(SkillGemSetup setup) async {}
}
