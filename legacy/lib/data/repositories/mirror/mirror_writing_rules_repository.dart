import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';
import 'package:gratovo_toolbox/data/repositories/writing_rules_repository.dart';

/// The team's outreach writing rules, local-first.
///
/// The list is replaced whole, so each rule's id is its SLOT rather than a
/// fresh uuid: rule 0 is always the same row everywhere, and two machines
/// that both saved the list converge on one list rather than the union of
/// two. The ids are well-formed uuids because the server column is `uuid`.
class MirrorWritingRulesRepository implements WritingRulesRepository {
  const MirrorWritingRulesRepository(this._db);

  final LocalSyncDb _db;

  static String _slotId(int index) =>
      '5e1f0000-0000-4000-8000-${index.toRadixString(16).padLeft(12, '0')}';

  @override
  Future<List<String>> getAll() async {
    final rows = await _db
        .getAll('SELECT text FROM writing_rules ORDER BY sort_order, id');
    return [
      for (final row in rows) parseString(row['text']) ?? '',
    ]..removeWhere((rule) => rule.isEmpty);
  }

  @override
  Future<void> replace(List<String> rules) async {
    final now = DateTime.now().toUtc().toIso8601String();
    final existing = await _db.getAll('SELECT id FROM writing_rules');
    final keep = <String>{for (final (i, _) in rules.indexed) _slotId(i)};
    final gone = [
      for (final row in existing)
        if (!keep.contains(row['id'])) '${row['id']}',
    ];

    for (final id in gone) {
      await _db.execute('DELETE FROM writing_rules WHERE id = ?', [id]);
    }
    final queued = <Map<String, Object?>>[];
    for (final (index, text) in rules.indexed) {
      final id = _slotId(index);
      await _db.execute(
        'INSERT INTO writing_rules (id, text, sort_order, created_at, '
        'updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET '
        'text = excluded.text, sort_order = excluded.sort_order, '
        'updated_at = excluded.updated_at',
        [id, text, index, now, now],
      );
      queued.add({'id': id, 'text': text, 'sort_order': index});
    }
    await enqueueRowDeleteMany(_db, table: 'writing_rules', ids: gone);
    await enqueueRowUpsertMany(_db, table: 'writing_rules', rows: queued);
  }
}
