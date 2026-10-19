import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/repositories/reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// Follow-up reminders, local-first.
class MirrorReminderRepository implements ReminderRepository {
  const MirrorReminderRepository(this._db);

  final LocalSyncDb _db;

  @override
  Future<List<FollowUpReminder>> getUpcoming() async {
    final rows = await _db.getAll(
      'SELECT * FROM follow_up_reminders WHERE is_done = 0 ORDER BY due_at',
    );
    return [for (final row in rows) _toReminder(row)];
  }

  @override
  Future<int> countCreatedSince(DateTime since) async {
    final rows = await _db.getAll(
      'SELECT COUNT(*) AS n FROM follow_up_reminders WHERE created_at >= ?',
      [toIso(since)],
    );
    return parseInt(rows.first['n']) ?? 0;
  }

  @override
  Future<List<FollowUpReminder>> getForInfluencer(String influencerId) async {
    final rows = await _db.getAll(
      'SELECT * FROM follow_up_reminders WHERE channel_id = ? AND is_done = 0 '
      'ORDER BY due_at',
      [influencerId],
    );
    return [for (final row in rows) _toReminder(row)];
  }

  @override
  Future<FollowUpReminder> create(FollowUpReminder reminder) async {
    final id = reminder.id.isEmpty ? localUuid() : reminder.id;
    final now = DateTime.now().toUtc();
    final created = reminder.createdAt ?? now;
    await _db.execute(
      'INSERT INTO follow_up_reminders (id, title, due_at, kind, channel_id, '
      'deal_id, is_done, created_at, updated_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        reminder.title,
        toIso(reminder.dueAt),
        reminder.kind.name,
        reminder.influencerId,
        reminder.dealId,
        reminder.isDone ? 1 : 0,
        toIso(created),
        toIso(now),
      ],
    );
    await _queue(id);
    return FollowUpReminder(
      id: id,
      title: reminder.title,
      dueAt: reminder.dueAt,
      kind: reminder.kind,
      influencerId: reminder.influencerId,
      dealId: reminder.dealId,
      isDone: reminder.isDone,
      createdAt: created,
    );
  }

  @override
  Future<void> update(FollowUpReminder reminder) async {
    await _db.execute(
      'UPDATE follow_up_reminders SET title = ?, due_at = ?, kind = ?, '
      'is_done = ?, updated_at = ? WHERE id = ?',
      [
        reminder.title,
        toIso(reminder.dueAt),
        reminder.kind.name,
        reminder.isDone ? 1 : 0,
        toIso(DateTime.now()),
        reminder.id,
      ],
    );
    await _queue(reminder.id);
  }

  @override
  Future<void> complete(String id) async {
    await _db.execute(
      'UPDATE follow_up_reminders SET is_done = 1, updated_at = ? WHERE id = ?',
      [toIso(DateTime.now()), id],
    );
    await _queue(id);
  }

  @override
  Future<void> completeForInfluencer(String influencerId) async {
    final rows = await _db.getAll(
      'SELECT id FROM follow_up_reminders WHERE channel_id = ? AND is_done = 0',
      [influencerId],
    );
    final now = toIso(DateTime.now());
    for (final row in rows) {
      await _db.execute(
        'UPDATE follow_up_reminders SET is_done = 1, updated_at = ? '
        'WHERE id = ?',
        [now, row['id']],
      );
    }
    final queued = <Map<String, Object?>>[];
    for (final row in rows) {
      final full = await _db.getAll(
          'SELECT * FROM follow_up_reminders WHERE id = ?', [row['id']]);
      if (full.isNotEmpty) queued.add(_serverRow(full.first));
    }
    await enqueueRowUpsertMany(_db, table: 'follow_up_reminders', rows: queued);
  }

  Future<void> _queue(String id) async {
    final rows = await _db
        .getAll('SELECT * FROM follow_up_reminders WHERE id = ?', [id]);
    if (rows.isEmpty) return;
    await enqueueRowUpsert(
      _db,
      table: 'follow_up_reminders',
      id: id,
      row: _serverRow(rows.first),
    );
  }

  /// The server's `is_done` is a boolean; SQLite's is 0/1.
  static Map<String, Object?> _serverRow(Map<String, Object?> row) => {
        ...row,
        'is_done': parseBool(row['is_done']),
      };

  static FollowUpReminder _toReminder(Map<String, Object?> row) =>
      FollowUpReminder(
        id: row['id'] as String,
        title: parseString(row['title']) ?? '',
        dueAt: parseDate(row['due_at']) ?? DateTime.now(),
        kind: ReminderKind.values.firstWhere(
          (k) => k.name == row['kind'],
          orElse: () => ReminderKind.custom,
        ),
        influencerId: parseString(row['channel_id']),
        dealId: parseString(row['deal_id']),
        isDone: parseBool(row['is_done']),
        createdAt: parseDate(row['created_at']),
      );
}
