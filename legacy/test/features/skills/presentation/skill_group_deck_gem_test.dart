import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/skill_gem_setup.dart';
import 'package:gratovo_toolbox/data/models/skill_group.dart';
import 'package:gratovo_toolbox/data/models/skill_section.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_providers.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/sqlite_skills_library_repository.dart';
import 'package:gratovo_toolbox/features/skills/presentation/widgets/markdown_preview.dart';
import 'package:gratovo_toolbox/features/skills/presentation/widgets/skill_group_deck.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

import '../../../data/repositories/skills_library/memory_skills_db.dart';

/// The two permanent gem cards inside a skill deck, on the real SQLite schema.
///
/// Bounded pumps, not `pumpAndSettle`: nothing here animates forever, but the
/// deck's providers resolve over several microtask hops and a settle would
/// hide a hang behind a timeout.
void main() {
  late MemorySkillsDb db;
  late SqliteSkillsLibraryRepository repo;

  setUp(() {
    db = MemorySkillsDb();
    repo = SqliteSkillsLibraryRepository(db);
  });

  tearDown(() => db.close());

  Future<SkillGroup> seedDeck(String name, {bool withCards = true}) async {
    final group = await repo.createGroup(name);
    if (withCards) {
      final at = DateTime.utc(2026, 9, 29);
      await repo.saveSection(SkillSection(
        id: 's1',
        groupId: group.id,
        heading: 'Rule one',
        body: 'alpha beta',
        position: 0,
        createdAt: at,
        updatedAt: at,
      ));
      await repo.saveSection(SkillSection(
        id: 's2',
        groupId: group.id,
        heading: 'Rule two',
        body: 'gamma',
        position: 1,
        createdAt: at,
        updatedAt: at,
      ));
    }
    return group;
  }

  Future<void> pumpDeck(
    WidgetTester tester,
    SkillGroup group, {
    VoidCallback? onBack,
  }) async {
    tester.view.physicalSize = const Size(1500, 1100);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          skillsLibraryRepositoryProvider.overrideWithValue(repo),
          // No folder to export into: these tests are about the cards.
          skillsExportDirProvider.overrideWithValue(null),
        ],
        child: MaterialApp(
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          home: SkillGroupDeck(group: group, onBack: onBack ?? () {}),
        ),
      ),
    );
    await settle(tester);
  }

  Finder fieldLabelled(String label) => find.byWidgetPredicate(
        (widget) =>
            widget is TextField && widget.decoration?.labelText == label,
      );

  group('a deck that maps to a gem', () {
    testWidgets('shows the block and both cards above the deck\'s own cards',
        (tester) async {
      final group = await seedDeck('keyword generator skill');
      await pumpDeck(tester, group);

      expect(find.text('Gemini Gem'), findsOneWidget);
      expect(find.text('Gem · name & description'), findsOneWidget);
      expect(find.text('Gem · instructions'), findsOneWidget);
      expect(find.text('Used for: Keywords'), findsOneWidget);
      // Collapsed: the summary line stands in for the fields.
      expect(find.text('Keyword generator'), findsOneWidget);
      expect(fieldLabelled('Gem name'), findsNothing);

      final gemY = tester.getTopLeft(find.text('Gem · name & description')).dy;
      final firstCardY = tester.getTopLeft(find.byType(TextField).first).dy;
      expect(gemY, lessThan(firstCardY));
    });

    testWidgets('the cards are permanent: no drag handle and no delete',
        (tester) async {
      final group = await seedDeck('keyword generator skill');
      await pumpDeck(tester, group);

      // Exactly the two real cards carry a drag handle and a delete button.
      expect(find.byIcon(Icons.drag_indicator), findsNWidgets(2));
      expect(find.byTooltip('Delete card'), findsNWidgets(2));
      expect(find.byType(ReorderableListView), findsOneWidget);
    });

    testWidgets('opens to the name, description and instructions fields',
        (tester) async {
      final group = await seedDeck('keyword generator skill');
      await pumpDeck(tester, group);

      await tester.tap(find.text('Gem · name & description'));
      await tester.pump();
      expect(fieldLabelled('Gem name'), findsOneWidget);
      expect(fieldLabelled('Description'), findsOneWidget);
      expect(fieldLabelled('Instructions'), findsNothing);

      await tester.tap(find.text('Gem · instructions'));
      await tester.pump();
      expect(fieldLabelled('Instructions'), findsOneWidget);

      final name = tester.widget<TextField>(fieldLabelled('Gem name'));
      expect(name.controller!.text, 'Keyword generator');
    });

    testWidgets('typing is saved after the debounce', (tester) async {
      final group = await seedDeck('keyword generator skill');
      await pumpDeck(tester, group);
      await tester.tap(find.text('Gem · instructions'));
      await tester.pump();

      await tester.enterText(fieldLabelled('Instructions'), 'Be brief.');
      await tester.pump(const Duration(milliseconds: 300));
      expect(
        (await repo.getGemSetup(group.id))!.instructions,
        isNot('Be brief.'),
      );
      await tester.pump(const Duration(seconds: 1));
      expect((await repo.getGemSetup(group.id))!.instructions, 'Be brief.');
    });

    testWidgets('leaving the deck saves an edit that is still debouncing',
        (tester) async {
      final group = await seedDeck('keyword generator skill');
      var left = false;
      await pumpDeck(tester, group, onBack: () => left = true);
      await tester.tap(find.text('Gem · name & description'));
      await tester.pump();

      await tester.enterText(fieldLabelled('Gem name'), 'Quick edit');
      await tester.tap(find.byIcon(Icons.arrow_back));
      await tester.pump();

      expect(left, isTrue);
      expect((await repo.getGemSetup(group.id))!.name, 'Quick edit');
    });

    testWidgets('gem text never reaches the word count or the preview',
        (tester) async {
      final group = await seedDeck('keyword generator skill');
      await pumpDeck(tester, group);
      expect(find.text('3 words'), findsOneWidget);

      await tester.tap(find.text('Gem · instructions'));
      await tester.pump();
      await tester.enterText(
        fieldLabelled('Instructions'),
        'one two three four five six seven eight nine ten GEMSENTINEL',
      );
      await tester.pump(const Duration(seconds: 1));

      expect(find.text('3 words'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(MarkdownPreview),
          matching: find.textContaining('GEMSENTINEL'),
        ),
        findsNothing,
      );
      // The instruction card's own count is its own.
      await tester.tap(find.text('Gem · instructions'));
      await tester.pump();
      expect(find.text('11 words'), findsOneWidget);
    });

    // The drafter and QA gems went with the old drafting path (decision
    // old-files): the keywords gem is the only one left to choose.
    testWidgets('the role menu offers only the keywords gem', (tester) async {
      final group = await seedDeck('keyword generator skill');
      await pumpDeck(tester, group);

      await tester.tap(find.text('Used for: Keywords'));
      // One frame builds the menu route, the next runs its opening animation.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Keywords'), findsOneWidget);
      expect(find.text('Email drafter'), findsNothing);
      expect(find.text('QA optimizer'), findsNothing);
      await tester.tap(find.text('Keywords').last);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Used for: Keywords'), findsOneWidget);
      expect((await repo.getGemSetup(group.id))!.role, SkillGemRole.keywords);
    });

    testWidgets('an empty deck still shows its gem cards and the hint',
        (tester) async {
      final group = await seedDeck('keyword generator skill', withCards: false);
      await pumpDeck(tester, group);

      expect(find.text('Gem · instructions'), findsOneWidget);
      expect(
        find.text('No cards yet. Add one to start writing this skill.'),
        findsWidgets,
      );
    });
  });

  group('a deck with no gem role', () {
    testWidgets('has no gem cards, and offers to set one up', (tester) async {
      final group = await seedDeck('WORKFLOW');
      await pumpDeck(tester, group);

      expect(find.text('Gemini Gem'), findsNothing);
      expect(find.text('Gem · instructions'), findsNothing);
      expect(find.byTooltip('Set up a Gem for this skill'), findsOneWidget);
      expect(db.select('SELECT * FROM skill_gem_setup'), isEmpty);
    });

    testWidgets('choosing a role gives it the same two cards', (tester) async {
      final group = await seedDeck('WORKFLOW');
      await pumpDeck(tester, group);

      await tester.tap(find.byTooltip('Set up a Gem for this skill'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Which Gem does this skill configure?'), findsOneWidget);
      await tester.tap(find.text('Keywords'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await settle(tester);

      expect(find.text('Gem · name & description'), findsOneWidget);
      expect(find.text('Gem · instructions'), findsOneWidget);
      expect(find.text('Used for: Keywords'), findsOneWidget);
      // ...and the shortcut goes away.
      expect(find.byTooltip('Set up a Gem for this skill'), findsNothing);
      expect((await repo.getGemSetup(group.id))!.role, SkillGemRole.keywords);
    });
  });
}

/// A few bounded frames: enough for the deck's providers to resolve.
Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}
