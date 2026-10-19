import 'package:gratovo_toolbox/core/native/comms_protocol.dart';
import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/comms_proposal.dart';
import 'package:gratovo_toolbox/data/repositories/comms_proposal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_mapping.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// The Comms queue, local-first: the local table, then the whole row queued
/// for the team, jsonb columns as JSON values.
class MirrorCommsProposalRepository implements CommsProposalRepository {
  const MirrorCommsProposalRepository(this._db);

  final LocalSyncDb _db;

  @override
  Future<List<CommsProposal>> getOpen() async {
    final rows = await _db.getAll(
      "SELECT * FROM comms_proposals WHERE status IN ('proposed', 'blocked', "
      "'failed') ORDER BY created_at DESC, id DESC",
    );
    return [for (final row in rows) _toProposal(row)];
  }

  @override
  Future<CommsProposal?> getById(String id) async {
    final rows =
        await _db.getAll('SELECT * FROM comms_proposals WHERE id = ?', [id]);
    return rows.isEmpty ? null : _toProposal(rows.first);
  }

  @override
  Future<int> countCreatedSince(DateTime since) async {
    final rows = await _db.getAll(
      'SELECT COUNT(*) AS n FROM comms_proposals WHERE created_at >= ?',
      [since.toUtc().toIso8601String()],
    );
    return (rows.first['n'] as int?) ?? 0;
  }

  @override
  Future<CommsProposal> save(CommsProposal proposal) async {
    final id = proposal.id.isEmpty ? localUuid() : proposal.id;
    await _db.execute(
      'INSERT OR REPLACE INTO comms_proposals (id, thread_id, channel_id, '
      'brand_id, kind, status, engine_status, situation, steer, action, why, '
      'rules, needs_human, subject, body, follow_up_days, variant, model, '
      'error, decided_by, decided_at, created_at, updated_at) VALUES (?, ?, '
      '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        proposal.threadId,
        proposal.channelId,
        proposal.brandId,
        proposal.kind.name,
        proposal.status.name,
        proposal.engineStatus?.wire,
        encodeJsonColumn(proposal.situation),
        encodeJsonColumn(proposal.steer),
        proposal.action,
        proposal.why,
        encodeJsonColumn(proposal.rules),
        encodeJsonColumn(_gates(proposal.needsHuman)),
        proposal.subject,
        proposal.body,
        proposal.followUpDays,
        proposal.variant,
        proposal.model,
        proposal.error,
        proposal.decidedBy,
        proposal.decidedAt?.toUtc().toIso8601String(),
        proposal.createdAt.toUtc().toIso8601String(),
        proposal.updatedAt.toUtc().toIso8601String(),
      ],
    );
    await _queue(id);
    return (await getById(id))!;
  }

  @override
  Future<void> decide(
    String id,
    CommsQueueStatus status, {
    String? decidedBy,
    String? subject,
    String? body,
    String? error,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.execute(
      'UPDATE comms_proposals SET status = ?, decided_by = ?, decided_at = ?, '
      'subject = COALESCE(?, subject), body = COALESCE(?, body), '
      'error = COALESCE(?, error), updated_at = ? WHERE id = ?',
      [status.name, decidedBy, now, subject, body, error, now, id],
    );
    await _queue(id);
  }

  Future<void> _queue(String id) async {
    final rows =
        await _db.getAll('SELECT * FROM comms_proposals WHERE id = ?', [id]);
    if (rows.isEmpty) return;
    final row = rows.first;
    await enqueueRowUpsert(_db, table: 'comms_proposals', id: id, row: {
      ...row,
      'situation': decodeJsonColumn(row['situation']),
      'steer': decodeJsonColumn(row['steer']),
      'rules': decodeJsonColumn(row['rules']) ?? const <Object?>[],
      'needs_human': decodeJsonColumn(row['needs_human']) ?? const <Object?>[],
    });
  }

  static List<Map<String, Object?>> _gates(List<CommsGate> gates) => [
        for (final g in gates) {'what': g.what, 'detail': g.detail},
      ];

  static CommsProposal _toProposal(Map<String, Object?> row) {
    final engine = parseString(row['engine_status']);
    final situation = decodeJsonColumn(row['situation']);
    final steer = decodeJsonColumn(row['steer']);
    final needs = decodeJsonColumn(row['needs_human']);
    final now = DateTime.now();
    return CommsProposal(
      id: row['id']! as String,
      kind: CommsKind.fromWire(row['kind']),
      status: CommsQueueStatus.fromWire(row['status']),
      threadId: parseString(row['thread_id']),
      channelId: parseString(row['channel_id']),
      brandId: parseString(row['brand_id']),
      engineStatus: engine == null ? null : CommsEngineStatus.fromWire(engine),
      situation:
          situation is Map ? situation.cast<String, Object?>() : const {},
      steer: steer is Map ? steer.cast<String, Object?>() : const {},
      action: parseString(row['action']),
      why: parseString(row['why']),
      rules: decodeStringList(row['rules']),
      needsHuman: [
        if (needs is List)
          for (final item in needs) CommsGate.fromJson(item),
      ],
      subject: parseString(row['subject']) ?? '',
      body: row['body'] is String ? row['body']! as String : '',
      followUpDays: parseInt(row['follow_up_days']),
      variant: parseString(row['variant']),
      model: parseString(row['model']),
      error: parseString(row['error']),
      decidedBy: parseString(row['decided_by']),
      decidedAt: parseDate(row['decided_at']),
      createdAt: parseDate(row['created_at']) ?? now,
      updatedAt: parseDate(row['updated_at']) ?? now,
    );
  }
}
