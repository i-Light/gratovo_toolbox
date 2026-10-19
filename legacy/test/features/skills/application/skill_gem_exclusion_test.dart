import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/skill_group.dart';
import 'package:gratovo_toolbox/data/models/skill_section.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_providers.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/sqlite_skills_library_repository.dart';
import 'package:gratovo_toolbox/features/skills/application/skill_gem_setup_controller.dart';
import 'package:gratovo_toolbox/features/skills/application/skill_markdown.dart';
import 'package:gratovo_toolbox/features/skills/application/skills_controller.dart';
import 'package:gratovo_toolbox/features/skills/application/skills_library_snapshot.dart';

import '../../../data/repositories/skills_library/memory_skills_db.dart';

/// The owner's rule: a deck's gem cards are hidden from the export to the skill
/// file and from the skill itself. Everything here runs the real export path
/// (the controller's own `exportAll`, writing a real file) on the real schema,
/// and compares BYTES — a "does not contain" check would pass for a file that
/// merely changed shape.
void main() {
  const gemSentinels = [
    'GEM-NAME-SENTINEL',
    'GEM-DESCRIPTION-SENTINEL',
    'GEM-INSTRUCTIONS-SENTINEL',
  ];

  late Directory exportDir;
  late MemorySkillsDb db;
  late SqliteSkillsLibraryRepository repo;

  setUp(() {
    exportDir = Directory.systemTemp.createTempSync('gratovo_skills_gem_test');
    db = MemorySkillsDb();
    repo = SqliteSkillsLibraryRepository(db);
  });

  tearDown(() {
    db.close();
    try {
      exportDir.deleteSync(recursive: true);
    } on FileSystemException {
      // A temp folder left behind is not worth failing a test over.
    }
  });

  ProviderContainer newContainer(SqliteSkillsLibraryRepository over) {
    final container = ProviderContainer(
      overrides: [
        skillsLibraryRepositoryProvider.overrideWithValue(over),
        skillsExportDirProvider.overrideWithValue(exportDir.path),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  /// A deck with every kind of card the export has an opinion about.
  Future<SkillGroup> seedDeck(SqliteSkillsLibraryRepository into) async {
    final group = await into.createGroup('keyword generator skill');
    final at = DateTime.utc(2026, 9, 29);
    var position = 0;
    Future<void> add(
      String id,
      String heading,
      String body, {
      bool teamOnly = false,
    }) =>
        into.saveSection(SkillSection(
          id: id,
          groupId: group.id,
          heading: heading,
          body: body,
          position: position++,
          teamOnly: teamOnly,
          createdAt: at,
          updatedAt: at,
        ));
    await add('a', 'Rule one', 'Never invent a fact.');
    await add(
        'b', 'Rule two', 'Repeat it: @@keyword_generator_skill__rule_one');
    await add('c', 'Team notes', 'For the team only.', teamOnly: true);
    await add('d', '', 'A card with no name yet.');
    return group;
  }

  File exportedFile() => File('${exportDir.path}/keyword generator skill.md');

  Future<void> exportEverything(ProviderContainer container) async {
    await container.read(skillsControllerProvider.future);
    final results =
        await container.read(skillsControllerProvider.notifier).exportAll();
    expect(results.values, everyElement(isTrue));
  }

  Future<void> giveGemCards(
    ProviderContainer container,
    SkillGroup group,
  ) async {
    await container.read(skillGemSetupControllerProvider(group.id).future);
    final controller =
        container.read(skillGemSetupControllerProvider(group.id).notifier);
    controller.edit(
      name: gemSentinels[0],
      description: gemSentinels[1],
      instructions: '${gemSentinels[2]} — @@keyword_generator_skill__rule_one',
    );
    await controller.flush();
  }

  test('the exported markdown is byte-identical with and without gem cards',
      () async {
    final group = await seedDeck(repo);
    final container = newContainer(repo);

    await exportEverything(container);
    final without = exportedFile().readAsBytesSync();
    // A real file, not an empty one that would match anything.
    expect(
      utf8.decode(without),
      '# keyword generator skill\n'
      '\n---\n\n# Rule one\n\nNever invent a fact.\n'
      '\n---\n\n# Rule two\n\nRepeat it: Never invent a fact.\n',
    );

    await giveGemCards(container, group);
    expect(db.select('SELECT * FROM skill_gem_setup'), hasLength(1));
    await exportEverything(container);
    final withGem = exportedFile().readAsBytesSync();

    expect(withGem, without);
    final text = utf8.decode(withGem);
    for (final sentinel in gemSentinels) {
      expect(text, isNot(contains(sentinel)));
    }
  });

  test(
      'the same holds for a deck whose gem cards existed before its first export',
      () async {
    final group = await seedDeck(repo);
    final container = newContainer(repo);
    await giveGemCards(container, group);

    await exportEverything(container);
    final withGem = exportedFile().readAsBytesSync();

    // The control: an identical deck in a database that never had a gem.
    final controlDb = MemorySkillsDb();
    addTearDown(controlDb.close);
    final controlRepo = SqliteSkillsLibraryRepository(controlDb);
    await seedDeck(controlRepo);
    exportedFile().deleteSync();
    await exportEverything(newContainer(controlRepo));

    expect(withGem, exportedFile().readAsBytesSync());
  });

  test('the word count, the reference index and the snapshot never see them',
      () async {
    final group = await seedDeck(repo);
    final container = newContainer(repo);
    final wordsBefore = totalWordCount(await repo.listSections(group.id));
    final snapshotBefore =
        await container.read(skillsLibrarySnapshotProvider.future);
    final tokensBefore = buildReferenceIndex(snapshotBefore).keys.toSet();

    await giveGemCards(container, group);
    container.invalidate(skillsLibrarySnapshotProvider);

    expect(totalWordCount(await repo.listSections(group.id)), wordsBefore);
    final snapshot = await container.read(skillsLibrarySnapshotProvider.future);
    final index = buildReferenceIndex(snapshot);
    expect(index.keys.toSet(), tokensBefore);
    final everyBody = [
      for (final sections in snapshot.values)
        for (final section in sections) '${section.heading} ${section.body}',
    ].join('\n');
    for (final sentinel in gemSentinels) {
      expect(everyBody, isNot(contains(sentinel)));
    }
    // ...and a reference typed against a gem-looking token stays unresolved.
    expect(
      resolveSkillReferences(
          '@@keyword_generator_skill__gem_instructions', index),
      '@@keyword_generator_skill__gem_instructions',
    );
  });

  test(
      'importing the exported file creates no gem setup, and re-exports the same bytes',
      () async {
    final group = await seedDeck(repo);
    final container = newContainer(repo);
    await giveGemCards(container, group);
    await exportEverything(container);
    final exported = exportedFile().readAsBytesSync();

    // A fresh machine picking the file up.
    final freshDb = MemorySkillsDb();
    addTearDown(freshDb.close);
    final freshRepo = SqliteSkillsLibraryRepository(freshDb);
    final fresh = newContainer(freshRepo);
    final importable =
        await fresh.read(skillsControllerProvider.notifier).listImportable();
    expect(importable, hasLength(1));
    final imported = await fresh
        .read(skillsControllerProvider.notifier)
        .importFile(importable.single);

    expect(imported!.name, 'keyword generator skill');
    expect(freshDb.select('SELECT * FROM skill_gem_setup'), isEmpty);
    expect(
      (await freshRepo.listSections(imported.id)).map((s) => s.heading),
      ['Rule one', 'Rule two'],
    );
    await exportEverything(fresh);
    expect(exportedFile().readAsBytesSync(), exported);
  });

  test('opening the imported deck then gives it cards, still outside the file',
      () async {
    final group = await seedDeck(repo);
    final container = newContainer(repo);
    await exportEverything(container);
    final exported = exportedFile().readAsBytesSync();

    // The lazy first-open of the deck — what the deck screen does.
    final setup =
        await container.read(skillGemSetupControllerProvider(group.id).future);
    expect(setup, isNotNull);
    await exportEverything(container);

    expect(exportedFile().readAsBytesSync(), exported);
  });
}
