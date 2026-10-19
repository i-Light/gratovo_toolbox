import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/skill_group.dart';
import 'package:gratovo_toolbox/data/models/skill_section.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_providers.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/sqlite_skills_library_repository.dart';
import 'package:gratovo_toolbox/features/skills/presentation/widgets/skill_group_deck.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

import '../../../data/repositories/skills_library/memory_skills_db.dart';

/// The deck's resize splitter and edit plumbing — the parts that made the page
/// feel heavy: a drag rebuilt the whole deck, and a click into a card counted
/// as an edit.
void main() {
  late MemorySkillsDb db;
  late SqliteSkillsLibraryRepository repo;
  final seededAt = DateTime.utc(2026, 9, 29);

  setUp(() {
    db = MemorySkillsDb();
    repo = SqliteSkillsLibraryRepository(db);
  });

  tearDown(() => db.close());

  Future<SkillGroup> seedDeck() async {
    final group = await repo.createGroup('WORKFLOW');
    await repo.saveSection(SkillSection(
      id: 's1',
      groupId: group.id,
      heading: 'Rule one',
      body: 'alpha beta',
      position: 0,
      createdAt: seededAt,
      updatedAt: seededAt,
    ));
    return group;
  }

  Future<void> pumpDeck(WidgetTester tester, SkillGroup group) async {
    tester.view.physicalSize = const Size(1500, 1100);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          skillsLibraryRepositoryProvider.overrideWithValue(repo),
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
          home: SkillGroupDeck(group: group, onBack: () {}),
        ),
      ),
    );
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  final splitter = find.byKey(const ValueKey('skills-splitter'));

  testWidgets(
      'the splitter follows the pointer, and a drag past a limit '
      'comes back under the cursor', (tester) async {
    await pumpDeck(tester, await seedDeck());

    final startX = tester.getCenter(splitter).dx;
    final gesture = await tester.startGesture(tester.getCenter(splitter));
    await gesture.moveBy(const Offset(100, 0));
    await tester.pump();
    expect(tester.getCenter(splitter).dx, closeTo(startX + 100, 0.5));

    // Far past the right-hand limit: the bar stops at the preview's minimum...
    await gesture.moveBy(const Offset(5000, 0));
    await tester.pump();
    final stopped = tester.getCenter(splitter).dx;
    expect(stopped, lessThan(1500 - 320));

    // ...and dragging back by the same distance puts it back under the cursor
    // instead of leaving it offset by the overshoot.
    await gesture.moveBy(const Offset(-5000 - 100, 0));
    await tester.pump();
    expect(tester.getCenter(splitter).dx, closeTo(startX, 0.5));
    await gesture.up();
  });

  testWidgets('clicking into a card is not an edit', (tester) async {
    final group = await seedDeck();
    await pumpDeck(tester, group);

    await tester.tap(find.byIcon(Icons.expand_more).first);
    await tester.pump();
    final body = find.byWidgetPredicate(
      (w) => w is TextField && w.controller?.text == 'alpha beta',
    );
    await tester.tap(body);
    await tester.pump();
    await tester.tap(find.byWidgetPredicate(
      (w) => w is TextField && w.controller?.text == 'Rule one',
    ));
    // Longer than the save debounce.
    await tester.pump(const Duration(seconds: 2));

    final saved = (await repo.listSections(group.id)).single;
    expect(saved.updatedAt, seededAt);
  });

  testWidgets('typing still saves after the debounce', (tester) async {
    final group = await seedDeck();
    await pumpDeck(tester, group);

    await tester.tap(find.byIcon(Icons.expand_more).first);
    await tester.pump();
    await tester.enterText(
      find.byWidgetPredicate(
        (w) => w is TextField && w.controller?.text == 'alpha beta',
      ),
      'alpha beta gamma',
    );
    await tester.pump(const Duration(seconds: 2));

    expect((await repo.listSections(group.id)).single.body, 'alpha beta gamma');
  });

  testWidgets(
      'the wheel scrolls the pane under the pointer, forwards only, '
      'and leaves the other one alone', (tester) async {
    final group = await repo.createGroup('WORKFLOW');
    for (var i = 0; i < 8; i++) {
      await repo.saveSection(SkillSection(
        id: 's$i',
        groupId: group.id,
        heading: 'Rule $i',
        body: List.generate(12, (n) => 'line $n of rule $i').join('\n\n'),
        position: i,
        createdAt: seededAt,
        updatedAt: seededAt,
      ));
    }
    await pumpDeck(tester, group);

    // Expand a few cards, as in real use: an expanded card grows the deck's
    // extent mid-scroll, which is what used to make the pane jump.
    for (var k = 0; k < 2; k++) {
      await tester.tap(find.byIcon(Icons.expand_more).first);
      await tester.pump(const Duration(milliseconds: 400));
    }

    final scrollables = find.byType(Scrollable);
    ScrollableState stateOf(bool right) {
      final states = tester.stateList<ScrollableState>(scrollables).where(
            (s) => s.axisDirection == AxisDirection.down,
          );
      final sorted = states.toList()
        ..sort((a, b) => tester
            .getCenter(find.byWidget(a.widget))
            .dx
            .compareTo(tester.getCenter(find.byWidget(b.widget)).dx));
      return right ? sorted.last : sorted.first;
    }

    final right = stateOf(true);
    final left = stateOf(false);
    final mouse = TestPointer(1, PointerDeviceKind.mouse);

    // The two panes scroll independently on purpose: a shared offset was tried
    // and removed, because cards and their rendered preview are different
    // heights and dragging one pane under the other fought the reader. What
    // must hold is that the wheel moves the pane the pointer is over, only
    // ever forwards, and never nudges its neighbour.
    Future<void> wheelOver(ScrollableState pane, ScrollableState other) async {
      await tester.sendEventToBinding(
          mouse.hover(tester.getCenter(find.byWidget(pane.widget))));
      var last = pane.position.pixels;
      final otherStart = other.position.pixels;
      for (var i = 0; i < 40; i++) {
        await tester.sendEventToBinding(mouse.scroll(const Offset(0, 60)));
        await tester.pump(const Duration(milliseconds: 16));
        final now = pane.position.pixels;
        expect(now, greaterThanOrEqualTo(last - 0.5),
            reason: 'the pane under the pointer jumped backwards at step $i');
        expect(other.position.pixels, otherStart,
            reason: 'the other pane moved at step $i');
        last = now;
      }
      expect(pane.position.pixels, greaterThan(0),
          reason: 'the pane under the pointer never moved');
    }

    await wheelOver(right, left);
    await wheelOver(left, right);
  });
}
