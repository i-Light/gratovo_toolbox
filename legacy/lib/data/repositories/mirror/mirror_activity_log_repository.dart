import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/models/activity_log_query.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/data/repositories/activity_log_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_mapping.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// The action history, local-first.
///
/// An entry is written here the moment the action happens, stamped by this
/// machine's clock and with `synced = 0`; the uploader sends those in
/// batches and flips them. Nothing is lost offline, and nothing waits on the
/// network to be readable — the page reads this table, which also holds
/// every teammate's entries the puller has brought down.
///
/// Append-only. There is no update or delete, here or on the server.
class MirrorActivityLogRepository implements ActivityLogRepository {
  const MirrorActivityLogRepository(this._db);

  final LocalSyncDb _db;

  @override
  Future<ActivityLogPage> getPage({
    required int offset,
    required int limit,
    ActivityLogQuery query = const ActivityLogQuery(),
  }) async {
    final where = <String>['1 = 1'];
    final params = <Object?>[];

    final search = query.search?.trim();
    if (search != null && search.isNotEmpty) {
      final safe = search.replaceAll(RegExp(r'[%_\\]'), ' ').trim();
      if (safe.isNotEmpty) {
        final like = '%${safe.toLowerCase()}%';
        where.add('(LOWER(actor_name) LIKE ? OR LOWER(entity_label) LIKE ? '
            'OR LOWER(field) LIKE ?)');
        params
          ..add(like)
          ..add(like)
          ..add(like);
      }
    }
    if (query.actorId case final id?) {
      where.add('actor_id = ?');
      params.add(id);
    }
    if (query.actorName case final name?) {
      where.add('actor_name = ?');
      params.add(name);
    }
    if (query.action case final action?) {
      where.add('action = ?');
      params.add(action.wire);
    }
    if (query.entityType case final type?) {
      where.add('entity_type = ?');
      params.add(type);
    }
    if (query.entityId case final id?) {
      where.add('entity_id = ?');
      params.add(id);
    }
    if (query.from case final from?) {
      where.add('at >= ?');
      params.add(toIso(from));
    }
    if (query.to case final to?) {
      where.add('at < ?');
      params.add(toIso(to));
    }

    final rows = await _db.getAll(
      'SELECT * FROM activity_log WHERE ${where.join(' AND ')} '
      'ORDER BY at DESC, id DESC LIMIT ? OFFSET ?',
      [...params, limit, offset],
    );
    return ActivityLogPage(
      items: [for (final row in rows) _toEntry(row)],
      hasMore: rows.length == limit,
    );
  }

  @override
  Future<List<ActivityActor>> getActors() async {
    final rows = await _db.getAll(
      'SELECT DISTINCT actor_id, actor_name FROM activity_log',
    );
    final byKey = <String, ActivityActor>{};
    for (final row in rows) {
      final id = parseString(row['actor_id']);
      final name = parseString(row['actor_name']) ?? 'Unknown';
      byKey.putIfAbsent(
        id ?? 'name:$name',
        () => ActivityActor(id: id, name: name, isDeleted: id == null),
      );
    }
    final actors = byKey.values.toList()
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    return actors;
  }

  @override
  Future<void> record({
    required ActivityDraft draft,
    required String? actorId,
    required String actorName,
    required AccessLevel actorRole,
  }) async {
    await _db.execute(
      'INSERT INTO activity_log (id, at, actor_id, actor_name, actor_role, '
      'action, entity_type, entity_id, entity_label, field, old_value, '
      'new_value, detail, synced) '
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
      [
        localUuid(),
        DateTime.now().toUtc().toIso8601String(),
        actorId,
        actorName,
        actorRole.wireValue,
        draft.action.wire,
        draft.entityType,
        draft.entityId,
        draft.entityLabel,
        draft.field,
        draft.oldValue,
        draft.newValue,
        encodeJsonColumn(draft.detail),
      ],
    );
  }

  static ActivityLogEntry _toEntry(Map<String, Object?> row) {
    return ActivityLogEntry(
      id: row['id'].toString(),
      at: parseDate(row['at']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      actorId: parseString(row['actor_id']),
      actorName: parseString(row['actor_name']) ?? 'Unknown',
      actorRole: AccessLevel.fromWire(parseString(row['actor_role'])),
      action: ActivityAction.fromWire(parseString(row['action'])),
      entityType: parseString(row['entity_type']) ?? 'unknown',
      entityId: parseString(row['entity_id']),
      entityLabel: parseString(row['entity_label']),
      field: parseString(row['field']),
      oldValue: parseString(row['old_value']),
      newValue: parseString(row['new_value']),
      detail: parseJsonMap(row['detail']),
    );
  }
}
