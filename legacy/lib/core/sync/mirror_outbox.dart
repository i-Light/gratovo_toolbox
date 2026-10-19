/// The queue of local writes that have not reached Supabase (or, for the two
/// archive kinds, the R2 bucket) yet.
///
/// This file is the writing half — what a repository calls the moment it has
/// changed something locally. `mirror_uploader.dart` is the sending half. They
/// are separate files because a repository must be able to queue a write
/// without importing anything that talks to a network, and because the queue is
/// the one thing in the sync whose contents outlive a re-sync.
///
/// **The queue holds intent, not row operations.** An entry says "this person
/// edited this field, from this value, to that one" — not "an UPDATE touched
/// these columns of this table". The repository already knows what it is
/// doing; writing that down is shorter and cannot be misread.
library;

import 'dart:convert';

import 'package:gratovo_toolbox/core/sync/sync_engine_types.dart';

/// What an outbox entry means. The uploader switches on exactly these.
class OutboxKind {
  const OutboxKind._();

  /// One compare-and-set against one editable `channel_state` column.
  /// Payload: `channel_id`, `field`, `base`, `next`, and `label` (the handle,
  /// so the server can create the state row on a channel's first edit).
  static const channelEdit = 'channel.edit';

  /// A conflict this machine detected before the server saw the write. Payload:
  /// the conflict row.
  static const conflictFile = 'conflict.file';

  /// A conflict settled on this machine, for the server's
  /// `resolve_edit_conflict` (the one force-write in the system). Payload:
  /// `id`, `resolution`, `value`.
  static const conflictResolve = 'conflict.resolve';

  /// A whole row of one of the typed-in tables, to upsert as-is. Payload:
  /// `table`, `id`, `row` (column → value, in the server's shape). Last write
  /// wins by `updated_at`; these tables have no compare-and-set because
  /// nothing in them is edited by two people at once in practice, and a deal's
  /// notes are not worth a conflict screen.
  static const rowUpsert = 'row.upsert';

  /// A row of one of the typed-in tables, to delete. Payload: `table`, `id`.
  static const rowDelete = 'row.delete';

  /// Many rows of one table at once — the bulk clean tagging a few thousand
  /// `channel_state` rows is one entry and a handful of requests, not a
  /// thousand entries. Payload: `table`, `rows` (a list of whole rows, each
  /// carrying its key column).
  static const rowUpsertMany = 'row.upsert_many';

  /// Many rows of one table to delete. Payload: `table`, `ids`.
  static const rowDeleteMany = 'row.delete_many';

  /// Channels to archive, through the pipeline: tombstoned locally already,
  /// their objects deleted from R2 and the archive announced in the catalog
  /// when this is sent. Payload: `entries` — a list of `{channel_id, label}`.
  static const archiveChannels = 'archive.channels';

  /// Channels to bring back from the archive, through the pipeline. Payload:
  /// `channel_ids`.
  static const archiveRestore = 'archive.restore';

  /// The tables [rowUpsert] and [rowDelete] may name. A whitelist, not a
  /// passthrough: a payload is composed by a repository and could in principle
  /// name any table, and the uploader must never become a way to write one the
  /// app does not own.
  static const Set<String> rowTables = {
    'channel_state',
    'brands',
    'deals',
    'outreach_threads',
    'outreach_messages',
    'email_templates',
    'writing_rules',
    'follow_up_reminders',
    'scratchpads',
    'remote_search_requests',
    'campaigns',
    'campaign_shortlist',
    'deliverables',
    'channel_rate_history',
    'sequences',
    'sequence_steps',
    'agency_settings',
    'comms_proposals',
  };

  /// The primary-key column of each syncable table — what an upsert conflicts
  /// on and a delete matches.
  static String keyColumn(String table) => switch (table) {
        'channel_state' => 'channel_id',
        'scratchpads' => 'user_id',
        _ => 'id',
      };
}

/// Adds one entry to the queue.
///
/// Takes a [LocalSyncDb] rather than living on it. The interface stays the two
/// methods it has always been — which is what keeps the repositories testable
/// against a plain in-memory database.
///
/// The payload is stored as JSON, so a value goes in and comes out as the same
/// Dart shape: the `channel_tags` a repository queues is a real list, not the
/// JSON *string* SQLite stores in the local table, and PostgREST receives the
/// array it expects.
Future<void> enqueueOutbox(
  LocalSyncDb db, {
  required String kind,
  required Map<String, Object?> payload,
}) {
  return db.execute(
    'INSERT INTO _outbox (kind, payload, created_at) VALUES (?, ?, ?)',
    [kind, jsonEncode(payload), DateTime.now().toUtc().toIso8601String()],
  );
}

/// Queues a whole-row upsert of [table] — the one-liner every typed-in-table
/// repository calls after its local write.
Future<void> enqueueRowUpsert(
  LocalSyncDb db, {
  required String table,
  required String id,
  required Map<String, Object?> row,
}) {
  assert(OutboxKind.rowTables.contains(table), 'not a syncable table: $table');
  return enqueueOutbox(
    db,
    kind: OutboxKind.rowUpsert,
    payload: {'table': table, 'id': id, 'row': row},
  );
}

Future<void> enqueueRowDelete(
  LocalSyncDb db, {
  required String table,
  required String id,
}) {
  assert(OutboxKind.rowTables.contains(table), 'not a syncable table: $table');
  return enqueueOutbox(
    db,
    kind: OutboxKind.rowDelete,
    payload: {'table': table, 'id': id},
  );
}

/// Queues many whole rows of [table] as one entry. Each row must carry its
/// key column.
Future<void> enqueueRowUpsertMany(
  LocalSyncDb db, {
  required String table,
  required List<Map<String, Object?>> rows,
}) {
  assert(OutboxKind.rowTables.contains(table), 'not a syncable table: $table');
  if (rows.isEmpty) return Future.value();
  return enqueueOutbox(
    db,
    kind: OutboxKind.rowUpsertMany,
    payload: {'table': table, 'rows': rows},
  );
}

Future<void> enqueueRowDeleteMany(
  LocalSyncDb db, {
  required String table,
  required List<String> ids,
}) {
  assert(OutboxKind.rowTables.contains(table), 'not a syncable table: $table');
  if (ids.isEmpty) return Future.value();
  return enqueueOutbox(
    db,
    kind: OutboxKind.rowDeleteMany,
    payload: {'table': table, 'ids': ids},
  );
}

/// One queued write, as read back for sending.
class OutboxEntry {
  const OutboxEntry({
    required this.seq,
    required this.kind,
    required this.payload,
  });

  /// Monotonic, and the order entries must be sent in. A thread created offline
  /// and then a message recorded on it has to arrive in that sequence or the
  /// message lands on nothing.
  final int seq;

  final String kind;
  final Map<String, Object?> payload;

  /// Null for a row whose payload will not parse — which can only happen to a
  /// database somebody has edited by hand, and which the uploader discards
  /// rather than jamming the queue on forever.
  static OutboxEntry? fromRow(Map<String, Object?> row) {
    final seq = row['seq'];
    final kind = row['kind'];
    final raw = row['payload'];
    if (seq is! int || kind is! String || raw is! String) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return null;
      return OutboxEntry(
        seq: seq,
        kind: kind,
        payload: Map<String, Object?>.from(decoded),
      );
    } on FormatException {
      return null;
    }
  }
}
