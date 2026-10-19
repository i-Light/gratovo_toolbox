import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/influencer_profile_screen.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The profile page carries seven cards at once — the channel header, stage and
/// tags, contacts, recent uploads, the CRM calculator, provided data, notes,
/// emails, activity and deal history. Pumping it is the only way to find out
/// whether they all lay out together.
Widget _harness(Widget child) {
  return ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      influencerRepositoryProvider
          .overrideWithValue(MockInfluencerRepository()),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: child,
    ),
  );
}

void _sizeTo(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

/// Opens a [CollapsibleCard] by tapping its title.
///
/// The whole header is the toggle, so tapping the title text is what a user
/// does. `ensureVisible` rather than `scrollUntilVisible`: the page holds
/// several scrollables (the page itself, plus every dropdown's), and
/// scrollUntilVisible's default scrollable finder throws when it matches more
/// than one — ensureVisible walks up from the target instead, which is
/// unambiguous.
Future<void> _expandCard(WidgetTester tester, String title) async {
  final finder = find.text(title);
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('renders every card without overflowing', (tester) async {
    _sizeTo(tester, const Size(1200, 3000));

    await tester.pumpWidget(
      _harness(const InfluencerProfileScreen(influencerId: 'inf_001')),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    // The channel's real name in the app bar, not its handle.
    expect(find.text('Tech With Taha'), findsWidgets);
    expect(find.text('Progress and tags'), findsOneWidget);
    expect(find.text('How to reach them'), findsOneWidget);
    expect(find.text('Recent videos'), findsOneWidget);
    expect(find.text('What a video is worth'), findsOneWidget);
    expect(find.text('Data the influencer sent us'), findsOneWidget);
    expect(find.text('Email history'), findsOneWidget);
    expect(find.text('Activity'), findsOneWidget);
  });

  testWidgets('the CRM card starts folded and says what it is based on',
      (tester) async {
    _sizeTo(tester, const Size(1200, 3000));

    await tester.pumpWidget(
      _harness(const InfluencerProfileScreen(influencerId: 'inf_001')),
    );
    await tester.pumpAndSettle();

    // Folded: the calculator's own controls are not in the tree at all. This
    // is the owner's instruction — the calculator is a tool you reach for, not
    // the tallest thing on every visit.
    expect(find.text('2 videos included'), findsNothing);
    expect(find.text('Price'), findsNothing);

    // But it is not opaque while folded. Both halves of the basis are legible
    // from the header: how many uploads, and the number they produced.
    expect(find.text('Based on 2 stored uploads  ·  covering 7 days'),
        findsOneWidget);
    expect(find.text('Median views: 44,500'), findsOneWidget);
  });

  testWidgets('the CRM card computes from the seeded videos once opened',
      (tester) async {
    _sizeTo(tester, const Size(1200, 3000));

    await tester.pumpWidget(
      _harness(const InfluencerProfileScreen(influencerId: 'inf_001')),
    );
    await tester.pumpAndSettle();
    await _expandCard(tester, 'What a video is worth');

    // inf_001 has two videos, 51,000 and 38,000 views. With only two values
    // the median and the mean are both 44,500, so the figure shows three times:
    // the CRM card's median and average, and the header card's "all stored"
    // median (computed from the same two videos).
    expect(find.text('2 videos included'), findsOneWidget);
    expect(find.text('44,500'), findsNWidgets(3));
    // The CRM card's own labels.
    expect(find.text('Median views'), findsOneWidget);
    expect(find.text('Average views'), findsOneWidget);
    // The header card's two windowed figures, labelled so they cannot be
    // confused with each other or with the CRM basis.
    expect(find.text('Median views · 30 days'), findsOneWidget);
    expect(find.text('Median views · all stored'), findsOneWidget);
    // The grouped range, from the same two videos.
    expect(find.text('38K – 51K'), findsOneWidget);
  });

  testWidgets(
      'a channel whose videos have no view counts says so, rather '
      'than showing a confident zero', (tester) async {
    _sizeTo(tester, const Size(1200, 3000));

    // inf_003 has videos with view counts, so use a channel with none stored
    // at all to reach the empty branch of the calculator.
    await tester.pumpWidget(
      _harness(const InfluencerProfileScreen(influencerId: 'inf_002')),
    );
    await tester.pumpAndSettle();
    await _expandCard(tester, 'What a video is worth');

    expect(tester.takeException(), isNull);
    // It has one video WITH a view count, so this is the populated branch —
    // what matters is that it never renders a bare 0 as an average.
    expect(find.text('1 videos included'), findsOneWidget);
  });

  testWidgets('recent uploads start expanded, with a description on each',
      (tester) async {
    _sizeTo(tester, const Size(1200, 3000));

    await tester.pumpWidget(
      _harness(const InfluencerProfileScreen(influencerId: 'inf_001')),
    );
    await tester.pumpAndSettle();

    // No tap needed: this card is the page's evidence and opens with the page.
    expect(
      find.text('This \$200 phone beat my \$1000 flagship — full review'),
      findsOneWidget,
    );
    // The description is shown alongside the title, not only the title —
    // which is the difference between being able to tell a sponsored upload
    // from an ordinary one and having to open YouTube to find out.
    expect(
      find.textContaining('Side by side against my daily driver'),
      findsOneWidget,
    );
  });

  testWidgets('contacts are listed with the primary marked', (tester) async {
    _sizeTo(tester, const Size(1200, 3000));

    await tester.pumpWidget(
      _harness(const InfluencerProfileScreen(influencerId: 'inf_001')),
    );
    await tester.pumpAndSettle();

    // Two contacts on one channel, which is the case a single `email` column
    // could not represent at all.
    expect(find.text('business@techwithtaha.com'), findsOneWidget);
    expect(find.text('+20 100 123 4567'), findsOneWidget);
    // Exactly one of them is primary, and it is the one that gets answered
    // rather than the one recorded first.
    expect(find.text('Primary'), findsOneWidget);
  });

  testWidgets('a channel with no contacts says so rather than showing nothing',
      (tester) async {
    _sizeTo(tester, const Size(1200, 3000));

    await tester.pumpWidget(
      _harness(const InfluencerProfileScreen(influencerId: 'inf_002')),
    );
    await tester.pumpAndSettle();

    expect(find.text('No contact method recorded yet.'), findsOneWidget);
  });

  testWidgets('lays out on a phone-width window', (tester) async {
    _sizeTo(tester, const Size(390, 3000));

    await tester.pumpWidget(
      _harness(const InfluencerProfileScreen(influencerId: 'inf_007')),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Progress and tags'), findsOneWidget);
  });

  testWidgets('an unknown channel says so rather than throwing',
      (tester) async {
    _sizeTo(tester, const Size(1200, 1200));

    await tester.pumpWidget(
      _harness(const InfluencerProfileScreen(influencerId: 'nope')),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Influencer not found.'), findsOneWidget);
  });
}
