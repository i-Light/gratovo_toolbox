import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/features/dashboard/application/channel_analytics_controller.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/dashboard_screen.dart';
import 'package:gratovo_toolbox/features/news/application/news_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The dashboard against the seeded mocks (no backend). What's pinned here:
/// the identity greeting in the app bar, the two "today" tiles replacing the
/// old "Upcoming outreach" stat, the reminders card sitting last, and News /
/// Logs opening as modals now that they've left the nav.
/// [newsFails] stands in for the news request coming back with an error rather
/// than data — the state the peek card used to render as an empty feed. A
/// boolean rather than an override list because `flutter_riverpod`'s barrel
/// does not export the `Override` type, so a parameter cannot name it; a list
/// literal built in place can still infer it.
///
/// The Logs card carries the identical fix, untested here: its provider is an
/// `AsyncNotifierProvider.family`, whose override takes a notifier factory
/// rather than a future, and contorting the harness around that would test the
/// harness more than the card.
Widget _harness({bool newsFails = false}) {
  return ProviderScope(
    overrides: [
      if (newsFails)
        newsItemsProvider.overrideWith(
          (ref) async => throw Exception('the server did not answer'),
        ),
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      currentProfileProvider.overrideWith(
        (ref) async => const TeamMember(
          id: 'me',
          displayName: 'Dana Reeve',
          color: Color(0xFF3B82F6),
          accessLevel: AccessLevel.full,
        ),
      ),
      // The analytics section aggregates every channel; keep it collapsed so
      // the reminders card is unambiguously the last thing on the page.
      canSeeChannelAnalyticsProvider.overrideWithValue(false),
    ],
    child: const MaterialApp(
      localizationsDelegates: [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: DashboardScreen(),
    ),
  );
}

void _sizeTo(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('greets the signed-in person in the app bar', (tester) async {
    _sizeTo(tester, const Size(1400, 2200));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    // The greeting is two Text widgets, not one: the name is drawn bold
    // beside the fixed "Welcome back, " lead-in, so no single widget carries
    // the whole sentence.
    expect(find.text('Welcome back, '), findsOneWidget);
    expect(find.text('Dana Reeve'), findsOneWidget);
    // The wordmark used to sit in this app bar and no longer does — it is
    // the login screen's headline and the OS window title now. What this test
    // is about is that the greeting rides in the app bar's trailing slot, so
    // assert that instead of a string the design has dropped.
    expect(
      find.descendant(
        of: find.byType(GradientAppBar),
        matching: find.text('Welcome back, '),
      ),
      findsOneWidget,
    );
  });

  testWidgets('shows the today tiles and not the old outreach tile',
      (tester) async {
    _sizeTo(tester, const Size(1400, 2200));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(find.text('Emails sent today'), findsOneWidget);
    expect(find.text('Drafted today'), findsOneWidget);
    expect(find.text('Scheduled today'), findsNothing);
    expect(find.text('Upcoming outreach'), findsNothing);
  });

  testWidgets(
      'sent today reads against the daily target, and the roster '
      'against five ready to pitch', (tester) async {
    _sizeTo(tester, const Size(1400, 2200));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(find.textContaining(RegExp(r'^\d+ of 50$')), findsOneWidget);
    expect(find.text('Roster ready to pitch'), findsOneWidget);
    expect(find.textContaining(RegExp(r'^\d+ of 5$')), findsOneWidget);
  });

  testWidgets(
      'upcoming reminders is a card listing each reminder, beside '
      'the tiles', (tester) async {
    // Five tiles and the card share one row from about 1,550px of page; the
    // owner's desktop window is wider than that. Narrower, the card wraps
    // under the tiles rather than squeezing them.
    _sizeTo(tester, const Size(1700, 2200));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    // The full list card — each seeded reminder shown, not a bare count.
    // Scoped to this card's own GratovoCard: the My Day section above the
    // tiles is additive, not a replacement, and may legitimately surface
    // the same reminder text a second time.
    expect(find.text('Upcoming reminders'), findsOneWidget);
    final remindersCard = find.ancestor(
      of: find.text('Upcoming reminders'),
      matching: find.byType(GratovoCard),
    );
    expect(
      find.descendant(
        of: remindersCard,
        matching: find.text('Review Notion contract draft before sending'),
      ),
      findsOneWidget,
    );

    // On a wide window it shares the tiles' row: to the right of the last
    // tile, and starting at roughly the same height.
    final card = tester.getTopLeft(find.text('Upcoming reminders'));
    final lastTile = tester.getTopLeft(find.text('Drafted today'));
    expect(card.dx, greaterThan(lastTile.dx));
    expect((card.dy - lastTile.dy).abs(), lessThan(120));
  });

  testWidgets('the Logs peek card opens the logs screen as a modal',
      (tester) async {
    _sizeTo(tester, const Size(1400, 2200));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(find.text('News'), findsOneWidget);
    expect(find.text('Logs'), findsOneWidget);

    await tester.tap(find.text('Logs'));
    await tester.pumpAndSettle();

    expect(find.byType(Dialog), findsOneWidget);
    // The close button only appears when the screen is hosted in the modal.
    expect(find.byIcon(Icons.close), findsOneWidget);
  });

  // A fetch that failed used to be indistinguishable from a feed with nothing
  // in it: `maybeWhen(..., orElse: () => null)` folds loading and error into
  // the same null. So the dashboard said "no stories yet" — calm, plausible,
  // and wrong — while the request had in fact never come back. Someone reading
  // that has no reason to retry, and a FutureProvider caches its error as
  // firmly as its data, so nothing retried on their behalf either.
  testWidgets('a news fetch that failed says so rather than looking empty',
      (tester) async {
    _sizeTo(tester, const Size(1400, 2200));
    await tester.pumpWidget(_harness(newsFails: true));
    await tester.pumpAndSettle();

    expect(find.text('Something went wrong.'), findsOneWidget);
    expect(find.text('No news yet'), findsNothing);
  });

  testWidgets('a news fetch that succeeded is not mistaken for a failure',
      (tester) async {
    _sizeTo(tester, const Size(1400, 2200));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    // The other half of the pair. The seeded mocks return stories, so the card
    // shows a headline — what matters is that a working fetch is never dressed
    // up as a broken one.
    expect(find.text('Something went wrong.'), findsNothing);
  });
}
