import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/remote_search_request.dart';
import 'package:gratovo_toolbox/data/repositories/remote_search_repository.dart';

/// Remote keyword handoffs between team members' machines, local-first.
///
/// [send] writes the row locally (optimistic) and queues it for upload; the
/// recipient's own pull is what actually delivers it to their machine —
/// there is no direct machine-to-machine channel. [markApplied]/
/// [markDismissed] re-read the updated local row and queue the whole thing,
/// same as every other typed-in-table repository here, since an upsert's
/// proposed row has to satisfy the table's NOT NULL columns whether or not a
/// conflict resolves it into an update.
class MirrorRemoteSearchRepository implements RemoteSearchRepository {
  const MirrorRemoteSearchRepository(this._db, {required this.myUserId});

  final LocalSyncDb _db;

  /// Whoever is signed in on this machine — null with nobody signed in, in
  /// which case sending and reading are no-ops rather than acting under a
  /// made-up identity.
  final String? myUserId;

  @override
  Future<List<RemoteSearchRequest>> fetchAll() async {
    final uid = myUserId;
    if (uid == null) return const [];
    final rows = await _db.getAll(
      'SELECT * FROM remote_search_requests '
      'WHERE from_user_id = ? OR to_user_id = ? ORDER BY created_at DESC',
      [uid, uid],
    );
    return [for (final row in rows) RemoteSearchRequest.fromRow(row)];
  }

  @override
  Future<List<RemoteSearchRequest>> incomingPending() async {
    final uid = myUserId;
    if (uid == null) return const [];
    final rows = await _db.getAll(
      'SELECT * FROM remote_search_requests '
      "WHERE to_user_id = ? AND status = 'pending' ORDER BY created_at",
      [uid],
    );
    return [for (final row in rows) RemoteSearchRequest.fromRow(row)];
  }

  @override
  Future<void> send(
      {required String toUserId, required String keywords}) async {
    final uid = myUserId;
    if (uid == null) return;
    final id = localUuid();
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.execute(
      'INSERT INTO remote_search_requests '
      '(id, from_user_id, to_user_id, keywords, status, created_at, updated_at) '
      "VALUES (?, ?, ?, ?, 'pending', ?, ?)",
      [id, uid, toUserId, keywords, now, now],
    );
    await _queue(id);
  }

  @override
  Future<void> markApplied(String id) =>
      _setStatus(id, 'applied', stampAppliedAt: true);

  @override
  Future<void> markDismissed(String id) => _setStatus(id, 'dismissed');

  Future<void> _setStatus(
    String id,
    String status, {
    bool stampAppliedAt = false,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.execute(
      'UPDATE remote_search_requests SET status = ?, updated_at = ?'
      '${stampAppliedAt ? ', applied_at = ?' : ''} WHERE id = ?',
      stampAppliedAt ? [status, now, now, id] : [status, now, id],
    );
    await _queue(id);
  }

  Future<void> _queue(String id) async {
    final rows = await _db
        .getAll('SELECT * FROM remote_search_requests WHERE id = ?', [id]);
    if (rows.isEmpty) return;
    await enqueueRowUpsert(
      _db,
      table: 'remote_search_requests',
      id: id,
      row: rows.first,
    );
  }
}
