import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/sync/mirror_fault.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// The engine's half of the local-fault handling, against a real file.
///
/// No network is touched: the client is pointed at an address nothing answers
/// on, and nothing here starts a pass. What is being checked is the seam
/// between a repository's failed query and the status every screen reads —
/// which is what decides whether a broken file is a change of source or a
/// broken app.
void main() {
  late Directory directory;
  late SupabaseClient client;

  setUp(() {
    directory = Directory.systemTemp.createTempSync('gratovo_engine_fault');
    // Constructing a client makes no request; this one is never asked to.
    client = SupabaseClient('http://127.0.0.1:1', 'test-anon-key');
  });

  tearDown(() async {
    await client.dispose();
    try {
      directory.deleteSync(recursive: true);
    } on FileSystemException {
      // Windows keeps a handle on the -wal for a moment after close. The temp
      // directory is the OS's problem at that point, not this test's.
    }
  });

  test('a failed local query takes the local copy out of service', () async {
    final engine = await openSyncEngine(
      client: client,
      databasePath: '${directory.path}/gratovo.db',
      logDirectory: directory.path,
    );
    expect(engine, isNotNull, reason: 'the mirror should open on a temp dir');
    addTearDown(engine!.close);

    expect(engine.status.localUsable, isTrue);

    // What a repository does, and the shape of the failure this exists for: a
    // query the local database refuses. A missing table stands in for the
    // corrupt page, the closed handle and the full disk — the engine cannot
    // tell them apart and does not need to.
    await expectLater(
      engine.db.getAll('SELECT * FROM a_table_that_is_not_there'),
      throwsA(isA<MirrorFault>()),
    );

    // The status every screen reads now says the local copy is not to be
    // trusted, which is what the sync card in Settings reports.
    expect(engine.status.localUsable, isFalse);
    expect(engine.status.localError, isA<MirrorFault>());
    expect(engine.status.hasError, isTrue);

    // ...and the server side of the status is untouched. The two failures mean
    // opposite things and must not be reported as each other.
    expect(engine.status.downloadError, isNull);
    expect(engine.status.uploadError, isNull);
  });

  test('a healthy mirror keeps answering ordinary queries', () async {
    final engine = await openSyncEngine(
      client: client,
      databasePath: '${directory.path}/gratovo.db',
      logDirectory: directory.path,
    );
    addTearDown(engine!.close);

    // The guard is a pass-through when nothing is wrong — worth asserting,
    // because a wrapper that quietly changed a result would be far worse than
    // the failure it was added to handle.
    await engine.db.execute(
      'INSERT INTO channels (channel_id, handle, name, first_seen_at) '
      "VALUES ('UC1', '@test', 'Test', '2026-01-01T00:00:00Z')",
    );
    final rows = await engine.db.getAll(
      'SELECT channel_id, name FROM channels',
    );
    expect(rows, [
      {'channel_id': 'UC1', 'name': 'Test'}
    ]);
    expect(engine.status.localUsable, isTrue);
  });
}
