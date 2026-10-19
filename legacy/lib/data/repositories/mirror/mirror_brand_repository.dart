import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/brand.dart';
import 'package:gratovo_toolbox/data/repositories/brand_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_mapping.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// Brands, read from and written to the local database.
///
/// The typed-in team tables all follow this shape: read the local table,
/// write the local table, queue the whole row for the team. Last write wins
/// by the server's `updated_at`; nothing in these tables is edited by two
/// people at once in practice, and a brand's details are not worth a conflict
/// screen.
class MirrorBrandRepository implements BrandRepository {
  const MirrorBrandRepository(this._db);

  final LocalSyncDb _db;

  @override
  Future<List<Brand>> getAll() async {
    final rows = await _db.getAll('SELECT * FROM brands ORDER BY name');
    return [for (final row in rows) _toBrand(row)];
  }

  @override
  Future<Brand?> getById(String id) async {
    final rows = await _db.getAll('SELECT * FROM brands WHERE id = ?', [id]);
    return rows.isEmpty ? null : _toBrand(rows.first);
  }

  @override
  Future<Brand> create(Brand brand) async {
    final id = brand.id.isEmpty ? localUuid() : brand.id;
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.execute(
      'INSERT INTO brands (id, created_at, updated_at) VALUES (?, ?, ?)',
      [id, brand.createdAt.toUtc().toIso8601String(), now],
    );
    await _write(id, brand, now);
    return (await getById(id))!;
  }

  @override
  Future<void> update(Brand brand) =>
      _write(brand.id, brand, DateTime.now().toUtc().toIso8601String());

  /// Every editable column at once, then the whole row to the queue.
  Future<void> _write(String id, Brand brand, String now) async {
    final primary = brand.primaryContact;
    await _db.execute(
      'UPDATE brands SET name = ?, contact_name = ?, contact_email = ?, '
      'contact_phone = ?, website = ?, budget = ?, budget_currency = ?, '
      'campaign_brief = ?, preferred_criteria = ?, notes = ?, category = ?, '
      'country = ?, contacts = ?, source = ?, updated_at = ? WHERE id = ?',
      [
        brand.name.trim(),
        primary?.name ?? brand.contactName,
        primary?.email ?? brand.contactEmail,
        brand.contactPhone,
        brand.website,
        brand.budget,
        brand.budgetCurrency,
        brand.campaignBrief,
        encodeJsonColumn(brand.preferredCriteria),
        brand.notes,
        brand.category,
        brand.country?.trim().toUpperCase(),
        encodeJsonColumn([for (final c in brand.contacts) c.toJson()]),
        brand.source.name,
        now,
        id,
      ],
    );
    await _queue(id);
  }

  @override
  Future<void> updateNotes(String id, String notes) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.execute(
      'UPDATE brands SET notes = ?, updated_at = ? WHERE id = ?',
      [notes, now, id],
    );
    await _queue(id);
  }

  /// The whole row, not the changed columns: an upsert of a partial row would
  /// null the rest on a server that has never seen this brand (a brand
  /// created offline and edited before the queue drained).
  Future<void> _queue(String id) async {
    final rows = await _db.getAll('SELECT * FROM brands WHERE id = ?', [id]);
    if (rows.isEmpty) return;
    await enqueueRowUpsert(
      _db,
      table: 'brands',
      id: id,
      row: _serverRow(rows.first),
    );
  }

  /// The local row as the server takes it: the jsonb columns as JSON values,
  /// not the text SQLite holds them as, and `source` only when set — the
  /// server checks it against a closed list.
  static Map<String, Object?> _serverRow(Map<String, Object?> row) => {
        ...row,
        'preferred_criteria': decodeJsonColumn(row['preferred_criteria']),
        'contacts': decodeJsonColumn(row['contacts']) ?? const <Object?>[],
        'budget_currency': parseString(row['budget_currency']) ?? 'USD',
      };

  static Brand _toBrand(Map<String, Object?> row) {
    final contacts = decodeJsonColumn(row['contacts']);
    return Brand(
      id: row['id'] as String,
      name: parseString(row['name']) ?? '(unnamed)',
      contactName: parseString(row['contact_name']) ?? '',
      contactEmail: parseString(row['contact_email']) ?? '',
      contactPhone: parseString(row['contact_phone']),
      website: parseString(row['website']),
      budget: parseDouble(row['budget']),
      budgetCurrency: parseString(row['budget_currency']) ?? 'USD',
      campaignBrief: parseString(row['campaign_brief']),
      preferredCriteria: decodeStringList(row['preferred_criteria']),
      notes: parseString(row['notes']),
      createdAt: parseDate(row['created_at']) ?? DateTime.now(),
      category: parseString(row['category']),
      country: parseString(row['country']),
      contacts: [
        if (contacts is List)
          for (final item in contacts)
            if (BrandContact.tryParse(item) case final contact?) contact,
      ],
      source: BrandSource.fromWire(parseString(row['source'])),
    );
  }
}
