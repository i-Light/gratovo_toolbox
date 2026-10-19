import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/campaign_shortlist_entry.dart';
import 'package:gratovo_toolbox/data/repositories/campaign_shortlist_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_mapping.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// A campaign's shortlist, read from and written to the local database. Same
/// read/write/queue-the-whole-row shape as `MirrorBrandRepository`.
class MirrorCampaignShortlistRepository implements CampaignShortlistRepository {
  const MirrorCampaignShortlistRepository(this._db);

  final LocalSyncDb _db;

  @override
  Future<List<CampaignShortlistEntry>> getForCampaign(String campaignId) async {
    final rows = await _db.getAll(
      'SELECT * FROM campaign_shortlist WHERE campaign_id = ? '
      'ORDER BY added_at',
      [campaignId],
    );
    return [for (final row in rows) _toEntry(row)];
  }

  @override
  Future<CampaignShortlistEntry> add(CampaignShortlistEntry entry) async {
    final id = entry.id.isEmpty ? localUuid() : entry.id;
    final addedAt = toIso(entry.addedAt);
    await _db.execute(
      'INSERT INTO campaign_shortlist (id, campaign_id, channel_id, '
      'why_fit, price_basis_snapshot, added_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        id,
        entry.campaignId,
        entry.channelId,
        entry.whyFit,
        encodeJsonColumn(entry.priceBasisSnapshot),
        addedAt,
      ],
    );
    await _queue(id);
    return CampaignShortlistEntry(
      id: id,
      campaignId: entry.campaignId,
      channelId: entry.channelId,
      whyFit: entry.whyFit,
      priceBasisSnapshot: entry.priceBasisSnapshot,
      addedAt: entry.addedAt,
    );
  }

  @override
  Future<void> update(CampaignShortlistEntry entry) async {
    await _db.execute(
      'UPDATE campaign_shortlist SET why_fit = ?, price_basis_snapshot = ? '
      'WHERE id = ?',
      [
        entry.whyFit,
        encodeJsonColumn(entry.priceBasisSnapshot),
        entry.id,
      ],
    );
    await _queue(entry.id);
  }

  @override
  Future<void> remove(String id) async {
    await _db.execute('DELETE FROM campaign_shortlist WHERE id = ?', [id]);
    await enqueueRowDelete(_db, table: 'campaign_shortlist', id: id);
  }

  Future<void> _queue(String id) async {
    final rows =
        await _db.getAll('SELECT * FROM campaign_shortlist WHERE id = ?', [id]);
    if (rows.isEmpty) return;
    await enqueueRowUpsert(
      _db,
      table: 'campaign_shortlist',
      id: id,
      row: _serverRow(rows.first),
    );
  }

  static Map<String, Object?> _serverRow(Map<String, Object?> row) => {
        ...row,
        'price_basis_snapshot': decodeJsonColumn(row['price_basis_snapshot']),
      };

  static CampaignShortlistEntry _toEntry(Map<String, Object?> row) {
    final snapshot = decodeJsonColumn(row['price_basis_snapshot']);
    return CampaignShortlistEntry(
      id: row['id'] as String,
      campaignId: parseString(row['campaign_id']) ?? '',
      channelId: parseString(row['channel_id']) ?? '',
      whyFit: parseString(row['why_fit']),
      priceBasisSnapshot:
          snapshot is Map ? Map<String, dynamic>.from(snapshot) : null,
      addedAt: parseDate(row['added_at']) ?? DateTime.now(),
    );
  }
}
