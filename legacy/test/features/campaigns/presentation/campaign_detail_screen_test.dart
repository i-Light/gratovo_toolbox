import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/localization/locale_provider.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/toast/toast_overlay.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_campaign_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_campaign_shortlist_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_channel_rate_history_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/campaigns/presentation/campaign_detail_screen.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Pins the UI to English — see `campaigns_section_test.dart`'s
/// `_EnglishLocale` for why.
class _EnglishLocale extends LocaleNotifier {
  @override
  Locale build() => const Locale('en');
}

Widget _harness({
  required String campaignId,
  MockCampaignRepository? campaignRepository,
  MockCampaignShortlistRepository? shortlistRepository,
  MockChannelRateHistoryRepository? rateHistoryRepository,
}) {
  final router = GoRouter(
    initialLocation: '/brands/brand_001/campaigns/$campaignId',
    routes: [
      GoRoute(
        path: '/brands/:id',
        builder: (context, state) =>
            const Scaffold(body: Text('brand profile')),
        routes: [
          GoRoute(
            path: 'campaigns/:campaignId',
            builder: (context, state) => CampaignDetailScreen(
              campaignId: state.pathParameters['campaignId']!,
            ),
          ),
        ],
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      localeProvider.overrideWith(_EnglishLocale.new),
      campaignRepositoryProvider
          .overrideWithValue(campaignRepository ?? MockCampaignRepository()),
      campaignShortlistRepositoryProvider.overrideWithValue(
        shortlistRepository ?? MockCampaignShortlistRepository(),
      ),
      channelRateHistoryRepositoryProvider.overrideWithValue(
        rateHistoryRepository ?? MockChannelRateHistoryRepository(),
      ),
    ],
    child: MaterialApp.router(
      routerConfig: router,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      builder: (context, child) => ToastOverlay(child: child!),
    ),
  );
}

void main() {
  testWidgets('shows the campaign, its notes, and its seeded shortlist',
      (tester) async {
    await tester.pumpWidget(_harness(campaignId: 'campaign_001'));
    await tester.pumpAndSettle();

    // Appears both in the app bar title and the editable name field.
    expect(find.text('Spring safe-travel push'), findsWidgets);
    expect(
      find.text('Focused on the privacy and safe-travel-wifi angle.'),
      findsOneWidget,
    );
    // The two shortlist_ rows MockCampaignShortlistRepository seeds for
    // campaign_001.
    expect(find.text('UC_sample_channel_1'), findsOneWidget);
    expect(find.text('UC_sample_channel_2'), findsOneWidget);
  });

  testWidgets('a missing campaign shows the not-found state', (tester) async {
    await tester.pumpWidget(_harness(campaignId: 'does_not_exist'));
    await tester.pumpAndSettle();

    expect(find.text('Campaign not found.'), findsOneWidget);
  });

  testWidgets('changing the status dropdown persists the new status',
      (tester) async {
    final repository = MockCampaignRepository();
    await tester.pumpWidget(
      _harness(campaignId: 'campaign_001', campaignRepository: repository),
    );
    await tester.pumpAndSettle();

    expect(find.text('Active'), findsOneWidget);

    await tester.tap(find.text('Active'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Closed').last);
    await tester.pumpAndSettle();

    final saved = await repository.getById('campaign_001');
    expect(saved?.status.name, 'closed');
  });

  testWidgets(
      'adding a shortlisted channel with rate history freezes its price snapshot',
      (tester) async {
    final shortlistRepository = MockCampaignShortlistRepository();
    await tester.pumpWidget(
      _harness(
        campaignId: 'campaign_001',
        shortlistRepository: shortlistRepository,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Add channel'));
    await tester.pumpAndSettle();
    expect(find.text('Add a channel to the shortlist'), findsOneWidget);

    // UC_sample_channel_1 has one closed-deal rate history entry seeded in
    // MockChannelRateHistoryRepository (brandPrice 1200, payout 900).
    await tester.enterText(
      find.byType(TextFormField).first,
      'UC_sample_channel_1',
    );
    await tester.tap(find.text('Add').last);
    await tester.pumpAndSettle();

    expect(find.text('Channel added to the shortlist'), findsOneWidget);

    final entries = await shortlistRepository.getForCampaign('campaign_001');
    final added = entries.last;
    expect(added.channelId, 'UC_sample_channel_1');
    expect(added.priceBasisSnapshot, isNotNull);
    expect(added.priceBasisSnapshot!['brandPrice'], 1200);
    expect(added.priceBasisSnapshot!['influencerPayout'], 900);
    // Unique to the new entry — the seeded shortlist_001 snapshot has no
    // `influencerPayout` key, only `brandPrice` (and an old `medianViews`
    // key this UI doesn't read), so "900" only appears here.
    expect(find.textContaining('900'), findsOneWidget);
  });

  testWidgets('adding a channel with no rate history leaves the snapshot null',
      (tester) async {
    final shortlistRepository = MockCampaignShortlistRepository();
    await tester.pumpWidget(
      _harness(
        campaignId: 'campaign_001',
        shortlistRepository: shortlistRepository,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Add channel'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextFormField).first,
      'UC_never_closed_a_deal',
    );
    await tester.tap(find.text('Add').last);
    await tester.pumpAndSettle();

    final entries = await shortlistRepository.getForCampaign('campaign_001');
    final added = entries.last;
    expect(added.channelId, 'UC_never_closed_a_deal');
    expect(added.priceBasisSnapshot, isNull);
  });

  testWidgets(
      'removing a shortlist entry asks for confirmation, then removes it',
      (tester) async {
    final shortlistRepository = MockCampaignShortlistRepository();
    await tester.pumpWidget(
      _harness(
        campaignId: 'campaign_001',
        shortlistRepository: shortlistRepository,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('UC_sample_channel_1'), findsOneWidget);

    await tester.ensureVisible(find.byTooltip('Remove from shortlist').first);
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Remove from shortlist').first);
    await tester.pumpAndSettle();
    expect(find.text('Remove this channel?'), findsOneWidget);

    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();

    expect(find.text('Removed from the shortlist'), findsOneWidget);
    final remaining = await shortlistRepository.getForCampaign('campaign_001');
    expect(remaining, hasLength(1));
  });

  testWidgets(
      'deleting the campaign asks for confirmation, then returns to the brand',
      (tester) async {
    final repository = MockCampaignRepository();
    await tester.pumpWidget(
      _harness(campaignId: 'campaign_001', campaignRepository: repository),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Delete campaign'));
    await tester.pumpAndSettle();
    expect(find.text('Delete this campaign?'), findsOneWidget);

    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();

    expect(find.text('Campaign deleted'), findsOneWidget);
    expect(find.text('brand profile'), findsOneWidget);
    expect(await repository.getById('campaign_001'), isNull);
  });
}
