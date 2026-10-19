import 'package:gratovo_toolbox/data/models/channel_rate_history_entry.dart';
import 'package:gratovo_toolbox/data/repositories/channel_rate_history_repository.dart';

/// In-memory [ChannelRateHistoryRepository], seeded with one closed-deal
/// entry.
class MockChannelRateHistoryRepository implements ChannelRateHistoryRepository {
  final List<ChannelRateHistoryEntry> _entries = [
    ChannelRateHistoryEntry(
      id: 'rate_history_001',
      channelId: 'UC_sample_channel_1',
      dealId: 'deal_001',
      brandPrice: 1200,
      influencerPayout: 900,
      medianViewsAtDeal: 45000,
      closedAt: DateTime.now().subtract(const Duration(days: 30)),
    ),
  ];

  @override
  Future<List<ChannelRateHistoryEntry>> getForChannel(String channelId) async {
    final matches = _entries.where((e) => e.channelId == channelId).toList()
      ..sort((a, b) => b.closedAt.compareTo(a.closedAt));
    return matches;
  }

  @override
  Future<ChannelRateHistoryEntry> record(ChannelRateHistoryEntry entry) async {
    final withId = entry.id.isEmpty
        ? ChannelRateHistoryEntry(
            id: 'rate_history_${_entries.length + 1}',
            channelId: entry.channelId,
            dealId: entry.dealId,
            brandPrice: entry.brandPrice,
            influencerPayout: entry.influencerPayout,
            medianViewsAtDeal: entry.medianViewsAtDeal,
            closedAt: entry.closedAt,
          )
        : entry;
    _entries.add(withId);
    return withId;
  }
}
