// Start deal, edit its terms, record its two contracts (fix #6; decisions
// payment-terms and contract-order; HC-08, HC-09).
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/agency_settings.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_agency_settings_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_brand_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_channel_rate_history_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_deal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/deal_contracts_card.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/deal_terms_dialog.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/start_deal_dialog.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

class _World {
  final deals = MockDealRepository();
  final influencers = MockInfluencerRepository();
  final agency = MockAgencySettingsRepository();
}

Future<_World> _pump(
  WidgetTester tester,
  Widget Function(BuildContext context) body, {
  List<String> boycott = const [],
}) async {
  tester.view.physicalSize = const Size(1000, 1800);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final world = _World();
  await world.agency.save(AgencySettings(boycottBrands: boycott));
  await tester.pumpWidget(ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      dealRepositoryProvider.overrideWithValue(world.deals),
      influencerRepositoryProvider.overrideWithValue(world.influencers),
      brandRepositoryProvider.overrideWithValue(MockBrandRepository()),
      agencySettingsRepositoryProvider.overrideWithValue(world.agency),
      channelRateHistoryRepositoryProvider
          .overrideWithValue(MockChannelRateHistoryRepository()),
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
      home: Scaffold(body: Builder(builder: body)),
    ),
  ));
  await tester.pumpAndSettle();
  return world;
}

Finder _field(String key) => find.byKey(ValueKey('deal-$key'));

Future<void> _pickBrand(WidgetTester tester, String name) async {
  await tester.tap(_field('brand'));
  await tester.pumpAndSettle();
  await tester.tap(find.text(name).last);
  await tester.pumpAndSettle();
}

Deal _deal({DealContract creator = const DealContract()}) => Deal(
      id: 'deal_001',
      brandId: 'brand_001',
      influencerId: 'inf_001',
      stage: DealStage.agreed,
      brandPrice: 1000,
      influencerPayout: 700,
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
      creatorContract: creator,
    );

void main() {
  group('Start deal', () {
    testWidgets('a deal is started with its terms and the channel moves on',
        (tester) async {
      late Influencer creator;
      final world = await _pump(tester, (context) {
        return FilledButton(
          onPressed: () => showStartDealDialog(context, creator: creator),
          child: const Text('start'),
        );
      });
      creator = (await world.influencers.getById('inf_002'))!;

      await tester.tap(find.text('start'));
      await tester.pumpAndSettle();
      await _pickBrand(tester, 'Notion');
      await tester.enterText(_field('price'), '3000');
      await tester.enterText(_field('payout'), '2000');
      await tester.enterText(_field('payment-terms'), '50% upfront');
      await tester.tap(find.text('Start deal').last);
      await tester.pumpAndSettle();

      final deal = (await world.deals.getByInfluencer('inf_002'))
          .firstWhere((d) => d.brandPrice == 3000);
      expect(deal.brandId, 'brand_002');
      expect(deal.influencerPayout, 2000);
      expect(deal.paymentTerms, '50% upfront');
      expect(deal.stage, DealStage.proposed);
      expect((await world.influencers.getById('inf_002'))!.pipelineStage,
          PipelineStage.negotiating);
    });

    testWidgets('a boycotted brand is refused', (tester) async {
      late Influencer creator;
      final world = await _pump(
        tester,
        (context) => FilledButton(
          onPressed: () => showStartDealDialog(context, creator: creator),
          child: const Text('start'),
        ),
        boycott: const ['Notion'],
      );
      creator = (await world.influencers.getById('inf_002'))!;
      final before = (await world.deals.getByInfluencer('inf_002')).length;

      await tester.tap(find.text('start'));
      await tester.pumpAndSettle();
      await _pickBrand(tester, 'Notion');
      await tester.enterText(_field('price'), '3000');
      await tester.enterText(_field('payout'), '2000');

      expect(
          find.textContaining('On the boycott list (Notion)'), findsOneWidget);
      final start = tester.widget<FilledButton>(
          find.widgetWithText(FilledButton, 'Start deal').last);
      expect(start.onPressed, isNull);
      expect((await world.deals.getByInfluencer('inf_002')).length, before);
    });

    testWidgets('an out-of-scope creator gets no deal (HC-08)', (tester) async {
      late Influencer creator;
      final world = await _pump(tester, (context) {
        return FilledButton(
          onPressed: () => showStartDealDialog(context, creator: creator),
          child: const Text('start'),
        );
      });
      creator = (await world.influencers.getById('inf_002'))!
          .copyWith(creatorGender: CreatorGender.female);

      await tester.tap(find.text('start'));
      await tester.pumpAndSettle();

      expect(find.textContaining('Out of scope'), findsOneWidget);
      expect(
          tester
              .widget<FilledButton>(
                  find.widgetWithText(FilledButton, 'Start deal').last)
              .onPressed,
          isNull);
    });
  });

  testWidgets('terms are edited and saved as one unit', (tester) async {
    final world = await _pump(tester, (context) {
      return FilledButton(
        onPressed: () => showDealTermsDialog(context, _deal()),
        child: const Text('terms'),
      );
    });

    await tester.tap(find.text('terms'));
    await tester.pumpAndSettle();
    expect(
        tester.widget<TextFormField>(_field('price')).controller!.text, '1000');
    await tester.enterText(_field('price'), '1200');
    await tester.enterText(_field('tracking-link'), 'https://x.example/?r=1');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    final saved = (await world.deals.getById('deal_001'))!;
    expect(saved.brandPrice, 1200);
    expect(saved.trackingLink, 'https://x.example/?r=1');
  });

  group('contracts, in the course order', () {
    testWidgets('the brand cannot be marked signed before the creator',
        (tester) async {
      await _pump(
          tester,
          (context) =>
              SingleChildScrollView(child: DealContractsCard(deal: _deal())));

      expect(
          find.text('The brand\x27s contract is the template. The creator '
              'signs first, then the brand.'),
          findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('contract-brand-update')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('contract-status')));
      await tester.pumpAndSettle();

      final signed = tester.widget<DropdownMenuItem<ContractStatus>>(
          find.widgetWithText(DropdownMenuItem<ContractStatus>, 'Signed').last);
      expect(signed.enabled, isFalse);
      expect(find.text('The brand signs after the creator.'), findsWidgets);
    });

    testWidgets('a signed creator contract is recorded with its date',
        (tester) async {
      final world = await _pump(
          tester,
          (context) =>
              SingleChildScrollView(child: DealContractsCard(deal: _deal())));

      await tester.tap(find.byKey(const ValueKey('contract-creator-update')));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.byKey(const ValueKey('contract-url')), 'https://docs.example/c');
      await tester.tap(find.byKey(const ValueKey('contract-status')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Signed').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      final saved = (await world.deals.getById('deal_001'))!;
      expect(saved.creatorContract.status, ContractStatus.signed);
      expect(saved.creatorContract.url, 'https://docs.example/c');
      expect(saved.creatorContract.signedAt, isNotNull);
    });
  });
}
