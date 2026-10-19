import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/data/repositories/deliverable_repository.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// A deal's deliverables, read from and written to the local database. Same
/// read/write/queue-the-whole-row shape as `MirrorBrandRepository`.
class MirrorDeliverableRepository implements DeliverableRepository {
  const MirrorDeliverableRepository(this._db);

  final LocalSyncDb _db;

  @override
  Future<List<Deliverable>> getForDeal(String dealId) async {
    final rows = await _db.getAll(
      'SELECT * FROM deliverables WHERE deal_id = ? ORDER BY sort_order, id',
      [dealId],
    );
    return [for (final row in rows) _toDeliverable(row)];
  }

  @override
  Future<Deliverable> create(Deliverable deliverable) async {
    final id = deliverable.id.isEmpty ? localUuid() : deliverable.id;
    final now = DateTime.now().toUtc();
    await _db.execute(
      'INSERT INTO deliverables (id, deal_id, type, agreed_date, '
      'draft_received_date, approved_date, published_url, status, notes, '
      'sort_order, published_at, report_views, report_views_at, '
      'report_clicks, created_at, updated_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        deliverable.dealId,
        deliverable.type.name,
        _isoOrNull(deliverable.agreedDate),
        _isoOrNull(deliverable.draftReceivedDate),
        _isoOrNull(deliverable.approvedDate),
        deliverable.publishedUrl,
        deliverable.status.name,
        deliverable.notes,
        deliverable.sortOrder,
        _isoOrNull(deliverable.publishedAt),
        deliverable.reportViews,
        _isoOrNull(deliverable.reportViewsAt),
        deliverable.reportClicks,
        toIso(now),
        toIso(now),
      ],
    );
    await _queue(id);
    return Deliverable(
      id: id,
      dealId: deliverable.dealId,
      type: deliverable.type,
      agreedDate: deliverable.agreedDate,
      draftReceivedDate: deliverable.draftReceivedDate,
      approvedDate: deliverable.approvedDate,
      publishedUrl: deliverable.publishedUrl,
      status: deliverable.status,
      notes: deliverable.notes,
      sortOrder: deliverable.sortOrder,
      publishedAt: deliverable.publishedAt,
      reportViews: deliverable.reportViews,
      reportViewsAt: deliverable.reportViewsAt,
      reportClicks: deliverable.reportClicks,
      createdAt: now,
      updatedAt: now,
    );
  }

  @override
  Future<void> update(Deliverable deliverable) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.execute(
      'UPDATE deliverables SET type = ?, agreed_date = ?, '
      'draft_received_date = ?, approved_date = ?, published_url = ?, '
      'status = ?, notes = ?, sort_order = ?, published_at = ?, '
      'report_views = ?, report_views_at = ?, report_clicks = ?, '
      'updated_at = ? WHERE id = ?',
      [
        deliverable.type.name,
        _isoOrNull(deliverable.agreedDate),
        _isoOrNull(deliverable.draftReceivedDate),
        _isoOrNull(deliverable.approvedDate),
        deliverable.publishedUrl,
        deliverable.status.name,
        deliverable.notes,
        deliverable.sortOrder,
        _isoOrNull(deliverable.publishedAt),
        deliverable.reportViews,
        _isoOrNull(deliverable.reportViewsAt),
        deliverable.reportClicks,
        now,
        deliverable.id,
      ],
    );
    await _queue(deliverable.id);
  }

  @override
  Future<void> delete(String id) async {
    await _db.execute('DELETE FROM deliverables WHERE id = ?', [id]);
    await enqueueRowDelete(_db, table: 'deliverables', id: id);
  }

  static String? _isoOrNull(DateTime? value) =>
      value == null ? null : toIso(value);

  Future<void> _queue(String id) async {
    final rows =
        await _db.getAll('SELECT * FROM deliverables WHERE id = ?', [id]);
    if (rows.isEmpty) return;
    await enqueueRowUpsert(_db, table: 'deliverables', id: id, row: rows.first);
  }

  static Deliverable _toDeliverable(Map<String, Object?> row) {
    final now = DateTime.now();
    return Deliverable(
      id: row['id'] as String,
      dealId: parseString(row['deal_id']) ?? '',
      type: DeliverableType.values.firstWhere(
        (t) => t.name == row['type'],
        orElse: () => DeliverableType.other,
      ),
      agreedDate: parseDate(row['agreed_date']),
      draftReceivedDate: parseDate(row['draft_received_date']),
      approvedDate: parseDate(row['approved_date']),
      publishedUrl: parseString(row['published_url']),
      status: DeliverableStatus.values.firstWhere(
        (s) => s.name == row['status'],
        orElse: () => DeliverableStatus.pending,
      ),
      notes: parseString(row['notes']),
      sortOrder: parseInt(row['sort_order']) ?? 0,
      publishedAt: parseDate(row['published_at']),
      reportViews: parseInt(row['report_views']),
      reportViewsAt: parseDate(row['report_views_at']),
      reportClicks: parseInt(row['report_clicks']),
      createdAt: parseDate(row['created_at']) ?? now,
      updatedAt: parseDate(row['updated_at']) ?? now,
    );
  }
}
