import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/features/archive/application/archive_controller.dart';
import 'package:gratovo_toolbox/features/search/application/auto_clean_controller.dart';
import 'package:gratovo_toolbox/features/search/presentation/search_screen.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/auto_clean_panel.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/search_settings_panel.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/hermetic_search.dart';

/// The auto-clean rule as it appears on the Search page.
///
/// This is the page where the mess is made — a broad keyword run ends with
/// several thousand new channels, most of them never worth having — so the rule
/// for clearing them lives next to the button that starts the run. Two things
/// have to hold. The gate: the database refuses anyone who is not `full`, and a
/// switch that quietly does nothing is worse than no switch. And the header:
/// this is the one control on the page that acts without being pressed, so a
/// rule left on has to be readable without opening anything.
Widget _harness({required bool canBulkClean}) {
  return ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      // Overridden rather than driven through a profile: what this tests is the
      // screen honouring the gate, not how the gate is computed. Its own
      // derivation from `accessLevelProvider` is one line, next to the comment
      // explaining it.
      canBulkCleanProvider.overrideWithValue(canBulkClean),
      // Otherwise AutoCleanRuleNotifier.build()'s background load hits this
      // machine's real data/settings.local.json (and settings.json) — and
      // could race the `.state = rule` writes each test below does right
      // after pumping.
      autoCleanRuleStoreProvider
          .overrideWithValue(const NoopAutoCleanRuleStore()),
      // The page falls back to the newest run in this machine's own
      // `gratovo.db` when nothing is running in this session. A developer whose
      // newest search row is still `running` gets a pulsing dot and a ticking
      // clock in the progress panel, and `pumpAndSettle` never returns.
      ...hermeticSearchOverrides(),
    ],
    child: const MaterialApp(
      localizationsDelegates: [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: SearchScreen(),
    ),
  );
}

void _sizeTo(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

/// The auto-clean rule lives inside the Search settings panel, which is now an
/// AppBar button opening a dialog rather than a card collapsed at the top of
/// the page — so the title text this used to tap does not exist until the
/// dialog is already open. Tap the button itself.
Future<void> _openSettings(WidgetTester tester) async {
  await tester.tap(find.byType(SearchSettingsButton));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('full authority is offered the rule', (tester) async {
    _sizeTo(tester, const Size(1400, 2000));
    await tester.pumpWidget(_harness(canBulkClean: true));
    await tester.pump();
    await _openSettings(tester);

    expect(find.byType(AutoCleanPanel), findsOneWidget);
    // On out of the box, with the keep band this agency works with, and the
    // header saying so without anything being opened.
    expect(
      find.text('Keeps 50K–5M subscribers · below → archived · '
          'above → videos deferred'),
      findsOneWidget,
    );
  });

  testWidgets('anyone else is not shown it at all', (tester) async {
    // Hidden, not disabled. A disabled control still says "this exists and you
    // could have it"; the server refuses the sweep regardless, so the honest
    // presentation of a permission somebody does not have is absence.
    _sizeTo(tester, const Size(1400, 2000));
    await tester.pumpWidget(_harness(canBulkClean: false));
    await tester.pump();
    await _openSettings(tester);

    expect(find.byType(AutoCleanPanel), findsNothing);
    expect(find.text('Auto-clean results'), findsNothing);
  });

  testWidgets('the collapsed header says what will be thrown away',
      (tester) async {
    // The whole safety argument for the collapsed state. Somebody who set this
    // weeks ago has to be able to see, without opening anything, that finished
    // runs are being filtered and on what.
    _sizeTo(tester, const Size(1400, 2000));
    await tester.pumpWidget(_harness(canBulkClean: true));
    await tester.pump();
    await _openSettings(tester);

    final element = tester.element(find.byType(AutoCleanPanel));
    final container = ProviderScope.containerOf(element);
    container.read(autoCleanRuleProvider.notifier).state = const AutoCleanRule(
      enabled: true,
      maxSubscribers: 1000,
      maxMedianViews: 500,
    );
    await tester.pump();

    expect(
      find.text('Keeps under 1K subscribers and under 500 median views · '
          'above → videos deferred'),
      findsOneWidget,
    );
  });

  testWidgets('a rule switched on with no bounds says it does nothing',
      (tester) async {
    // The difference between "clean nothing" and "clean everything". It falls
    // on the safe side in the controller; this is it saying so on screen,
    // rather than looking armed.
    _sizeTo(tester, const Size(1400, 2000));
    await tester.pumpWidget(_harness(canBulkClean: true));
    await tester.pump();
    await _openSettings(tester);

    final element = tester.element(find.byType(AutoCleanPanel));
    ProviderScope.containerOf(element)
        .read(autoCleanRuleProvider.notifier)
        .state = const AutoCleanRule(enabled: true);
    await tester.pump();

    expect(
      find.text('On, but no range set — nothing will be cleaned'),
      findsOneWidget,
    );
  });

  testWidgets('both ranges are there once it is opened', (tester) async {
    _sizeTo(tester, const Size(1400, 2000));
    await tester.pumpWidget(_harness(canBulkClean: true));
    await tester.pump();
    await _openSettings(tester);

    await tester.tap(find.text('Auto-clean results'));
    await tester.pumpAndSettle();

    // Both keep bands, and what happens on each side of the subscriber one.
    expect(find.widgetWithText(TextField, 'Keep up to (subscribers)'),
        findsOneWidget);
    expect(find.widgetWithText(TextField, 'Keep up to (median views)'),
        findsOneWidget);
    expect(
        find.widgetWithText(
            DropdownButtonFormField<AutoCleanBandAction>, 'Below the range'),
        findsOneWidget);
    expect(
        find.widgetWithText(
            DropdownButtonFormField<AutoCleanBandAction>, 'Above the range'),
        findsOneWidget);
    expect(find.widgetWithText(TextField, 'Min videos (last 30 days)'),
        findsOneWidget);
    // The two limits that make an unattended sweep defensible, stated in the
    // panel rather than left to be discovered.
    expect(find.textContaining('Only channels the finished run itself found'),
        findsOneWidget);
    expect(find.textContaining('Nothing is deleted automatically'),
        findsOneWidget);
  });

  testWidgets('the house preset is one button away (HC-18)', (tester) async {
    _sizeTo(tester, const Size(1400, 2000));
    await tester.pumpWidget(_harness(canBulkClean: true));
    await tester.pump();
    await _openSettings(tester);
    await tester.tap(find.text('Auto-clean results'));
    await tester.pumpAndSettle();

    await tester
        .tap(find.text('Use the house rule: about 50K views, no size cap'));
    await tester.pumpAndSettle();

    expect(
        tester
            .widget<TextField>(
                find.widgetWithText(TextField, 'Keep from (median views)'))
            .controller!
            .text,
        '45000');
  });

  testWidgets('the videos floor shows in the collapsed header', (tester) async {
    _sizeTo(tester, const Size(1400, 2000));
    await tester.pumpWidget(_harness(canBulkClean: true));
    await tester.pump();
    await _openSettings(tester);

    final element = tester.element(find.byType(AutoCleanPanel));
    ProviderScope.containerOf(element)
        .read(autoCleanRuleProvider.notifier)
        .state = const AutoCleanRule(enabled: true, minVideosLast30: 3);
    await tester.pump();

    expect(
      find.text('Rejects new finds fewer than 3 videos in 30 days'),
      findsOneWidget,
    );
  });
}
