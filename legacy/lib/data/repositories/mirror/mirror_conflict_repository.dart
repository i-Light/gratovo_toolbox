import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/edit_conflict.dart';
import 'package:gratovo_toolbox/data/repositories/conflict_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_influencer_repository.dart'
    show SyncActor;
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_mapping.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// Conflicts read from, and settled in, the local database.
///
/// Reading is local because a conflict has to be visible the moment it
/// exists, on every machine, including the one that made the edit and the
/// one that will settle it. It is also what the profile banner and the shell
/// strip poll, so putting it on the network would put a request on every
/// page load for a row that usually is not there.
///
/// Resolving is local-first too, but with one deliberate limit: the local
/// write is a plain force-write of the chosen value, and the queued entry
/// asks the server's `resolve_edit_conflict` to do the same — the one place
/// `apply_channel_edit` is called with `p_force`. The server's answer is what
/// counts; if the conflict was already settled by somebody else, their
/// resolution comes down on the next pull and overwrites this one. Two people
/// settling the same conflict is rare enough that "last to land wins" is
/// fine, and the alternative — refusing to settle a conflict while offline —
/// is a conflict screen that does not work on a train.
class MirrorConflictRepository implements ConflictRepository {
  const MirrorConflictRepository(this._db, this.actor);

  final LocalSyncDb _db;

  /// Who is settling — recorded on the row so the history reads as a name.
  final SyncActor actor;

  @override
  Future<List<EditConflict>> getOpen() async {
    final rows = await _db.getAll(
      'SELECT * FROM edit_conflicts WHERE resolved_at IS NULL '
      'ORDER BY detected_at DESC',
    );
    return [for (final row in rows) _toConflict(row)];
  }

  @override
  Future<List<EditConflict>> getOpenForChannel(String channelId) async {
    final rows = await _db.getAll(
      'SELECT * FROM edit_conflicts WHERE channel_id = ? '
      'AND resolved_at IS NULL ORDER BY detected_at DESC',
      [channelId],
    );
    return [for (final row in rows) _toConflict(row)];
  }

  @override
  Future<List<EditConflict>> getResolved({int limit = 50}) async {
    final rows = await _db.getAll(
      'SELECT * FROM edit_conflicts WHERE resolved_at IS NOT NULL '
      'ORDER BY resolved_at DESC LIMIT ?',
      [limit],
    );
    return [for (final row in rows) _toConflict(row)];
  }

  @override
  Future<void> resolve(
    String conflictId,
    ConflictResolution resolution,
    Object? value,
  ) async {
    final rows = await _db.getAll(
      'SELECT channel_id, channel_label, field, resolved_at '
      'FROM edit_conflicts WHERE id = ?',
      [conflictId],
    );
    if (rows.isEmpty || rows.first['resolved_at'] != null) return;
    final row = rows.first;
    final channelId = '${row['channel_id']}';
    final field = '${row['field']}';
    final now = DateTime.now().toUtc().toIso8601String();

    // The force-write: no base, no compare. What the person chose is what
    // the column now says, on this machine at once and on the server when
    // the queue drains.
    await _db.execute(
      'INSERT INTO channel_state (channel_id, handle, $field, last_edited_by, '
      'last_edited_by_name, updated_at) VALUES (?, ?, ?, ?, ?, ?) '
      'ON CONFLICT(channel_id) DO UPDATE SET $field = excluded.$field, '
      'last_edited_by = excluded.last_edited_by, '
      'last_edited_by_name = excluded.last_edited_by_name, '
      'updated_at = excluded.updated_at',
      [
        channelId,
        row['channel_label'],
        kLocalJsonColumns.contains(field) ? encodeJsonColumn(value) : value,
        actor.id,
        actor.name,
        now,
      ],
    );
    await _db.execute(
      'UPDATE edit_conflicts SET resolved_at = ?, resolved_by = ?, '
      'resolved_by_name = ?, resolution = ? WHERE id = ?',
      [now, actor.id, actor.name, resolution.wire, conflictId],
    );
    await enqueueOutbox(
      _db,
      kind: OutboxKind.conflictResolve,
      payload: {
        'id': conflictId,
        'resolution': resolution.wire,
        'value': value,
      },
    );
  }

  static EditConflict _toConflict(Map<String, Object?> row) {
    return EditConflict(
      id: parseString(row['id']) ?? '',
      channelId: parseString(row['channel_id']) ?? '',
      channelLabel: parseString(row['channel_label']) ?? '',
      field: parseString(row['field']) ?? '',
      // Decoded back into the String, List or Map the column really holds,
      // rather than left as the JSON text SQLite stores. The resolution screen
      // hands one of these straight back to `resolve` as the value, and a
      // value still wrapped in quotes on the way out would be written as a
      // string where an array belonged.
      baseValue: decodeJsonColumn(row['base_value']),
      mineValue: decodeJsonColumn(row['mine_value']),
      theirsValue: decodeJsonColumn(row['theirs_value']),
      mineActorName: parseString(row['mine_actor_name']) ?? '',
      theirsActorName: parseString(row['theirs_actor_name']),
      detectedAt: parseDate(row['detected_at']) ?? DateTime.now().toUtc(),
      resolvedAt: parseDate(row['resolved_at']),
      resolvedByName: parseString(row['resolved_by_name']),
      resolution: ConflictResolution.fromWire(parseString(row['resolution'])),
    );
  }
}
