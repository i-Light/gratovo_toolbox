import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/data/models/campaign_shortlist_entry.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';

/// Adds and removes a campaign's shortlist entries.
class CampaignShortlistController {
  CampaignShortlistController(this._ref);

  final Ref _ref;

  /// Adds [channelId] to [campaignId]'s shortlist.
  ///
  /// **Price snapshot decision:** when [channelId] has at least one
  /// closed-deal entry in `ChannelRateHistoryRepository` (the same lookup
  /// `DealStageController` already uses to record one), the most recent
  /// entry's numbers are frozen into [CampaignShortlistEntry.priceBasisSnapshot]
  /// at add time. When the channel has no rate history yet — never closed a
  /// deal through this app — the snapshot is left null rather than inventing
  /// a new lookup (e.g. reading `Influencer.medianViewsLast30` with no price
  /// to pair it with). Populating it from a live/current rate quote would
  /// need a rate-quoting concept this codebase doesn't have yet; left as a
  /// follow-up rather than guessed at here.
  Future<void> add({
    required String campaignId,
    required String channelId,
    String? whyFit,
  }) async {
    final history = await _ref
        .read(channelRateHistoryRepositoryProvider)
        .getForChannel(channelId);
    final latest = history.isEmpty ? null : history.first;

    await _ref.read(campaignShortlistRepositoryProvider).add(
          CampaignShortlistEntry(
            id: '',
            campaignId: campaignId,
            channelId: channelId,
            whyFit: (whyFit == null || whyFit.isEmpty) ? null : whyFit,
            priceBasisSnapshot: latest == null
                ? null
                : {
                    'brandPrice': latest.brandPrice,
                    'influencerPayout': latest.influencerPayout,
                    if (latest.medianViewsAtDeal != null)
                      'medianViewsAtDeal': latest.medianViewsAtDeal,
                  },
            addedAt: DateTime.now(),
          ),
        );
    _ref.bumpData(const {DataDomain.campaigns});
  }

  Future<void> remove(String id) async {
    await _ref.read(campaignShortlistRepositoryProvider).remove(id);
    _ref.bumpData(const {DataDomain.campaigns});
  }
}

final campaignShortlistControllerProvider =
    Provider<CampaignShortlistController>((ref) {
  return CampaignShortlistController(ref);
});
