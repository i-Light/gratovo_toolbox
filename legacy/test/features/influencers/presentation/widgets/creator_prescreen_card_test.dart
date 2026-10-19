// Profile -> Pre-screen (fix #10): views against HC-18, recent uploads,
// sponsorship seen in the videos, country, the HC-08 creator flag and the
// HC-04 gold-mine read.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/creator_prescreen_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

Influencer _channel({
  int subscribers = 150000,
  int? medianViews = 90000,
  int videosLast30 = 4,
  double? sponsoredRatio = 0.4,
  List<String> seenBrands = const ['NordVPN', 'Notion'],
  String? country = 'US',
  List<String> foundEmails = const [],
  List<InfluencerContact> contacts = const [],
  CreatorGender? gender,
}) =>
    Influencer(
      id: 'UC_p',
      handle: '@p',
      channelUrl: '',
      platform: InfluencerPlatform.youtube,
      subscriberCount: subscribers,
      sourceKeywords: const [],
      vettingStatus: VettingStatus.newlyFound,
      discoveredAt: DateTime(2026),
      medianViewsLast30: medianViews,
      videosLast30: videosLast30,
      sponsoredRatio: sponsoredRatio,
      seenBrands: seenBrands,
      country: country,
      foundEmails: foundEmails,
      contacts: contacts,
      creatorGender: gender,
    );

Future<MockInfluencerRepository> _pump(
    WidgetTester tester, Influencer channel) async {
  tester.view.physicalSize = const Size(900, 1400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final repository = MockInfluencerRepository()
    ..replaceAllForTesting([channel]);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      influencerRepositoryProvider.overrideWithValue(repository),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      locale: const Locale('en'),
      home: Scaffold(
        body: SingleChildScrollView(
          child: Builder(
            builder: (context) => CreatorPrescreenCard(
              influencer: channel,
              l10n: AppLocalizations.of(context),
            ),
          ),
        ),
      ),
    ),
  ));
  await tester.pumpAndSettle();
  return repository;
}

void main() {
  testWidgets('the facts a person checks before reaching out', (tester) async {
    await _pump(tester, _channel());

    expect(find.text('Pre-screen'), findsOneWidget);
    expect(find.text('90K median views in 30 days, meets the ~50K bar'),
        findsOneWidget);
    expect(find.text('4 uploads in the last 30 days'), findsOneWidget);
    expect(find.text('Sponsorship disclosures in 40% of the stored videos'),
        findsOneWidget);
    expect(find.text('Seen with: NordVPN, Notion'), findsOneWidget);
    expect(find.text('Country: US'), findsOneWidget);
  });

  testWidgets('below the view bar is said in words', (tester) async {
    await _pump(tester, _channel(medianViews: 12000, videosLast30: 0));

    expect(find.text('12K median views in 30 days, under the ~50K bar'),
        findsOneWidget);
    expect(find.text('No uploads in the last 30 days'), findsOneWidget);
  });

  testWidgets('a gold mine is highlighted with what to do about it',
      (tester) async {
    await _pump(tester, _channel());

    expect(find.text('Gold mine'), findsOneWidget);
    expect(
        find.textContaining('exclusive management at 20-40%'), findsOneWidget);
  });

  testWidgets('a creator with an agent takes the discount path',
      (tester) async {
    await _pump(tester, _channel(foundEmails: const ['jo@talentmgmt.com']));

    expect(find.text('Gold mine'), findsNothing);
    expect(find.textContaining('Has an agent'), findsOneWidget);
  });

  testWidgets('the creator flag is recorded and out of scope says so',
      (tester) async {
    final repository = await _pump(tester, _channel());

    await tester.tap(find.byKey(const ValueKey('creator-flag')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Couple').last);
    await tester.pumpAndSettle();

    expect((await repository.getById('UC_p'))!.creatorGender,
        CreatorGender.couple);
  });

  testWidgets('a flagged channel shows the HC-08 warning', (tester) async {
    await _pump(tester, _channel(gender: CreatorGender.female));

    expect(
        find.text('Out of scope: the agency does not contact or pitch female '
            'creators or couple channels.'),
        findsOneWidget);
    expect(find.byIcon(Icons.block), findsOneWidget);
  });
}
