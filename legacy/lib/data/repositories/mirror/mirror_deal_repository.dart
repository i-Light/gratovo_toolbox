import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/repositories/deal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// Deals, read from and written to the local database. Same shape as
/// `MirrorBrandRepository`; see its doc for the rules.
class MirrorDealRepository implements DealRepository {
  const MirrorDealRepository(this._db);

  final LocalSyncDb _db;

  @override
  Future<List<Deal>> getAll() async {
    final rows =
        await _db.getAll('SELECT * FROM deals ORDER BY updated_at DESC');
    return [for (final row in rows) _toDeal(row)];
  }

  @override
  Future<Deal?> getById(String id) async {
    final rows = await _db.getAll('SELECT * FROM deals WHERE id = ?', [id]);
    return rows.isEmpty ? null : _toDeal(rows.first);
  }

  @override
  Future<List<Deal>> getByInfluencer(String influencerId) async {
    final rows = await _db.getAll(
      'SELECT * FROM deals WHERE channel_id = ? ORDER BY created_at DESC',
      [influencerId],
    );
    return [for (final row in rows) _toDeal(row)];
  }

  @override
  Future<List<Deal>> getByBrand(String brandId) async {
    final rows = await _db.getAll(
      'SELECT * FROM deals WHERE brand_id = ? ORDER BY created_at DESC',
      [brandId],
    );
    return [for (final row in rows) _toDeal(row)];
  }

  @override
  Future<Deal> create(Deal deal) async {
    final id = deal.id.isEmpty ? localUuid() : deal.id;
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.execute(
      'INSERT INTO deals (id, brand_id, channel_id, stage, brand_price, '
      'influencer_payout, deliverables, deadline, notes, campaign_id, '
      'owner_id, currency, payment_terms, tracking_link, '
      'creator_contract_status, brand_contract_status, created_at, '
      'updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '
      '?, ?)',
      [
        id,
        deal.brandId,
        deal.influencerId,
        deal.stage.name,
        deal.brandPrice,
        deal.influencerPayout,
        deal.deliverables,
        deal.deadline?.toUtc().toIso8601String(),
        deal.notes,
        deal.campaignId,
        deal.ownerId,
        deal.currency,
        deal.paymentTerms,
        deal.trackingLink,
        deal.creatorContract.status.name,
        deal.brandContract.status.name,
        deal.createdAt.toUtc().toIso8601String(),
        now,
      ],
    );
    await _queue(id);
    return (await getById(id))!;
  }

  @override
  Future<void> updateTerms(String id, DealTerms terms) async {
    await _db.execute(
      'UPDATE deals SET brand_price = ?, influencer_payout = ?, currency = ?, '
      'deliverables = ?, deadline = ?, payment_terms = ?, tracking_link = ?, '
      'updated_at = ? WHERE id = ?',
      [
        terms.brandPrice,
        terms.influencerPayout,
        terms.currency,
        terms.deliverables,
        terms.deadline?.toUtc().toIso8601String(),
        terms.paymentTerms,
        terms.trackingLink,
        DateTime.now().toUtc().toIso8601String(),
        id,
      ],
    );
    await _queue(id);
  }

  @override
  Future<void> updateContract(
    String id,
    ContractParty party,
    DealContract contract,
  ) async {
    final side = party.name;
    await _db.execute(
      'UPDATE deals SET ${side}_contract_url = ?, ${side}_contract_status = ?, '
      '${side}_signed_at = ?, updated_at = ? WHERE id = ?',
      [
        contract.url,
        contract.status.name,
        contract.signedAt?.toUtc().toIso8601String(),
        DateTime.now().toUtc().toIso8601String(),
        id,
      ],
    );
    await _queue(id);
  }

  @override
  Future<void> updateStage(String id, DealStage stage) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.execute(
      'UPDATE deals SET stage = ?, updated_at = ? WHERE id = ?',
      [stage.name, now, id],
    );
    await _queue(id);

    // Closing a deal stamps the channel: `days_since_last_deal` on the
    // influencer list is computed from this, locally, on every machine.
    if (stage == DealStage.closed) {
      final rows =
          await _db.getAll('SELECT channel_id FROM deals WHERE id = ?', [id]);
      final channelId = rows.isEmpty ? null : rows.first['channel_id'];
      if (channelId is String && channelId.isNotEmpty) {
        await _db.execute(
          'INSERT INTO channel_state (channel_id, handle, last_deal_at, '
          'updated_at) VALUES (?, (SELECT handle FROM channels WHERE '
          'channel_id = ?), ?, ?) ON CONFLICT(channel_id) DO UPDATE SET '
          'last_deal_at = excluded.last_deal_at, '
          'updated_at = excluded.updated_at',
          [channelId, channelId, now, now],
        );
        final handles = await _db.getAll(
            'SELECT handle FROM channels WHERE channel_id = ?', [channelId]);
        await enqueueRowUpsert(
          _db,
          table: 'channel_state',
          id: channelId,
          row: {
            'channel_id': channelId,
            'handle': handles.isEmpty ? channelId : handles.first['handle'],
            'last_deal_at': now,
          },
        );
      }
    }
  }

  @override
  Future<void> updateNotes(String id, String notes) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.execute(
      'UPDATE deals SET notes = ?, updated_at = ? WHERE id = ?',
      [notes, now, id],
    );
    await _queue(id);
  }

  @override
  Future<void> updateWorkingDaysEstimate(String id, int? workingDays) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.execute(
      'UPDATE deals SET working_days_estimate = ?, updated_at = ? WHERE id = ?',
      [workingDays, now, id],
    );
    await _queue(id);
  }

  @override
  Future<void> updateOwner(String id, String? ownerId) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.execute(
      'UPDATE deals SET owner_id = ?, updated_at = ? WHERE id = ?',
      [ownerId, now, id],
    );
    await _queue(id);
  }

  @override
  Future<void> updateCampaign(String id, String? campaignId) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.execute(
      'UPDATE deals SET campaign_id = ?, updated_at = ? WHERE id = ?',
      [campaignId, now, id],
    );
    await _queue(id);
  }

  @override
  Future<void> updatePayment(
    String id, {
    required String currency,
    DateTime? brandInvoiceSentAt,
    DateTime? brandInvoicePaidAt,
    DateTime? creatorPayoutDueAt,
    DateTime? creatorPayoutPaidAt,
    String? paymentMethod,
    String? paymentReference,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.execute(
      'UPDATE deals SET currency = ?, brand_invoice_sent_at = ?, '
      'brand_invoice_paid_at = ?, creator_payout_due_at = ?, '
      'creator_payout_paid_at = ?, payment_method = ?, '
      'payment_reference = ?, updated_at = ? WHERE id = ?',
      [
        currency,
        brandInvoiceSentAt?.toUtc().toIso8601String(),
        brandInvoicePaidAt?.toUtc().toIso8601String(),
        creatorPayoutDueAt?.toUtc().toIso8601String(),
        creatorPayoutPaidAt?.toUtc().toIso8601String(),
        paymentMethod,
        paymentReference,
        now,
        id,
      ],
    );
    await _queue(id);
  }

  Future<void> _queue(String id) async {
    final rows = await _db.getAll('SELECT * FROM deals WHERE id = ?', [id]);
    if (rows.isEmpty) return;
    final row = rows.first;
    await enqueueRowUpsert(_db, table: 'deals', id: id, row: {
      ...row,
      // NOT NULL on the server (default 'none'); a deal saved before 1.4
      // holds null here, and sending that would be refused for good.
      'creator_contract_status':
          parseString(row['creator_contract_status']) ?? 'none',
      'brand_contract_status':
          parseString(row['brand_contract_status']) ?? 'none',
    });
  }

  static Deal _toDeal(Map<String, Object?> row) {
    final now = DateTime.now();
    return Deal(
      id: row['id'] as String,
      brandId: parseString(row['brand_id']) ?? '',
      influencerId: parseString(row['channel_id']) ?? '',
      stage: DealStage.values.firstWhere(
        (s) => s.name == row['stage'],
        orElse: () => DealStage.proposed,
      ),
      brandPrice: parseDouble(row['brand_price']) ?? 0,
      influencerPayout: parseDouble(row['influencer_payout']) ?? 0,
      deliverables: parseString(row['deliverables']),
      deadline: parseDate(row['deadline']),
      contractUrl: parseString(row['contract_url']),
      notes: parseString(row['notes']),
      workingDaysEstimate: parseInt(row['working_days_estimate']),
      campaignId: parseString(row['campaign_id']),
      ownerId: parseString(row['owner_id']),
      currency: parseString(row['currency']) ?? 'USD',
      brandInvoiceSentAt: parseDate(row['brand_invoice_sent_at']),
      brandInvoicePaidAt: parseDate(row['brand_invoice_paid_at']),
      creatorPayoutDueAt: parseDate(row['creator_payout_due_at']),
      creatorPayoutPaidAt: parseDate(row['creator_payout_paid_at']),
      paymentMethod: parseString(row['payment_method']),
      paymentReference: parseString(row['payment_reference']),
      paymentTerms: parseString(row['payment_terms']),
      trackingLink: parseString(row['tracking_link']),
      creatorContract: DealContract(
        url: parseString(row['creator_contract_url']),
        status: ContractStatus.fromWire(row['creator_contract_status']),
        signedAt: parseDate(row['creator_signed_at']),
      ),
      brandContract: DealContract(
        url: parseString(row['brand_contract_url']),
        status: ContractStatus.fromWire(row['brand_contract_status']),
        signedAt: parseDate(row['brand_signed_at']),
      ),
      createdAt: parseDate(row['created_at']) ?? now,
      updatedAt: parseDate(row['updated_at']) ?? now,
    );
  }
}
