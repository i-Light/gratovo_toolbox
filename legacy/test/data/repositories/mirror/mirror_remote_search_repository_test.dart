import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/remote_search_request.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_remote_search_repository.dart';

import 'memory_mirror.dart';

/// [MirrorRemoteSearchRepository] is the write path the Search screen's
/// upload dialog and [RemoteSearchIntakeNotifier] both depend on. The one
/// property worth pinning against a real SQLite engine: every write —
/// `send`, `markApplied`, `markDismissed` — queues the WHOLE row for upload,
/// not just the changed columns, because the sync engine's `upsert()` call
/// requires an insert-or-update's proposed row to satisfy the table's NOT
/// NULL columns regardless of which branch a conflict resolves into (see the
/// comment on `remote_search_requests_rw` in `backend/schema.sql`) — a
/// partial payload would look fine locally and fail to upload silently.
void main() {
  late MemoryMirror mirror;
  late MirrorRemoteSearchRepository repo;

  setUp(() {
    mirror = MemoryMirror();
    repo = MirrorRemoteSearchRepository(mirror, myUserId: 'user-a');
  });

  tearDown(() => mirror.close());

  Future<Map<String, Object?>> lastOutboxRow() async {
    final rows = await mirror.outbox();
    final payload =
        jsonDecode(rows.last['payload'] as String) as Map<String, Object?>;
    return Map<String, Object?>.from(payload['row'] as Map);
  }

  test('send writes a pending row locally and queues the whole thing',
      () async {
    await repo.send(toUserId: 'user-b', keywords: 'budget travel\nai tools');

    final all = await repo.fetchAll();
    expect(all, hasLength(1));
    expect(all.single.fromUserId, 'user-a');
    expect(all.single.toUserId, 'user-b');
    expect(all.single.keywords, 'budget travel\nai tools');
    expect(all.single.status, RemoteSearchRequestStatus.pending);

    final queued = await lastOutboxRow();
    expect(queued['from_user_id'], 'user-a');
    expect(queued['to_user_id'], 'user-b');
    expect(queued['keywords'], 'budget travel\nai tools');
    expect(queued['status'], 'pending');
  });

  test('incomingPending only returns pending requests addressed to me',
      () async {
    final sender = MirrorRemoteSearchRepository(mirror, myUserId: 'user-b');
    await sender.send(toUserId: 'user-a', keywords: 'k1');
    await sender.send(toUserId: 'user-a', keywords: 'k2');
    // Addressed to someone else entirely -- must not show up for user-a.
    await sender.send(toUserId: 'user-c', keywords: 'k3');

    final incoming = await repo.incomingPending();
    expect(incoming.map((r) => r.keywords), containsAll(['k1', 'k2']));
    expect(incoming, hasLength(2));

    await repo.markApplied(incoming.first.id);
    final stillIncoming = await repo.incomingPending();
    expect(stillIncoming, hasLength(1));
  });

  test(
      'markApplied stamps applied_at and queues the full row, not a partial one',
      () async {
    await repo.send(toUserId: 'user-b', keywords: 'k1');
    final id = (await repo.fetchAll()).single.id;

    await repo.markApplied(id);

    final updated = (await repo.fetchAll()).single;
    expect(updated.status, RemoteSearchRequestStatus.applied);
    expect(updated.appliedAt, isNotNull);

    final queued = await lastOutboxRow();
    // Every NOT NULL column the server table requires, still present.
    expect(queued['from_user_id'], 'user-a');
    expect(queued['to_user_id'], 'user-b');
    expect(queued['keywords'], 'k1');
    expect(queued['status'], 'applied');
    expect(queued['applied_at'], isNotNull);
  });

  test('markDismissed does not stamp applied_at', () async {
    await repo.send(toUserId: 'user-b', keywords: 'k1');
    final id = (await repo.fetchAll()).single.id;

    await repo.markDismissed(id);

    final updated = (await repo.fetchAll()).single;
    expect(updated.status, RemoteSearchRequestStatus.dismissed);
    expect(updated.appliedAt, isNull);
  });

  test(
      'with nobody signed in, every call is a no-op rather than acting under a made-up id',
      () async {
    final signedOut = MirrorRemoteSearchRepository(mirror, myUserId: null);
    await signedOut.send(toUserId: 'user-b', keywords: 'k1');

    expect(await signedOut.fetchAll(), isEmpty);
    expect(await signedOut.incomingPending(), isEmpty);
    expect(await mirror.outbox(), isEmpty);
  });
}
