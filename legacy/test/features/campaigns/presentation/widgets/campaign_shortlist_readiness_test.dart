// A campaign's shortlist is where a brand pitch is put together: each row says
// whether that creator may go into it (BRD-PRES-15), and Start deal is there.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/campaign_shortlist_entry.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/media_kit.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_campaign_shortlist_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/campaigns/presentation/widgets/campaign_shortlist_section.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

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

void main() {
  testWidgets('each shortlisted creator says whether they can be pitched',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 1400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final shortlist = MockCampaignShortlistRepository();
    for (final id in ['ready', 'notyet']) {
      await shortlist.add(CampaignShortlistEntry(
        id: '',
        campaignId: 'campaign_x',
        channelId: id,
        addedAt: DateTime(2026),
      ));
    }
    await tester.pumpWidget(ProviderScope(
      overrides: [
        supabaseBootProvider.overrideWithValue(
          const SupabaseBoot(
            config: SupabaseConfig(url: '', anonKey: ''),
            error: 'no server configured in this test',
          ),
        ),
        campaignShortlistRepositoryProvider.overrideWithValue(shortlist),
        influencerRepositoryProvider.overrideWithValue(
          MockInfluencerRepository()
            ..replaceAllForTesting([
              _creator('ready',
                  kit: const MediaKit(
                    countries: [AudienceShare(code: 'US', pct: 40)],
                    ageBand: '18-34',
                    rates: [
                      RateCardRow(
                          format: 'integration', price: 900, agreed: true),
                    ],
                  )),
              _creator('notyet'),
            ]),
        ),
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

    expect(find.text('@ready'), findsOneWidget);
    expect(find.text('Ready to pitch'), findsOneWidget);
    expect(find.text('Not ready to pitch yet'), findsOneWidget);
    expect(find.byTooltip('Start deal'), findsNWidgets(2));
  });
}
