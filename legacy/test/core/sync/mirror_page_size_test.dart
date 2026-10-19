import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/sync/mirror_database.dart';
import 'package:gratovo_toolbox/core/sync/mirror_network.dart';
import 'package:gratovo_toolbox/core/sync/mirror_puller.dart';
import 'package:gratovo_toolbox/core/sync/mirror_schema.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../support/temp_mirror.dart';

/// The page size a table has learned it can actually land.
///
/// Written down in `_sync_meta` rather than held in memory, and these tests are
/// that reason. The mirror spent an entire day pinned on one `channels` page:
/// 500 rows, timed out at 60 s, every pass, across five app launches, while the
/// same query for a single row answered in 300 ms and every other table
/// finished in 100 ms. A pass that fails on its first page has no room left for
/// a second attempt — the log says `attempt=1 of=3` every time — so the smaller
/// ask is only ever useful to the *next* pass, and only if it survives the
/// process ending.
void main() {
  late MirrorDatabase db;
  late MirrorPuller puller;

  setUp(() {
    db = openTempMirror();
    puller = MirrorPuller(
      database: db,
      // Never used: nothing here makes a request.
      client: SupabaseClient('http://127.0.0.1:1', 'test-anon-key'),
    );
  });

  tearDown(() => discardTempMirror(db));

  test('a table asks for the default until one of its pages fails', () {
    expect(puller.pageSizeFor('channel_state'), kMirrorDefaultPageSize);
  });

  test('a failed page is remembered, so the next pass asks for less', () {
    puller.notePageFailure('channel_state', kMirrorDefaultPageSize);

    expect(puller.pageSizeFor('channel_state'), 125);
    expect(
      db.readMeta(MirrorMetaKeys.pageSize('channel_state')),
      '125',
      reason: 'it has to survive the app closing — that is the whole point',
    );
  });

  test('and it is only that table that asks for less', () {
    puller.notePageFailure('channel_state', kMirrorDefaultPageSize);

    expect(puller.pageSizeFor('deals'), kMirrorDefaultPageSize);
  });

  test('repeated failures climb down to the floor and stop', () {
    var size = kMirrorDefaultPageSize;
    for (var i = 0; i < 6; i++) {
      puller.notePageFailure('channel_state', size);
      size = puller.pageSizeFor('channel_state');
    }

    expect(size, kMirrorMinPageSize);
  });

  test('a page that lands grows the ask back', () {
    puller.notePageFailure('channel_state', kMirrorDefaultPageSize);
    puller.notePageSuccess('channel_state', 125);

    expect(puller.pageSizeFor('channel_state'), kMirrorDefaultPageSize);
  });

  test('and once it is back at the default the row goes with it', () {
    // Left behind, `_sync_meta` would keep claiming a limit that no longer
    // applies — and it is the first place anybody looks when a pull misbehaves.
    puller.notePageFailure('channel_state', kMirrorDefaultPageSize);
    puller.notePageSuccess('channel_state', 125);

    expect(db.readMeta(MirrorMetaKeys.pageSize('channel_state')), isNull);
  });

  test('a size left by an older build cannot push the ask below the floor', () {
    db.writeMeta(MirrorMetaKeys.pageSize('channel_state'), '1');

    expect(puller.pageSizeFor('channel_state'), kMirrorMinPageSize);
  });

  test('nor above the default', () {
    db.writeMeta(MirrorMetaKeys.pageSize('channel_state'), '5000');

    expect(puller.pageSizeFor('channel_state'), kMirrorDefaultPageSize);
  });
}
