import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/channel_rate_history_entry.dart';
import 'package:gratovo_toolbox/data/repositories/channel_rate_history_repository.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// A channel's closed-deal rate history, read from and written to the local
/// database. Append-only, matching `ChannelRateHistoryEntry`'s own doc
/// comment: [record] is the only write.
class MirrorChannelRateHistoryRepository
    implements ChannelRateHistoryRepository {
  const MirrorChannelRateHistoryRepository(this._db);

  final LocalSyncDb _db;

  @override
  Future<List<ChannelRateHistoryEntry>> getForChannel(String channelId) async {
    final rows = await _db.getAll(
      'SELECT * FROM channel_rate_history WHERE channel_id = ? '
      'ORDER BY closed_at DESC',
      [channelId],
    );
    return [for (final row in rows) _toEntry(row)];
  }

  @override
  Future<ChannelRateHistoryEntry> record(ChannelRateHistoryEntry entry) async {
    final id = entry.id.isEmpty ? localUuid() : entry.id;
    final closedAt = toIso(entry.closedAt);
    await _db.execute(
      'INSERT INTO channel_rate_history (id, channel_id, deal_id, '
      'brand_price, influencer_payout, median_views_at_deal, closed_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        entry.channelId,
        entry.dealId,
        entry.brandPrice,
        entry.influencerPayout,
        entry.medianViewsAtDeal,
        closedAt,
      ],
    );
    await enqueueRowUpsert(
      _db,
      table: 'channel_rate_history',
      id: id,
      row: {
        'id': id,
        'channel_id': entry.channelId,
        'deal_id': entry.dealId,
        'brand_price': entry.brandPrice,
        'influencer_payout': entry.influencerPayout,
        'median_views_at_deal': entry.medianViewsAtDeal,
        'closed_at': closedAt,
      },
    );
    return ChannelRateHistoryEntry(
      id: id,
      channelId: entry.channelId,
      dealId: entry.dealId,
      brandPrice: entry.brandPrice,
      influencerPayout: entry.influencerPayout,
      medianViewsAtDeal: entry.medianViewsAtDeal,
      closedAt: entry.closedAt,
    );
  }

  static ChannelRateHistoryEntry _toEntry(Map<String, Object?> row) {
    return ChannelRateHistoryEntry(
      id: row['id'] as String,
      channelId: parseString(row['channel_id']) ?? '',
      dealId: parseString(row['deal_id']),
      brandPrice: parseDouble(row['brand_price']) ?? 0,
      influencerPayout: parseDouble(row['influencer_payout']) ?? 0,
      medianViewsAtDeal: parseInt(row['median_views_at_deal']),
      closedAt: parseDate(row['closed_at']) ?? DateTime.now(),
    );
  }
}
