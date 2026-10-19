import 'package:fake_async/fake_async.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/skill_gem_setup.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_providers.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/sqlite_skills_library_repository.dart';
import 'package:gratovo_toolbox/features/skills/application/skill_gem_setup_controller.dart';
import 'package:gratovo_toolbox/features/skills/application/skills_revision.dart';

import '../../../data/repositories/skills_library/memory_skills_db.dart';

void main() {
  late MemorySkillsDb db;
  late SqliteSkillsLibraryRepository repo;

  setUp(() {
    db = MemorySkillsDb();
    repo = SqliteSkillsLibraryRepository(db);
  });

  tearDown(() => db.close());

  ProviderContainer newContainer() {
    final container = ProviderContainer(
      overrides: [skillsLibraryRepositoryProvider.overrideWithValue(repo)],
    );
    addTearDown(container.dispose);
    return container;
  }

  Future<SkillGemSetup?> load(ProviderContainer container, String groupId) =>
      container.read(skillGemSetupControllerProvider(groupId).future);

  group('first load', () {
    test('a deck the role table knows gets a pre-filled, saved setup',
        () async {
      final group = await repo.createGroup('keyword generator skill');

      final setup = (await load(newContainer(), group.id))!;

      expect(setup.role, SkillGemRole.keywords);
      expect(setup.name, 'Keyword generator');
      expect(setup.instructions.trim(), isNotEmpty);
      expect(setup.hasUrl, isFalse);
      // Saved, not just held in memory.
      expect((await repo.getGemSetup(group.id))!.name, 'Keyword generator');
    });

    // The drafter and QA gems went with the old drafting path (decision
    // old-files): their decks get no setup, and none is written.
    test('the old drafter and QA decks get no setup', () async {
      final drafter = await repo.createGroup('email drafter skill');
      final qa = await repo.createGroup('QA optimizer');
      final container = newContainer();

      expect(await load(container, drafter.id), isNull);
      expect(await load(container, qa.id), isNull);
      expect(db.select('SELECT * FROM skill_gem_setup'), isEmpty);
    });

    test('a deck the table does not know has no setup and none is written',
        () async {
      final group = await repo.createGroup('WORKFLOW');

      expect(await load(newContainer(), group.id), isNull);
      expect(db.select('SELECT * FROM skill_gem_setup'), isEmpty);
    });

    test('a deck that no longer exists has none either', () async {
      expect(await load(newContainer(), 'gone'), isNull);
    });

    test('a stored setup is returned as it is, never re-defaulted', () async {
      final group = await repo.createGroup('keyword generator skill');
      final first = newContainer();
      final controller =
          first.read(skillGemSetupControllerProvider(group.id).notifier);
      await load(first, group.id);
      controller.edit(name: 'My own name', instructions: 'My own rules.');
      await controller.flush();

      final second = (await load(newContainer(), group.id))!;

      expect(second.name, 'My own name');
      expect(second.instructions, 'My own rules.');
    });
  });

  group('editing', () {
    test('keystrokes are debounced into one save', () async {
      final group = await repo.createGroup('keyword generator skill');
      final container = newContainer();
      await load(container, group.id);
      final controller =
          container.read(skillGemSetupControllerProvider(group.id).notifier);
      String stored() =>
          db.select('SELECT gem_name FROM skill_gem_setup').single['gem_name']
              as String;

      fakeAsync((async) {
        controller.edit(name: 'A');
        controller.edit(name: 'AB');
        controller.edit(name: 'ABC');
        // The screen sees every keystroke at once...
        expect(
          container.read(skillGemSetupControllerProvider(group.id)).value!.name,
          'ABC',
        );
        // ...the database only the settled one.
        async.elapse(const Duration(milliseconds: 500));
        expect(stored(), 'Keyword generator');
        async.elapse(const Duration(milliseconds: 400));
        expect(stored(), 'ABC');
      });
    });

    test('flush saves at once, and again with nothing pending is a no-op',
        () async {
      final group = await repo.createGroup('keyword generator skill');
      final container = newContainer();
      await load(container, group.id);
      final controller =
          container.read(skillGemSetupControllerProvider(group.id).notifier);

      controller.edit(description: 'Finds phrases.');
      await controller.flush();
      expect((await repo.getGemSetup(group.id))!.description, 'Finds phrases.');
      await controller.flush();
    });

    test('an edit changes neither the deck nor the revision counter', () async {
      final group = await repo.createGroup('keyword generator skill');
      final container = newContainer();
      await load(container, group.id);
      final before = db.select('SELECT updated_at FROM skill_groups');
      final revision = container.read(skillsRevisionProvider);

      final controller =
          container.read(skillGemSetupControllerProvider(group.id).notifier);
      controller.edit(instructions: 'Changed.');
      await controller.flush();
      await controller.setRole(SkillGemRole.keywords);

      expect(db.select('SELECT updated_at FROM skill_groups'), before);
      expect(container.read(skillsRevisionProvider), revision);
    });

    test('edits on a deck with no setup do nothing', () async {
      final group = await repo.createGroup('WORKFLOW');
      final container = newContainer();
      await load(container, group.id);

      final controller =
          container.read(skillGemSetupControllerProvider(group.id).notifier);
      controller.edit(name: 'Nope');
      await controller.flush();

      expect(await repo.getGemSetup(group.id), isNull);
    });
  });

  group('role', () {
    // One gem role is left (decision old-files), so the only call a deck can
    // make is to the role it already has.
    test('setRole to the role the deck already has writes nothing', () async {
      final group = await repo.createGroup('keyword generator skill');
      final container = newContainer();
      await load(container, group.id);
      final before = (await repo.getGemSetup(group.id))!.updatedAt;
      final controller =
          container.read(skillGemSetupControllerProvider(group.id).notifier);

      await controller.setRole(SkillGemRole.keywords);

      final stored = (await repo.getGemSetup(group.id))!;
      expect(stored.role, SkillGemRole.keywords);
      expect(stored.updatedAt, before);
    });

    test('enable gives an unknown deck a setup for the chosen role', () async {
      final group = await repo.createGroup('Notes on outreach');
      final container = newContainer();
      expect(await load(container, group.id), isNull);
      final controller =
          container.read(skillGemSetupControllerProvider(group.id).notifier);

      await controller.enable(SkillGemRole.keywords);

      final setup =
          container.read(skillGemSetupControllerProvider(group.id)).value!;
      expect(setup.role, SkillGemRole.keywords);
      expect(setup.name, 'Notes on outreach');
      expect((await repo.getGemSetup(group.id))!.role, SkillGemRole.keywords);
    });

    test('enable on a deck that already has a setup changes nothing', () async {
      final group = await repo.createGroup('keyword generator skill');
      final container = newContainer();
      await load(container, group.id);
      final controller =
          container.read(skillGemSetupControllerProvider(group.id).notifier);
      controller.edit(name: 'My own name');
      await controller.flush();

      await controller.enable(SkillGemRole.keywords);

      expect(
        container.read(skillGemSetupControllerProvider(group.id)).value!.name,
        'My own name',
      );
    });
  });
}
