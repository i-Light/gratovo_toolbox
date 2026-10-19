import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/client_merge_status.dart';
import 'package:gratovo_toolbox/data/repositories/client_merge_status_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_mapping.dart';

/// The merge board, kept on this machine only.
///
/// It used to be a shared table so teammates could see who still had a
/// quarantined database to merge. That is machine-local bookkeeping about
/// files on one disk, and nothing on another machine can act on it — so it
/// lives in `_client_merge_status` here and is not synced. [fetchAll]
/// therefore returns at most this machine's own row.
class MirrorClientMergeStatusRepository implements ClientMergeStatusRepository {
  const MirrorClientMergeStatusRepository(this._db, {required this.userId});

  final LocalSyncDb _db;
  final String? userId;

  @override
  Future<List<ClientMergeStatus>> fetchAll() async {
    final rows = await _db
        .getAll('SELECT * FROM _client_merge_status ORDER BY updated_at DESC');
    return [
      for (final row in rows)
        ClientMergeStatus.fromRow({
          ...row,
          'entries': decodeJsonColumn(row['entries']),
        }),
    ];
  }

  @override
  Future<void> saveMine({
    required int pendingCount,
    required List<MergeStatusEntry> entries,
  }) async {
    final uid = userId ?? 'local';
    await _db.execute(
      'INSERT INTO _client_merge_status (user_id, pending_count, entries, '
      'updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET '
      'pending_count = excluded.pending_count, entries = excluded.entries, '
      'updated_at = excluded.updated_at',
      [
        uid,
        pendingCount,
        encodeJsonColumn([for (final e in entries) e.toJson()]),
        DateTime.now().toUtc().toIso8601String(),
      ],
    );
  }
}
