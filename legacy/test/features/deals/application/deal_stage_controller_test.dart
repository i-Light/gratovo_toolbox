import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_channel_rate_history_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_deal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/deals/application/deal_stage_controller.dart';

/// A [Deal] shaped for [DealStageController] tests: only [stage] varies
/// between cases, so each test's intent is legible from its one changed
/// argument. Not required to be one of [MockDealRepository]'s own seeded
/// rows — [DealStageController] decides the rate-history write entirely from
/// the [Deal] it is handed, never by re-reading the deal repository.
Deal _dealWith({
  String id = 'deal_x',
  required DealStage stage,
  String influencerId = 'inf_001',
}) {
  return Deal(
    id: id,
    brandId: 'brand_x',
    influencerId: influencerId,
    stage: stage,
    brandPrice: 1000,
    influencerPayout: 750,
    createdAt: DateTime(2026, 1, 1),
    updatedAt: DateTime(2026, 1, 1),
  );
}

ProviderContainer _container({
  required MockDealRepository deals,
  required MockInfluencerRepository influencers,
  required MockChannelRateHistoryRepository rateHistory,
}) {
  final container = ProviderContainer(
    overrides: [
      dealRepositoryProvider.overrideWithValue(deals),
      influencerRepositoryProvider.overrideWithValue(influencers),
      channelRateHistoryRepositoryProvider.overrideWithValue(rateHistory),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('the channel stage follows its latest deal', () {
    test('each deal stage maps to the channel stage it means', () {
      expect({
        for (final stage in DealStage.values) stage: pipelineStageForDeal(stage)
      }, {
        DealStage.proposed: PipelineStage.negotiating,
        DealStage.negotiating: PipelineStage.negotiating,
        DealStage.agreed: PipelineStage.contract,
        DealStage.contractSent: PipelineStage.contract,
        DealStage.signed: PipelineStage.awaitingDelivery,
        DealStage.live: PipelineStage.awaitingDelivery,
        DealStage.closed: PipelineStage.paid,
        DealStage.lost: PipelineStage.lost,
      });
    });

    test('moving the latest deal moves the channel', () async {
      final deals = MockDealRepository();
      final influencers = MockInfluencerRepository();
      final controller = _container(
        deals: deals,
        influencers: influencers,
        rateHistory: MockChannelRateHistoryRepository(),
      ).read(dealStageControllerProvider);
      final latest = await deals.create(Deal(
        id: '',
        brandId: 'brand_x',
        influencerId: 'inf_002',
        stage: DealStage.proposed,
        brandPrice: 1000,
        influencerPayout: 700,
        createdAt: DateTime(2030),
        updatedAt: DateTime(2030),
      ));

      await controller.updateStage(latest, DealStage.contractSent);

      expect((await influencers.getById('inf_002'))!.pipelineStage,
          PipelineStage.contract);
    });

    test('an older deal does not move the channel past a newer one', () async {
      final deals = MockDealRepository();
      final influencers = MockInfluencerRepository();
      final controller = _container(
        deals: deals,
        influencers: influencers,
        rateHistory: MockChannelRateHistoryRepository(),
      ).read(dealStageControllerProvider);
      Deal deal(DateTime at) => Deal(
            id: '',
            brandId: 'brand_x',
            influencerId: 'inf_002',
            stage: DealStage.proposed,
            brandPrice: 1000,
            influencerPayout: 700,
            createdAt: at,
            updatedAt: at,
          );
      final older = await deals.create(deal(DateTime(2029)));
      await deals.create(deal(DateTime(2030)));
      final before = (await influencers.getById('inf_002'))!.pipelineStage;

      await controller.updateStage(older, DealStage.lost);

      expect((await influencers.getById('inf_002'))!.pipelineStage, before);
    });
  });

  group('DealStageController.updateStage', () {
    test(
        'a fresh close moves the stage and writes one rate-history entry '
        "using the channel's current median views", () async {
      final rateHistory = MockChannelRateHistoryRepository();
      final controller = _container(
        deals: MockDealRepository(),
        influencers: MockInfluencerRepository(), // inf_001: 42000
        rateHistory: rateHistory,
      ).read(dealStageControllerProvider);

      // deal_001 is seeded at DealStage.signed for inf_001.
      final deal = _dealWith(id: 'deal_001', stage: DealStage.signed);

      await controller.updateStage(deal, DealStage.closed);

      final entries = await rateHistory.getForChannel('inf_001');
      expect(entries, hasLength(1));
      expect(entries.single.dealId, 'deal_001');
      expect(entries.single.brandPrice, 1000);
      expect(entries.single.influencerPayout, 750);
      expect(entries.single.margin, 250);
      expect(entries.single.medianViewsAtDeal, 42000);
    });

    test('re-saving an already-closed deal writes nothing new', () async {
      final rateHistory = MockChannelRateHistoryRepository();
      final before = (await rateHistory.getForChannel('inf_001')).length;
      final controller = _container(
        deals: MockDealRepository(),
        influencers: MockInfluencerRepository(),
        rateHistory: rateHistory,
      ).read(dealStageControllerProvider);

      final alreadyClosed = _dealWith(stage: DealStage.closed);

      await controller.updateStage(alreadyClosed, DealStage.closed);

      final after = await rateHistory.getForChannel('inf_001');
      expect(after.length, before);
    });

    test(
        'a lost deal moved straight to closed is not a fresh close — it was '
        'already terminal', () async {
      final rateHistory = MockChannelRateHistoryRepository();
      final before = (await rateHistory.getForChannel('inf_001')).length;
      final controller = _container(
        deals: MockDealRepository(),
        influencers: MockInfluencerRepository(),
        rateHistory: rateHistory,
      ).read(dealStageControllerProvider);

      final lostDeal = _dealWith(stage: DealStage.lost);

      await controller.updateStage(lostDeal, DealStage.closed);

      final after = await rateHistory.getForChannel('inf_001');
      expect(after.length, before);
    });

    test('a stage change that does not land on closed writes nothing',
        () async {
      final rateHistory = MockChannelRateHistoryRepository();
      final before = (await rateHistory.getForChannel('inf_001')).length;
      final controller = _container(
        deals: MockDealRepository(),
        influencers: MockInfluencerRepository(),
        rateHistory: rateHistory,
      ).read(dealStageControllerProvider);

      final deal = _dealWith(stage: DealStage.proposed);

      await controller.updateStage(deal, DealStage.negotiating);

      final after = await rateHistory.getForChannel('inf_001');
      expect(after.length, before);
    });

    test(
        'closing twice in a row (fresh close, then a same-stage re-save) '
        'writes exactly one entry, never two', () async {
      final rateHistory = MockChannelRateHistoryRepository();
      final controller = _container(
        deals: MockDealRepository(),
        influencers: MockInfluencerRepository(),
        rateHistory: rateHistory,
      ).read(dealStageControllerProvider);

      final negotiating =
          _dealWith(id: 'deal_002', stage: DealStage.negotiating);
      await controller.updateStage(negotiating, DealStage.closed);

      final nowClosed = _dealWith(id: 'deal_002', stage: DealStage.closed);
      await controller.updateStage(nowClosed, DealStage.closed);

      final entries = await rateHistory.getForChannel('inf_001');
      expect(entries.where((e) => e.dealId == 'deal_002'), hasLength(1));
    });

    test('medianViewsAtDeal is null when the channel record is not found',
        () async {
      final rateHistory = MockChannelRateHistoryRepository();
      final controller = _container(
        deals: MockDealRepository(),
        influencers: MockInfluencerRepository(),
        rateHistory: rateHistory,
      ).read(dealStageControllerProvider);

      final deal = _dealWith(
        id: 'deal_unmeasured',
        stage: DealStage.negotiating,
        influencerId: 'inf_does_not_exist',
      );

      await controller.updateStage(deal, DealStage.closed);

      final entries = await rateHistory.getForChannel('inf_does_not_exist');
      expect(entries.single.medianViewsAtDeal, isNull);
    });
  });
}
