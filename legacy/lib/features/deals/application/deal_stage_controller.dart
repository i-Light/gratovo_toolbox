import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/logging/activity_logger.dart';
import 'package:gratovo_toolbox/data/models/channel_rate_history_entry.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/edit_conflict.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';

/// Where a channel stands while its deal is at [stage] — the channel's
/// pipeline stage follows its latest deal (fix #6).
PipelineStage pipelineStageForDeal(DealStage stage) => switch (stage) {
      DealStage.proposed || DealStage.negotiating => PipelineStage.negotiating,
      DealStage.agreed || DealStage.contractSent => PipelineStage.contract,
      DealStage.signed || DealStage.live => PipelineStage.awaitingDelivery,
      DealStage.closed => PipelineStage.paid,
      DealStage.lost => PipelineStage.lost,
    };

/// Wraps [DealRepository.updateStage] with the one side effect a stage
/// change can trigger: the first time a deal reaches [DealStage.closed], its
/// numbers are recorded as a [ChannelRateHistoryEntry] — see that model's
/// doc comment for why it exists at all. That's what lets the team price a
/// new proposal against what a channel has actually gone for before.
///
/// "Fresh close" is decided from the stage [updateStage]'s caller already has
/// in hand, checked *before* the write goes out — `!isTerminal-before →
/// closed`, i.e. the deal was neither already closed nor already lost. That
/// excludes re-saving an already-closed deal (no-op stage change), moving a
/// deal between any two non-terminal stages, and reviving a lost deal
/// straight to closed being treated as anything other than the one real close
/// it is. Nothing here re-reads the deal to check, so there is exactly one
/// write of the stage and, on a fresh close, exactly one write of the rate
/// history entry — never a duplicate from two callers racing a re-read.
class DealStageController {
  DealStageController(this._ref);

  final Ref _ref;

  /// Moves [deal] to [stage]. When this is [deal]'s first arrival at
  /// [DealStage.closed] (see the class doc comment), also records one
  /// [ChannelRateHistoryEntry] for [deal]'s channel — `deal.influencerId`,
  /// per [Deal]'s own doc comment on why that field names a channel — using
  /// that channel's current [Influencer.medianViewsLast30].
  Future<void> updateStage(Deal deal, DealStage stage) async {
    final isFreshClose = !deal.stage.isTerminal && stage == DealStage.closed;

    await _ref.read(dealRepositoryProvider).updateStage(deal.id, stage);
    await followLatestDeal(deal, stage);

    if (!isFreshClose) return;

    final channel = await _ref
        .read(influencerRepositoryProvider)
        .getById(deal.influencerId);

    await _ref.read(channelRateHistoryRepositoryProvider).record(
          ChannelRateHistoryEntry(
            id: '',
            channelId: deal.influencerId,
            dealId: deal.id,
            brandPrice: deal.brandPrice,
            influencerPayout: deal.influencerPayout,
            medianViewsAtDeal: channel?.medianViewsLast30,
            closedAt: DateTime.now(),
          ),
        );
  }

  /// Moves [deal]'s channel to the stage [stage] means, when [deal] is that
  /// channel's latest deal — an older deal finishing never overrides a newer
  /// one. Through the ordinary compare-and-set edit, and logged like a stage
  /// a person picked.
  Future<void> followLatestDeal(Deal deal, DealStage stage) async {
    if (deal.influencerId.isEmpty) return;
    final deals = await _ref
        .read(dealRepositoryProvider)
        .getByInfluencer(deal.influencerId);
    Deal? latest;
    for (final candidate in deals) {
      if (latest == null || candidate.createdAt.isAfter(latest.createdAt)) {
        latest = candidate;
      }
    }
    if (latest == null || latest.id != deal.id) return;
    final influencers = _ref.read(influencerRepositoryProvider);
    final channel = await influencers.getById(deal.influencerId);
    if (channel == null) return;
    final next = pipelineStageForDeal(stage);
    final before = channel.pipelineStage;
    if (before == next) return;
    final outcome =
        await influencers.updatePipelineStage(channel.id, next, base: before);
    if (outcome != EditOutcome.applied) return;
    _ref.read(dataRevisionsProvider.notifier).bump({DataDomain.channels});
    // Best-effort, like every log write: the stage has moved either way.
    try {
      _ref
          .read(activityLoggerProvider)
          .channelStageChanged(channel, before: before, after: next);
    } on Object catch (_) {}
  }
}

final dealStageControllerProvider = Provider<DealStageController>((ref) {
  return DealStageController(ref);
});
