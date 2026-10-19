import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/campaign.dart';
import 'package:gratovo_toolbox/data/repositories/campaign_repository.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// Campaigns, read from and written to the local database. Same shape as
/// `MirrorBrandRepository`: read the local table, write the local table,
/// queue the whole row for the team. Last write wins by the server's
/// `updated_at`; nothing here is edited by two people at once in practice.
class MirrorCampaignRepository implements CampaignRepository {
  const MirrorCampaignRepository(this._db);

  final LocalSyncDb _db;

  @override
  Future<List<Campaign>> getAll() async {
    final rows =
        await _db.getAll('SELECT * FROM campaigns ORDER BY updated_at DESC');
    return [for (final row in rows) _toCampaign(row)];
  }

  @override
  Future<Campaign?> getById(String id) async {
    final rows = await _db.getAll('SELECT * FROM campaigns WHERE id = ?', [id]);
    return rows.isEmpty ? null : _toCampaign(rows.first);
  }

  @override
  Future<List<Campaign>> getByBrand(String brandId) async {
    final rows = await _db.getAll(
      'SELECT * FROM campaigns WHERE brand_id = ? ORDER BY created_at DESC',
      [brandId],
    );
    return [for (final row in rows) _toCampaign(row)];
  }

  @override
  Future<Campaign> create(Campaign campaign) async {
    final id = campaign.id.isEmpty ? localUuid() : campaign.id;
    final now = DateTime.now().toUtc();
    await _db.execute(
      'INSERT INTO campaigns (id, brand_id, name, notes, status, '
      'start_date, live_date, created_at, updated_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        campaign.brandId,
        campaign.name,
        campaign.notes,
        campaign.status.name,
        campaign.startDate == null ? null : toIso(campaign.startDate!),
        campaign.liveDate == null ? null : toIso(campaign.liveDate!),
        toIso(now),
        toIso(now),
      ],
    );
    await _queue(id);
    return Campaign(
      id: id,
      brandId: campaign.brandId,
      name: campaign.name,
      notes: campaign.notes,
      status: campaign.status,
      startDate: campaign.startDate,
      liveDate: campaign.liveDate,
      createdAt: now,
      updatedAt: now,
    );
  }

  @override
  Future<void> update(Campaign campaign) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.execute(
      'UPDATE campaigns SET name = ?, notes = ?, status = ?, start_date = ?, '
      'live_date = ?, updated_at = ? WHERE id = ?',
      [
        campaign.name,
        campaign.notes,
        campaign.status.name,
        campaign.startDate == null ? null : toIso(campaign.startDate!),
        campaign.liveDate == null ? null : toIso(campaign.liveDate!),
        now,
        campaign.id,
      ],
    );
    await _queue(campaign.id);
  }

  @override
  Future<void> delete(String id) async {
    await _db.execute('DELETE FROM campaigns WHERE id = ?', [id]);
    await enqueueRowDelete(_db, table: 'campaigns', id: id);
  }

  Future<void> _queue(String id) async {
    final rows = await _db.getAll('SELECT * FROM campaigns WHERE id = ?', [id]);
    if (rows.isEmpty) return;
    await enqueueRowUpsert(_db, table: 'campaigns', id: id, row: rows.first);
  }

  static Campaign _toCampaign(Map<String, Object?> row) {
    final now = DateTime.now();
    return Campaign(
      id: row['id'] as String,
      brandId: parseString(row['brand_id']) ?? '',
      name: parseString(row['name']) ?? '',
      notes: parseString(row['notes']),
      status: CampaignStatus.values.firstWhere(
        (s) => s.name == row['status'],
        orElse: () => CampaignStatus.active,
      ),
      startDate: parseDate(row['start_date']),
      liveDate: parseDate(row['live_date']),
      createdAt: parseDate(row['created_at']) ?? now,
      updatedAt: parseDate(row['updated_at']) ?? now,
    );
  }
}
