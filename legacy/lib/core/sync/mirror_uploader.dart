import 'dart:convert';

import 'package:gratovo_toolbox/core/sync/mirror_database.dart';
import 'package:gratovo_toolbox/core/sync/mirror_network.dart';
import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/pipeline_bridge.dart';
import 'package:gratovo_toolbox/core/sync/server_schema.dart';
import 'package:gratovo_toolbox/core/sync/sync_diagnostics.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// How many sync passes in a row one queued entry may fail to send before the
/// uploader stops treating it as an ordinary blip and says so — loudly in the
/// log, and in the sentence the Settings card shows.
///
/// The queue still does not skip it (see the class doc): a retryable failure is
/// one that might genuinely succeed, and dropping the edit behind it would be
/// lost work.
const int kOutboxStuckPasses = 4;

/// How many activity-log entries go up in one insert.
const int kActivityLogBatchSize = 200;

/// `_sync_meta` key holding `{seq, kind, fails}` for the entry currently at the
/// head of the queue, while it is failing. Cleared the moment the head moves.
const String _kOutboxHeadStuckKey = 'outbox.head.stuck';

/// Raised by [MirrorUploader.drain] once the entry at the head of the queue has
/// failed to send on [kOutboxStuckPasses] passes running.
class OutboxStuckException implements Exception {
  OutboxStuckException({
    required this.kind,
    required this.passes,
    required this.cause,
  });

  final String kind;
  final int passes;
  final Object cause;

  @override
  String toString() =>
      'A queued change ($kind) has failed to send on $passes sync passes in a '
      'row. It is still being retried; nothing is lost. Latest error: $cause'
      '${isServerSchemaBehind(cause) ? ' $kServerSchemaBehindHint' : ''}';
}

/// Whether the server's answer means "never", as opposed to "not now".
///
/// A server that is merely behind this app — a missing `apply_channel_edit`,
/// column or table, or a field its copy of the edit whitelist predates — MUST
/// retry: the fix is running `backend/schema.sql`, and dropping everybody's
/// queued edits in the meantime would turn a forgotten migration into lost
/// work.
bool isFinalUploadRefusal(PostgrestException error) {
  final code = error.code;
  if (code == null) return false;
  if (isServerSchemaBehind(error)) return false;
  if (code == '42501') return true; // insufficient privilege / RLS refusal
  return code.startsWith('22') || // data exception, incl. our own 22023
      code.startsWith('23'); //     integrity constraint violation
}

/// What one drain sent, so the engine can tell everyone else in one message.
class UploadReport {
  const UploadReport({required this.sent, required this.tables});

  /// Entries that left the queue (plus one for a log batch).
  final int sent;

  /// Which server tables changed as a result — the Broadcast payload.
  final Set<String> tables;
}

/// Sends queued local writes to Supabase — and, for the two archive kinds, to
/// the pipeline — in the order they were made.
///
/// Every Supabase call here is the ordinary one: the same PostgREST endpoints,
/// the same `apply_channel_edit` RPC. An edit made offline is not a special
/// kind of edit; it is an ordinary edit that arrives late.
///
/// The rule that shapes this file: **a queue must never jam.** An entry that
/// fails and is retried forever sits in front of every later edit that person
/// makes, so the only failures allowed to stop the drain are the ones that
/// genuinely might succeed next time — a dropped connection, an expired token,
/// a 500. A write the server has already judged and refused is recorded and
/// dropped, because it will be refused again in five seconds and the cost of
/// holding on to it is everything queued behind it.
///
/// A conflict is not a failure at all. `apply_channel_edit` answering
/// `conflict` means the server did exactly what it was asked to: it refused a
/// stale write and filed a row in `edit_conflicts`, which syncs straight back
/// down and raises the banner.
class MirrorUploader {
  MirrorUploader({
    required MirrorDatabase database,
    required SupabaseClient client,
    PipelineBridge? pipeline,
    SyncDiagnostics? diagnostics,
  })  : _db = database,
        _client = client,
        _pipeline = pipeline,
        _log = diagnostics ?? SyncDiagnostics();

  final MirrorDatabase _db;
  final SupabaseClient _client;
  final PipelineBridge? _pipeline;
  final SyncDiagnostics _log;

  /// The current pass's upload deadline, set for the length of [drain] so
  /// [_guard] can cap a single entry's retry ladder at the time the pass
  /// actually has left. Null outside a pass.
  MirrorDeadline? _passClock;

  /// Sends everything queued, oldest first, then the unsynced activity log.
  ///
  /// Stops at the first retryable failure and leaves the rest for the next
  /// tick, because sending entry 7 after entry 6 failed would apply an edit on
  /// top of a state the server never reached.
  Future<UploadReport> drain({MirrorDeadline? deadline}) async {
    final clock = deadline ?? MirrorDeadline.unbounded();
    _passClock = clock;
    var sent = 0;
    final tables = <String>{};
    final startedAt = DateTime.now();
    final queued = await pending();
    if (queued > 0) {
      _log.log('upload.start', 'Sending queued edits.', fields: {
        'queued': queued,
      });
    }

    try {
      while (true) {
        if (!clock.hasRoomFor(kMirrorMinUploadTime)) {
          _log.log(
            'upload.paused',
            'Stopped sending for now; the rest of the queue goes next pass.',
            level: SyncLogLevel.warn,
            fields: {'sent': sent, 'stillQueued': queued - sent},
          );
          return UploadReport(sent: sent, tables: tables);
        }

        final rows = await _db.getAll(
          'SELECT seq, kind, payload FROM _outbox ORDER BY seq LIMIT 1',
        );
        if (rows.isEmpty) {
          _clearHeadStuck();
          break;
        }

        final entry = OutboxEntry.fromRow(rows.first);
        if (entry == null) {
          final seq = rows.first['seq'];
          _log.log(
            'upload.discard',
            'Discarding outbox entry $seq: its payload is not readable.',
            level: SyncLogLevel.error,
            fields: {'seq': seq},
          );
          _clearHeadStuck();
          await _db.execute('DELETE FROM _outbox WHERE seq = ?', [seq]);
          continue;
        }

        try {
          final table = await _send(entry);
          if (table != null) tables.add(table);
        } catch (error, stack) {
          // A retryable failure — permanent ones are swallowed inside [_guard]
          // and never reach here. The entry stays at the head of the queue.
          final stuck = _noteHeadFailure(entry, error);
          if (stuck != null) throw stuck;
          Error.throwWithStackTrace(error, stack);
        }
        _clearHeadStuck();
        await _db.execute('DELETE FROM _outbox WHERE seq = ?', [entry.seq]);
        sent++;
      }

      // The log goes after the queue, never before: an entry saying "edited
      // notes on X" that arrives ahead of the edit itself would confuse a
      // reader, and the log is the lower-value write if the pass runs out.
      if (clock.hasRoomFor(kMirrorMinUploadTime)) {
        final logged = await _flushActivityLog();
        if (logged > 0) {
          sent++;
          tables.add('activity_log');
        }
      }

      if (sent > 0) {
        _log.log('upload.end', 'Queue drained.', fields: {
          'sent': sent,
          'tables': tables.join(','),
          'elapsedMs': DateTime.now().difference(startedAt).inMilliseconds,
        });
      }
      return UploadReport(sent: sent, tables: tables);
    } finally {
      _passClock = null;
    }
  }

  /// Records that the entry at the head of the queue failed to send this pass,
  /// and returns an [OutboxStuckException] once it has failed
  /// [kOutboxStuckPasses] passes in a row — otherwise null. Lives in
  /// `_sync_meta` so it survives the process.
  OutboxStuckException? _noteHeadFailure(OutboxEntry entry, Object cause) {
    var fails = 1;
    final stored = _db.readMeta(_kOutboxHeadStuckKey);
    if (stored != null) {
      try {
        final decoded = jsonDecode(stored);
        if (decoded is Map && decoded['seq'] == entry.seq) {
          final prior = decoded['fails'];
          if (prior is int) fails = prior + 1;
        }
      } on FormatException {
        // Corrupt row — treat this as the first failure and overwrite it.
      }
    }
    _db.writeMeta(
      _kOutboxHeadStuckKey,
      jsonEncode({'seq': entry.seq, 'kind': entry.kind, 'fails': fails}),
    );

    if (fails < kOutboxStuckPasses) return null;

    _log.log(
      'upload.stuck',
      'Queued change "${entry.kind}" (entry ${entry.seq}) has failed to send '
          'on $fails passes running. Still retrying — nothing is dropped.',
      level: SyncLogLevel.error,
      fields: {'seq': entry.seq, 'kind': entry.kind, 'passes': fails},
      error: cause,
    );
    return OutboxStuckException(kind: entry.kind, passes: fails, cause: cause);
  }

  void _clearHeadStuck() {
    if (_db.readMeta(_kOutboxHeadStuckKey) != null) {
      _db.writeMeta(_kOutboxHeadStuckKey, null);
    }
  }

  /// How many writes are still waiting, for the Settings card. Counts the
  /// queue plus the unsynced log entries.
  Future<int> pending() async {
    final rows = await _db.getAll(
      'SELECT (SELECT COUNT(*) FROM _outbox) + '
      '(SELECT COUNT(*) FROM activity_log WHERE synced = 0) AS n',
    );
    if (rows.isEmpty) return 0;
    final value = rows.first['n'];
    return value is int ? value : 0;
  }

  /// Sends one entry. Returns the server table it changed, or null.
  Future<String?> _send(OutboxEntry entry) async {
    switch (entry.kind) {
      case OutboxKind.channelEdit:
        await _editChannel(entry.payload);
        return 'channel_state';
      case OutboxKind.conflictFile:
        await _fileConflict(entry.payload);
        return 'edit_conflicts';
      case OutboxKind.conflictResolve:
        await _resolveConflict(entry.payload);
        return 'edit_conflicts';
      case OutboxKind.rowUpsert:
        return _upsertRow(entry.payload);
      case OutboxKind.rowDelete:
        return _deleteRow(entry.payload);
      case OutboxKind.rowUpsertMany:
        return _upsertRows(entry.payload);
      case OutboxKind.rowDeleteMany:
        return _deleteRows(entry.payload);
      case OutboxKind.archiveChannels:
        await _archive(entry.payload);
        return null;
      case OutboxKind.archiveRestore:
        await _restore(entry.payload);
        return null;
      default:
        // A kind this version does not know. Dropped rather than retried: it
        // can only come from a database written by a newer build, and holding
        // it would jam everything behind it.
        _log.log(
          'upload.discard',
          'Discarding outbox entry ${entry.seq}: unknown kind '
              '"${entry.kind}".',
          level: SyncLogLevel.error,
          fields: {'seq': entry.seq, 'kind': entry.kind},
        );
        return null;
    }
  }

  Future<void> _editChannel(Map<String, Object?> payload) async {
    final id = payload['channel_id'];
    final field = payload['field'];
    if (id is! String || field is! String) return;

    // The base is what the editor was actually looking at, recorded by the
    // repository at the moment it ran the same compare-and-set locally.
    final outcome = await _guard(
      what: 'edit $field on $id',
      call: () => _client.rpc<Object?>('apply_channel_edit', params: {
        'p_channel_id': id,
        'p_field': field,
        'p_base': payload['base'],
        'p_new': payload['next'],
        'p_label': payload['label'],
      }),
    );

    if (outcome == 'conflict') {
      _log.log(
        'upload.refused',
        'The server answered "$outcome" for $field on $id. The local value '
            'will revert on the next sync down.',
        level: SyncLogLevel.warn,
        fields: {'channelId': id, 'field': field, 'outcome': outcome},
      );
    }
  }

  /// A conflict this machine detected before the server ever saw the write.
  Future<void> _fileConflict(Map<String, Object?> payload) async {
    try {
      await runMirrorRequest(
        what: 'file a conflict',
        event: 'upload.conflict',
        log: _log,
        call: () => _client.from('edit_conflicts').insert({
          'id': payload['id'],
          'channel_id': payload['channel_id'],
          'channel_label': payload['channel_label'],
          'field': payload['field'],
          'base_value': payload['base_value'],
          'mine_value': payload['mine_value'],
          'theirs_value': payload['theirs_value'],
          'mine_actor_id': payload['mine_actor_id'],
          'mine_actor_name': payload['mine_actor_name'],
          'theirs_actor_name': payload['theirs_actor_name'],
          'detected_at': payload['detected_at'],
        }),
      );
    } on PostgrestException catch (error) {
      // 23505 means the server already has an OPEN conflict for this person,
      // field and channel — most likely one `apply_channel_edit` filed itself.
      // Same disagreement; update what this person is proposing.
      if (error.code != '23505') rethrow;
      await _updateOpenConflict(payload);
    }
  }

  Future<void> _updateOpenConflict(Map<String, Object?> payload) async {
    final channelId = payload['channel_id'];
    final field = payload['field'];
    if (channelId == null || field == null) return;

    await _guard(
      what: 'update the open conflict on $field for $channelId',
      call: () => _client
          .from('edit_conflicts')
          .update({
            'mine_value': payload['mine_value'],
            'theirs_value': payload['theirs_value'],
            'theirs_actor_name': payload['theirs_actor_name'],
            'detected_at': payload['detected_at'],
          })
          .eq('channel_id', channelId)
          .eq('field', field)
          .eq('mine_actor_id', payload['mine_actor_id'] as Object)
          .isFilter('resolved_at', null),
    );
  }

  /// A whole row of a typed-in table. `updated_at` is deliberately NOT sent:
  /// the server's touch trigger stamps it, which keeps the pull cursor on the
  /// server's clock — the one thing every machine can agree on.
  /// The server settles the conflict the same way this machine did. Any
  /// answer but an error is final: 'missing' and 'already_resolved' both mean
  /// somebody else's resolution stands and will come down on the next pull.
  Future<void> _resolveConflict(Map<String, Object?> payload) async {
    final id = payload['id'];
    final resolution = payload['resolution'];
    if (id is! String || resolution is! String) return;
    await _guard(
      what: 'resolve conflict $id',
      call: () => _client.rpc<Object?>('resolve_edit_conflict', params: {
        'p_id': id,
        'p_resolution': resolution,
        'p_value': payload['value'],
      }),
    );
  }

  Future<String?> _upsertRow(Map<String, Object?> payload) async {
    final table = payload['table'];
    final id = payload['id'];
    final row = payload['row'];
    if (table is! String || id is! String || row is! Map) return null;
    if (!OutboxKind.rowTables.contains(table)) {
      _log.log(
        'upload.discard',
        'Discarding an upsert for "$table": not a table the app syncs.',
        level: SyncLogLevel.error,
        fields: {'table': table},
      );
      return null;
    }
    final key = OutboxKind.keyColumn(table);
    final body = _serverRow(row)..[key] = id;
    await _guard(
      what: 'save $table/$id',
      call: () => _client.from(table).upsert(body, onConflict: key),
    );
    return table;
  }

  Future<String?> _deleteRow(Map<String, Object?> payload) async {
    final table = payload['table'];
    final id = payload['id'];
    if (table is! String || id is! String) return null;
    if (!OutboxKind.rowTables.contains(table)) return null;
    await _guard(
      what: 'delete $table/$id',
      call: () =>
          _client.from(table).delete().eq(OutboxKind.keyColumn(table), id),
    );
    return table;
  }

  /// How many rows one bulk request carries. The same figure as the activity
  /// log's batches: comfortably inside a request's statement timeout for a
  /// table with two triggers, and few enough requests that a bulk clean of
  /// several thousand channels is seconds, not minutes.
  static const _rowBatch = 200;

  Future<String?> _upsertRows(Map<String, Object?> payload) async {
    final table = payload['table'];
    final rows = payload['rows'];
    if (table is! String || rows is! List) return null;
    if (!OutboxKind.rowTables.contains(table)) return null;
    final key = OutboxKind.keyColumn(table);
    final bodies = [
      for (final row in rows)
        if (row is Map && row[key] != null) _serverRow(row),
    ];
    for (var start = 0; start < bodies.length; start += _rowBatch) {
      final batch =
          bodies.sublist(start, (start + _rowBatch).clamp(0, bodies.length));
      await _guard(
        what: 'save ${batch.length} $table rows',
        call: () => _client.from(table).upsert(batch, onConflict: key),
      );
    }
    return table;
  }

  Future<String?> _deleteRows(Map<String, Object?> payload) async {
    final table = payload['table'];
    final ids = payload['ids'];
    if (table is! String || ids is! List) return null;
    if (!OutboxKind.rowTables.contains(table)) return null;
    final key = OutboxKind.keyColumn(table);
    final all = [for (final id in ids) '$id'];
    for (var start = 0; start < all.length; start += _rowBatch) {
      final batch =
          all.sublist(start, (start + _rowBatch).clamp(0, all.length));
      await _guard(
        what: 'delete ${batch.length} $table rows',
        call: () => _client.from(table).delete().inFilter(key, batch),
      );
    }
    return table;
  }

  /// A queued row in the shape the server takes: `updated_at` is the
  /// server's to stamp (its touch trigger), so a client value is dropped
  /// rather than argued with.
  static Map<String, Object?> _serverRow(Map<dynamic, dynamic> row) => {
        for (final entry in row.entries)
          if (entry.key != 'updated_at') '${entry.key}': entry.value,
      };

  /// The R2 side of an archive: the pipeline deletes the objects and
  /// announces the tombstones. Retryable on any failure — the local tombstone
  /// is already written, so nothing here is user-visible until it lands.
  Future<void> _archive(Map<String, Object?> payload) async {
    final pipeline = _pipeline;
    final entries = payload['entries'];
    if (entries is! List) return;
    if (pipeline == null) {
      throw PipelineBridgeException('No pipeline bridge on this build.');
    }
    await pipeline.archiveChannels([
      for (final entry in entries)
        if (entry is Map) Map<String, Object?>.from(entry),
    ]);
  }

  Future<void> _restore(Map<String, Object?> payload) async {
    final pipeline = _pipeline;
    final ids = payload['channel_ids'];
    if (ids is! List) return;
    if (pipeline == null) {
      throw PipelineBridgeException('No pipeline bridge on this build.');
    }
    await pipeline.restoreChannels([for (final id in ids) '$id']);
  }

  /// Sends unsynced activity-log rows in batches and flips them to synced.
  ///
  /// One insert per batch rather than one per row: the log is the chattiest
  /// table in the app and each entry is a few hundred bytes. The server
  /// refuses an entry filed under somebody else's id — that cannot happen to
  /// a row this machine wrote as the signed-in person, but a whole batch
  /// refused for a permanent reason is dropped from the queue (flagged as
  /// synced) rather than retried forever; the rows stay readable here.
  Future<int> _flushActivityLog() async {
    var flushed = 0;
    while (true) {
      final rows = await _db.getAll(
        'SELECT * FROM activity_log WHERE synced = 0 ORDER BY at, id LIMIT ?',
        [kActivityLogBatchSize],
      );
      if (rows.isEmpty) return flushed;
      final ids = [for (final row in rows) row['id'] as String];
      final body = [
        for (final row in rows)
          {
            'id': row['id'],
            'at': row['at'],
            'actor_id': row['actor_id'],
            'actor_name': row['actor_name'],
            'actor_role': row['actor_role'],
            'action': row['action'],
            'entity_type': row['entity_type'],
            'entity_id': row['entity_id'],
            'entity_label': row['entity_label'],
            'field': row['field'],
            'old_value': row['old_value'],
            'new_value': row['new_value'],
            'detail': _decodeJson(row['detail']),
          },
      ];
      // `ignoreDuplicates`: a batch that partly landed before a dropped
      // connection is re-sent whole, and the rows already there are skipped
      // rather than refused as duplicates.
      await _guard(
        what: 'send ${rows.length} activity log entries',
        call: () => _client.from('activity_log').upsert(
              body,
              onConflict: 'id',
              ignoreDuplicates: true,
            ),
      );
      final placeholders = List.filled(ids.length, '?').join(', ');
      await _db.execute(
        'UPDATE activity_log SET synced = 1 WHERE id IN ($placeholders)',
        ids,
      );
      flushed += rows.length;
      if (rows.length < kActivityLogBatchSize) return flushed;
    }
  }

  static Object? _decodeJson(Object? value) {
    if (value is! String || value.isEmpty) return value;
    try {
      return jsonDecode(value);
    } on FormatException {
      return null;
    }
  }

  Duration? _uploadBudget() {
    final clock = _passClock;
    if (clock == null) return null;
    final ms = clock.remaining.inMilliseconds.clamp(
      kMirrorMinUploadTime.inMilliseconds,
      kMirrorRequestTimeout.inMilliseconds,
    );
    return Duration(milliseconds: ms);
  }

  /// Runs one server call, deciding for each failure whether it is worth
  /// retrying. Rethrows anything transient, so the drain stops and the next
  /// tick tries again. Swallows anything the server has already judged.
  Future<T?> _guard<T>({
    required String what,
    required Future<T> Function() call,
  }) async {
    try {
      return await runMirrorRequest(
        what: what,
        event: 'upload.send',
        log: _log,
        budget: _uploadBudget(),
        call: call,
      );
    } on PostgrestException catch (error) {
      if (isFinalUploadRefusal(error)) {
        _log.log(
          'upload.dropped',
          'Dropping "$what": the server refused it and will refuse it again. '
              'The local value reverts on the next sync down.',
          level: SyncLogLevel.error,
          fields: {'what': what},
          error: error,
        );
        return null;
      }
      rethrow;
    }
  }
}
