import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/scratchpad_note.dart';
import 'package:gratovo_toolbox/data/repositories/scratchpad_repository.dart';

/// The team scratchpad, local-first.
///
/// The one table still in the Realtime publication: a teammate's note is
/// pulled the moment it changes, and this machine's own note goes up through
/// the queue like everything else. Saving needs a user id — with nobody
/// signed in there is no "mine" to save, so the call is a no-op rather than
/// a row under a made-up key.
class MirrorScratchpadRepository implements ScratchpadRepository {
  const MirrorScratchpadRepository(this._db, {required this.userId});

  final LocalSyncDb _db;
  final String? userId;

  @override
  Future<List<ScratchpadNote>> fetchAll() async {
    final rows =
        await _db.getAll('SELECT * FROM scratchpads ORDER BY updated_at DESC');
    return [for (final row in rows) ScratchpadNote.fromRow(row)];
  }

  @override
  Future<void> saveMine(String body) async {
    final uid = userId;
    if (uid == null) return;
    await _db.execute(
      'INSERT INTO scratchpads (user_id, body, updated_at) VALUES (?, ?, ?) '
      'ON CONFLICT(user_id) DO UPDATE SET body = excluded.body, '
      'updated_at = excluded.updated_at',
      [uid, body, DateTime.now().toUtc().toIso8601String()],
    );
    await enqueueRowUpsert(
      _db,
      table: 'scratchpads',
      id: uid,
      row: {'user_id': uid, 'body': body},
    );
  }
}
