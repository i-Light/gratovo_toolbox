// A brand pitch starts from the campaign's shortlist (final review I5): only
// creators ready to pitch go into it (BRD-PRES-15), the others are named and
// left out, and the draft waits in the Comms queue like any other.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/toast/notification_center.dart';
import 'package:gratovo_toolbox/data/models/brand.dart';
import 'package:gratovo_toolbox/data/models/campaign.dart';
import 'package:gratovo_toolbox/data/models/campaign_shortlist_entry.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/media_kit.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_brand_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_campaign_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_campaign_shortlist_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_comms_proposal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/campaigns/presentation/widgets/campaign_shortlist_section.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

import '../../../../support/fake_gemini_bridge.dart';

const _readyKit = MediaKit(
  countries: [AudienceShare(code: 'US', pct: 40)],
  ageBand: '18-34',
  rates: [RateCardRow(format: 'integration', price: 900, agreed: true)],
);

const _proposal = {
  'status': 'ready',
  'proposal': {
    'situation': {'side': 'brand', 'stage': 'prospect'},
    'decision': {'action': 'send_message', 'why': 'Pitch the ready creator.'},
    'message': {'subject': 'A creator for your launch', 'body': 'Hi Dana,'},
    'needs_human': [],
  },
  'gates': [],
  'findings': [],
};

Influencer _creator(String id, {MediaKit? kit}) => Influencer(
      id: id,
      handle: '@$id',
      channelUrl: '',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 100000,
      sourceKeywords: const [],
      vettingStatus: VettingStatus.shortlisted,
      discoveredAt: DateTime(2026),
      mediaKit: kit,
    );

Future<FakeGeminiBridge> _pump(
  WidgetTester tester, {
  required List<Influencer> creators,
  String contactEmail = 'dana@brand.io',
}) async {
  tester.view.physicalSize = const Size(1000, 1400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final shortlist = MockCampaignShortlistRepository();
  for (final creator in creators) {
    await shortlist.add(CampaignShortlistEntry(
      id: '',
      campaignId: 'campaign_x',
      channelId: creator.id,
      addedAt: DateTime(2026),
    ));
  }
  final campaigns = MockCampaignRepository();
  await campaigns.create(Campaign(
    id: 'campaign_x',
    brandId: 'brand_x',
    name: 'Launch',
    createdAt: DateTime(2026),
    updatedAt: DateTime(2026),
  ));
  final brands = MockBrandRepository();
  await brands.create(Brand(
    id: 'brand_x',
    name: 'Acme AI',
    createdAt: DateTime(2026),
    contacts: [
      if (contactEmail.isNotEmpty)
        BrandContact(name: 'Dana', email: contactEmail, isPrimary: true),
    ],
  ));
  final bridge = FakeGeminiBridge()..answer('action.comms_propose', _proposal);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      campaignShortlistRepositoryProvider.overrideWithValue(shortlist),
      campaignRepositoryProvider.overrideWithValue(campaigns),
      brandRepositoryProvider.overrideWithValue(brands),
      influencerRepositoryProvider.overrideWithValue(
          MockInfluencerRepository()..replaceAllForTesting(creators)),
      geminiBridgeProvider.overrideWithValue(bridge),
      commsProposalRepositoryProvider
          .overrideWithValue(MockCommsProposalRepository()),
      outreachRepositoryProvider.overrideWithValue(MockOutreachRepository()),
    ],
    child: const MaterialApp(
      localizationsDelegates: [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      locale: Locale('en'),
      home: Scaffold(
        body: SingleChildScrollView(
          child: CampaignShortlistSection(campaignId: 'campaign_x'),
        ),
      ),
    ),
  ));
  await tester.pumpAndSettle();
  return bridge;
}

List<String> _toasts(WidgetTester tester) => [
      for (final entry in ProviderScope.containerOf(
              tester.element(find.byType(CampaignShortlistSection)))
          .read(notificationCenterProvider)
          .history)
        entry.message,
    ];

void main() {
  testWidgets('a pitch goes to the brand contact with the ready creators only',
      (tester) async {
    final bridge = await _pump(tester, creators: [
      _creator('ready', kit: _readyKit),
      _creator('notyet'),
    ]);

    await tester.tap(find.text('Draft pitch to brand'));
    await tester.pumpAndSettle();
    // The ones left out are named before anything is asked.
    expect(
        find.descendant(
            of: find.byType(AlertDialog),
            matching: find.textContaining('@notyet')),
        findsOneWidget);
    await tester.tap(find.text('Draft pitch'));
    await tester.pumpAndSettle();

    final asked = bridge.lastCall('action.comms_propose')!.params['request']!
        as Map<String, Object?>;
    expect(asked['brandId'], 'brand_x');
    expect(asked['contactEmail'], 'dana@brand.io');
    expect(asked['pitchChannelIds'], ['ready']);
    expect(_toasts(tester).last, contains('Comms queue'));
  });

  testWidgets('with nobody ready, nothing is asked and it says why',
      (tester) async {
    final bridge = await _pump(tester, creators: [_creator('notyet')]);

    await tester.tap(find.text('Draft pitch to brand'));
    await tester.pumpAndSettle();

    expect(bridge.lastCall('action.comms_propose'), isNull);
    expect(_toasts(tester).last, contains('ready to pitch'));
  });

  testWidgets('a brand with no contact email says to add one', (tester) async {
    final bridge = await _pump(tester,
        creators: [_creator('ready', kit: _readyKit)], contactEmail: '');

    await tester.tap(find.text('Draft pitch to brand'));
    await tester.pumpAndSettle();

    expect(bridge.lastCall('action.comms_propose'), isNull);
    expect(_toasts(tester).last, contains('email'));
  });
}
