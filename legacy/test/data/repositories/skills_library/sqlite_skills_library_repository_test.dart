import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/skill_gem_setup.dart';
import 'package:gratovo_toolbox/data/models/skill_section.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_schema.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/sqlite_skills_library_repository.dart';

import 'memory_skills_db.dart';

void main() {
  late MemorySkillsDb db;
  late SqliteSkillsLibraryRepository repo;

  setUp(() {
    db = MemorySkillsDb();
    repo = SqliteSkillsLibraryRepository(db);
  });

  tearDown(() => db.close());

  SkillGemSetup makeSetup(
    String groupId, {
    SkillGemRole role = SkillGemRole.keywords,
    String name = 'Keyword generator',
    String description = 'Drafts emails.',
    String instructions = 'Draft them well.',
    String url = '',
    DateTime? syncedAt,
  }) {
    final at = DateTime.utc(2026, 9, 29, 10);
    return SkillGemSetup(
      groupId: groupId,
      role: role,
      name: name,
      description: description,
      instructions: instructions,
      url: url,
      syncedAt: syncedAt,
      createdAt: at,
      updatedAt: at,
    );
  }

  group('migration', () {
    test('a file written before the gem table gains it and keeps every row',
        () async {
      final old = MemorySkillsDb(migrationCount: 2);
      addTearDown(old.close);
      old.execute(
        'INSERT INTO skill_groups (id, name, created_at, updated_at) '
        "VALUES ('g1', 'email drafter skill', '2026-01-01T00:00:00.000Z', "
        "'2026-01-02T00:00:00.000Z')",
      );
      old.execute(
        'INSERT INTO skill_sections '
        '(id, group_id, heading, body, position, team_only, created_at, updated_at) '
        "VALUES ('s1', 'g1', 'Rule', 'Never do X.', 0, 1, "
        "'2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      );
      expect(
        old.select(
          "SELECT name FROM sqlite_master WHERE name = 'skill_gem_setup'",
        ),
        isEmpty,
      );

      old.migrate();

      expect(old.userVersion, skillsLibrarySpec.version);
      final upgraded = SqliteSkillsLibraryRepository(old);
      final groups = await upgraded.listGroups();
      expect(groups.single.name, 'email drafter skill');
      expect(groups.single.updatedAt, DateTime.utc(2026, 1, 2));
      final sections = await upgraded.listSections('g1');
      expect(sections.single.body, 'Never do X.');
      expect(sections.single.teamOnly, isTrue);
      expect(await upgraded.getGemSetup('g1'), isNull);
      // ...and the new table works on the upgraded file.
      await upgraded.saveGemSetup(makeSetup('g1'));
      expect((await upgraded.getGemSetup('g1'))!.name, 'Keyword generator');
    });

    test('an already-migrated file is not touched by a second migrate()', () {
      db.execute(
        'INSERT INTO skill_groups (id, name, created_at, updated_at) '
        "VALUES ('g1', 'Deck', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      );
      db.execute(
        'INSERT INTO skill_gem_setup (group_id, role, created_at, updated_at) '
        "VALUES ('g1', 'qa', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      );
      db.migrate();
      expect(
          db.select('SELECT role FROM skill_gem_setup').single['role'], 'qa');
    });
  });

  group('gem setup', () {
    test('round-trips every field', () async {
      final group = await repo.createGroup('email drafter skill');
      final synced = DateTime.utc(2026, 9, 29, 11, 30);
      await repo.saveGemSetup(makeSetup(
        group.id,
        role: SkillGemRole.keywords,
        name: 'Gem name',
        description: 'Gem description',
        instructions: 'Line one.\nLine two.',
        url: 'https://gemini.google.com/gem/abc123',
        syncedAt: synced,
      ));

      final loaded = (await repo.getGemSetup(group.id))!;
      expect(loaded.groupId, group.id);
      expect(loaded.role, SkillGemRole.keywords);
      expect(loaded.name, 'Gem name');
      expect(loaded.description, 'Gem description');
      expect(loaded.instructions, 'Line one.\nLine two.');
      expect(loaded.url, 'https://gemini.google.com/gem/abc123');
      expect(loaded.syncedAt, synced);
      expect(loaded.hasUrl, isTrue);
      expect(loaded.createdAt, DateTime.utc(2026, 9, 29, 10));
    });

    test('a deck without one reads as null, and a null syncedAt stays null',
        () async {
      final group = await repo.createGroup('Deck');
      expect(await repo.getGemSetup(group.id), isNull);
      await repo.saveGemSetup(makeSetup(group.id));
      final loaded = (await repo.getGemSetup(group.id))!;
      expect(loaded.syncedAt, isNull);
      expect(loaded.hasUrl, isFalse);
    });

    test('saving again replaces the row instead of adding a second one',
        () async {
      final group = await repo.createGroup('Deck');
      await repo.saveGemSetup(makeSetup(group.id, name: 'First'));
      await repo.saveGemSetup(
        makeSetup(group.id, name: 'Second', url: 'https://x/gem/1'),
      );
      expect(db.select('SELECT * FROM skill_gem_setup'), hasLength(1));
      final loaded = (await repo.getGemSetup(group.id))!;
      expect(loaded.name, 'Second');
      expect(loaded.url, 'https://x/gem/1');
    });

    test('deleting the deck takes its gem setup with it', () async {
      final group = await repo.createGroup('Deck');
      await repo.saveGemSetup(makeSetup(group.id));
      await repo.deleteGroup(group.id);
      expect(db.select('SELECT * FROM skill_gem_setup'), isEmpty);
    });

    test('saving one never changes the deck\'s own updated_at', () async {
      final group = await repo.createGroup('Deck');
      final before =
          db.select('SELECT updated_at FROM skill_groups').single['updated_at'];
      await repo.saveGemSetup(makeSetup(group.id));
      await repo.saveGemSetup(makeSetup(group.id, name: 'Edited'));
      final after =
          db.select('SELECT updated_at FROM skill_groups').single['updated_at'];
      expect(after, before);
    });

    test('is invisible to the calls that build a skill', () async {
      final group = await repo.createGroup('email drafter skill');
      await repo.saveSection(SkillSection(
        id: 's1',
        groupId: group.id,
        heading: 'Rule',
        body: 'Never do X.',
        position: 0,
        createdAt: DateTime.utc(2026, 1, 1),
        updatedAt: DateTime.utc(2026, 1, 1),
      ));
      await repo.saveGemSetup(makeSetup(
        group.id,
        name: 'GEM-NAME-SENTINEL',
        description: 'GEM-DESCRIPTION-SENTINEL',
        instructions: 'GEM-INSTRUCTIONS-SENTINEL',
      ));

      final sections = await repo.listSections(group.id);
      expect(sections, hasLength(1));
      expect(sections.single.heading, 'Rule');
      expect(await repo.listGroups(), hasLength(1));
      final dump = db
          .select('SELECT heading, body FROM skill_sections')
          .map((row) => '${row['heading']} ${row['body']}')
          .join();
      expect(dump, isNot(contains('SENTINEL')));
    });

    // The drafter and QA gems went with the old drafting path (decision
    // old-files); a file that still holds one, or a role from a newer build,
    // reads as "no gem setup" rather than as some other gem.
    for (final stored in ['drafter', 'qa', 'martian']) {
      test('a stored "$stored" role reads as no setup', () async {
        final group = await repo.createGroup('Deck');
        db.execute(
          'INSERT INTO skill_gem_setup (group_id, role, created_at, updated_at) '
          "VALUES (?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
          [group.id, stored],
        );
        expect(await repo.getGemSetup(group.id), isNull);
      });
    }
  });
}
