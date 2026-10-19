import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/toast/toast_overlay.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_archive_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/archive/presentation/archive_screen.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

Widget _harness() {
  return ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      // A fresh repository per harness, so a test that un-archives something
      // cannot leak into the next one.
      archiveRepositoryProvider.overrideWith((ref) => MockArchiveRepository()),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      // Mounted the same way app.dart mounts it, so a toast raised by the
      // screen under test actually renders instead of only updating
      // provider state unseen.
      builder: (context, child) => ToastOverlay(child: child!),
      home: const ArchiveScreen(),
    ),
  );
}

void _sizeTo(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets('lists the archived channels with their counts', (tester) async {
    _sizeTo(tester, const Size(1400, 2000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('@gamblingtipsdaily'), findsOneWidget);
    expect(find.text('@vintagetractorrestoration'), findsOneWidget);
    expect(find.text('3 archived channels'), findsOneWidget);
    // Compact on one line, not comma-grouped: "184K" and "1.2M" are the same
    // width, so the figures form a column down the list. The grouped figure is
    // in the tooltip, and is what the phone layout below still shows.
    expect(find.text('184K'), findsOneWidget);
  });

  // One row per channel above 620px. This is the whole point of the layout —
  // the archive is a list to scan, not a set of cards to read — so it is worth
  // an assertion rather than being left to look right.
  testWidgets('a wide window puts each channel on one line', (tester) async {
    _sizeTo(tester, const Size(1400, 2000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    final card = find.ancestor(
      of: find.text('@gamblingtipsdaily'),
      matching: find.byType(Card),
    );
    // Three values, the handle, the label chip and the date all inside one
    // line box: about 40px with the card's padding, well under the ~110px the
    // stacked card took.
    expect(tester.getSize(card).height, lessThan(60));
  });

  // Below 620px the six values cannot share a line legibly, so the labelled
  // card comes back rather than being squeezed into ellipses.
  testWidgets('a narrow window keeps the labelled card', (tester) async {
    _sizeTo(tester, const Size(500, 2400));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    // The labels only exist in the stacked form; the one-liner puts them in
    // tooltips.
    expect(find.text('Subscribers').hitTestable(), findsWidgets);
    expect(find.text('184,000'), findsOneWidget);
  });

  // The page has to say what archiving destroyed, where someone wondering
  // where a channel's notes went is actually looking.
  testWidgets('says what is kept and what is deleted', (tester) async {
    _sizeTo(tester, const Size(1400, 2000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(
      find.textContaining('reduced to a short record 7 days after tagging'),
      findsOneWidget,
    );
    expect(
      find.textContaining('free a channel'),
      findsOneWidget,
      reason: 'the page says how to bring a channel back',
    );
  });

  // A channel whose uploads never had a view count is not a channel averaging
  // zero views. Showing "0" would quietly assert the second.
  testWidgets('a missing average reads as unknown, never as zero',
      (tester) async {
    _sizeTo(tester, const Size(1400, 2000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    final dormantCard = find.ancestor(
      of: find.text('@dormantcookingchannel'),
      matching: find.byType(Card),
    );
    expect(
      find.descendant(of: dormantCard, matching: find.text('0')),
      findsNothing,
    );
    expect(
      find.descendant(of: dormantCard, matching: find.text('—')),
      findsOneWidget,
      reason: 'the average, and only the average — the other two are known',
    );
  });

  testWidgets('filtering by reason narrows the list', (tester) async {
    _sizeTo(tester, const Size(1400, 2000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    await tester.tap(find.text('All reasons'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Haram stuff').last);
    await tester.pumpAndSettle();

    expect(find.text('@gamblingtipsdaily'), findsOneWidget);
    expect(find.text('@vintagetractorrestoration'), findsNothing);
  });

  testWidgets('searching by handle narrows the list', (tester) async {
    _sizeTo(tester, const Size(1400, 2000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).first, 'tractor');
    await tester.pumpAndSettle();

    expect(find.text('@vintagetractorrestoration'), findsOneWidget);
    expect(find.text('@gamblingtipsdaily'), findsNothing);
  });

  // The phone layout, asserting no RenderFlex overflow — the check that caught
  // four real layout bugs across the Logs and Influencers pages.
  testWidgets('lays out on a phone without overflowing', (tester) async {
    _sizeTo(tester, const Size(390, 2400));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('@gamblingtipsdaily'), findsOneWidget);
  });

  // The reason is the one field on this page that is sometimes genuinely wrong
  // and otherwise needs a database edit to fix. Tapping the pill changes it.
  testWidgets('the reason pill changes the reason', (tester) async {
    _sizeTo(tester, const Size(1400, 2000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    final gamblingRow = find.ancestor(
      of: find.text('@gamblingtipsdaily'),
      matching: find.byType(Card),
    );
    // The pill label carries a leading glyph, so match on the word.
    await tester.tap(
      find.descendant(
        of: gamblingRow,
        matching: find.textContaining('Haram stuff'),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(
        of: find.byType(PopupMenuItem<ChannelTag>),
        matching: find.textContaining('Inactive'),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('Reason changed to'), findsOneWidget);
    expect(
      find.descendant(
        of: gamblingRow,
        matching: find.textContaining('Inactive'),
      ),
      findsOneWidget,
    );
  });

  // Freeing a channel re-enriches it through the local pipeline, which only the
  // installed desktop app can run — so off-desktop the ✕ is there but inert,
  // with a tooltip that says why. (The test platform is not desktop.)
  testWidgets('the free button is disabled off-desktop', (tester) async {
    _sizeTo(tester, const Size(1400, 2000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    final freeButtons = find.byWidgetPredicate(
      (w) =>
          w is IconButton &&
          w.icon is Icon &&
          (w.icon as Icon).icon == Icons.close,
    );
    expect(freeButtons, findsNWidgets(3));
    expect(
      tester
          .widgetList<IconButton>(freeButtons)
          .every((b) => b.onPressed == null),
      isTrue,
    );
  });
}
