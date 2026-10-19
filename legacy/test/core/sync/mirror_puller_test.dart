import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/sync/mirror_database.dart';
import 'package:gratovo_toolbox/core/sync/mirror_puller.dart';
import 'package:gratovo_toolbox/core/sync/mirror_schema.dart';

import '../../support/temp_mirror.dart';

void main() {
  _reportSemantics();
  group('buildKeysetFilter', () {
    // The paging is a keyset rather than `updated_at > cursor` for one reason:
    // Postgres `now()` is transaction time, so a search run that upserts
    // thousands of channels in one transaction stamps every one of them with
    // the same timestamp. These tests are that reason, written down.
    test('a single-key table asks for the rest of a tied timestamp', () {
      final filter = buildKeysetFilter(
        cursorColumn: 'updated_at',
        keyColumns: ['channel_id'],
        cursor: '2026-08-29T03:17:00Z',
        key: encodeCursorKey(['UCabc']),
      );

      expect(
        filter,
        'updated_at.gt."2026-08-29T03:17:00Z",'
        'and(updated_at.eq."2026-08-29T03:17:00Z",channel_id.gt."UCabc")',
      );
    });

    test('a composite key compares lexicographically, column by column', () {
      final filter = buildKeysetFilter(
        cursorColumn: 'discovered_at',
        keyColumns: ['channel_id', 'keyword'],
        cursor: '2026-08-29T03:17:00Z',
        key: encodeCursorKey(['UCabc', 'gaming']),
      );

      expect(
        filter,
        'discovered_at.gt."2026-08-29T03:17:00Z",'
        'and(discovered_at.eq."2026-08-29T03:17:00Z",channel_id.gt."UCabc"),'
        'and(discovered_at.eq."2026-08-29T03:17:00Z",'
        'channel_id.eq."UCabc",keyword.gt."gaming")',
      );
    });

    test('quotes values, so a comma in a keyword cannot end the condition', () {
      // `channel_keywords.keyword` is whatever somebody typed into the search
      // box. Unquoted, this would parse as two conditions and return a
      // plausible page of the wrong rows — a silent failure, not an error.
      final filter = buildKeysetFilter(
        cursorColumn: 'discovered_at',
        keyColumns: ['channel_id', 'keyword'],
        cursor: '2026-08-29T03:17:00Z',
        key: encodeCursorKey(['UCabc', 'games,toys']),
      );

      expect(filter, contains('keyword.gt."games'));
      expect(filter, isNot(contains('keyword.gt.games,toys')));
    });

    test('escapes a quote in a value rather than closing the string', () {
      final filter = buildKeysetFilter(
        cursorColumn: 'discovered_at',
        keyColumns: ['keyword'],
        cursor: 'T',
        key: encodeCursorKey(['say "hi"']),
      );

      expect(filter, contains(r'keyword.gt."say \"hi\""'));
    });

    test('survives a key value containing a space', () {
      // A regression test, and the reason `encodeCursorKey` is JSON rather than
      // a join on a separator. `channel_keywords.keyword` is a search term, and
      // most search terms are more than one word. Joined on a space, the cursor
      // for "gaming setup" resumed from "gaming" — a keyword nobody searched
      // for, skipping every row between the two.
      final filter = buildKeysetFilter(
        cursorColumn: 'discovered_at',
        keyColumns: ['channel_id', 'keyword'],
        cursor: 'T',
        key: encodeCursorKey(['UCabc', 'gaming setup']),
      );

      expect(filter, contains('keyword.gt."gaming setup"'));
      expect(filter, contains('channel_id.eq."UCabc"'));
    });

    test('with no key yet, asks only for a later timestamp', () {
      final filter = buildKeysetFilter(
        cursorColumn: 'updated_at',
        keyColumns: ['channel_id'],
        cursor: '2026-08-29T03:17:00Z',
      );

      expect(filter, 'updated_at.gt."2026-08-29T03:17:00Z"');
    });
  });

  group('applyTombstone', () {
    late MirrorDatabase db;

    setUp(() {
      db = openTempMirror();
      // Every typed-in table gets a row that must go and a row that must
      // stay; deleting the wrong row is the failure worth catching here.
      for (final id in ['gone', 'stays']) {
        db.executeSync(
          'INSERT INTO channel_state (channel_id, handle) VALUES (?, ?)',
          ['UC$id', '@$id'],
        );
        db.executeSync(
          'INSERT INTO deals (id, channel_id) VALUES (?, ?)',
          ['d-$id', 'UC$id'],
        );
        db.executeSync(
          'INSERT INTO scratchpads (user_id, body) VALUES (?, ?)',
          ['u-$id', 'note'],
        );
        // And a pipeline row, which no tombstone may touch: the archive
        // (through the catalog) is the only thing that removes a channel.
        db.executeSync(
          'INSERT INTO channels (channel_id, handle, first_seen_at) '
          'VALUES (?, ?, ?)',
          ['UC$id', '@$id', 'T'],
        );
      }
    });

    tearDown(() => discardTempMirror(db));

    test('a channel_state tombstone is keyed on channel_id', () async {
      applyTombstone(db, table: 'channel_state', rowId: 'UCgone');

      expect(await _column(db, 'channel_state', 'channel_id'), ['UCstays']);
      // The scraped row stays: a teammate clearing a channel's typed-in state
      // (an undo of every edit) is not an archive.
      expect(
          await _column(db, 'channels', 'channel_id'), ['UCgone', 'UCstays']);
    });

    test('a scratchpad tombstone is keyed on user_id', () async {
      applyTombstone(db, table: 'scratchpads', rowId: 'u-gone');
      expect(await _column(db, 'scratchpads', 'user_id'), ['u-stays']);
    });

    test('every other table is keyed on id', () async {
      applyTombstone(db, table: 'deals', rowId: 'd-gone');
      expect(await _column(db, 'deals', 'id'), ['d-stays']);
    });

    test('a tombstone for an unmirrored table changes nothing', () async {
      // An old client meeting a table a later migration added. It should ignore
      // news it has no use for, not refuse to sync.
      applyTombstone(db, table: 'something_later', rowId: 'UCgone');
      applyTombstone(db, table: 'channels', rowId: 'UCgone');

      expect(
          await _column(db, 'channels', 'channel_id'), ['UCgone', 'UCstays']);
      expect(await _column(db, 'channel_state', 'channel_id'),
          ['UCgone', 'UCstays']);
    });
  });

  group('MirrorDatabase', () {
    test('reopening an older file keeps its data and stamps the version',
        () async {
      // The one rule of this file: never delete or rebuild it. It is shared
      // with the pipeline and holds unsent local work, so an older stamp
      // means "run the migrations", never "start over".
      final db = openTempMirror();
      final path = db.path;
      db.executeSync(
        'INSERT INTO channels (channel_id, handle, first_seen_at) '
        'VALUES (?, ?, ?)',
        ['UCold', '@old', 'T'],
      );
      db.executeSync(
        'INSERT INTO channel_state (channel_id, handle) VALUES (?, ?)',
        ['UCold', '@old'],
      );
      db.writeMeta(MirrorMetaKeys.schemaVersion, '0');
      db.close();

      final reopened = MirrorDatabase.open(path);
      addTearDown(() => discardTempMirror(reopened));

      expect(await _column(reopened, 'channels', 'channel_id'), ['UCold']);
      expect(await _column(reopened, 'channel_state', 'channel_id'), ['UCold']);
      expect(
        reopened.readMeta(MirrorMetaKeys.schemaVersion),
        '$kAppSchemaVersion',
      );
    });

    test('the old mirror\'s meta rows are pruned on open', () async {
      // `schema_version` was the previous mirror's "delete the file" gate,
      // and the cursor rows belong to tables no longer pulled. Left in place
      // they could be mistaken for the current keys.
      final db = openTempMirror();
      final path = db.path;
      db.writeMeta('schema_version', '7');
      db.writeMeta('cursor.channels.value', 'T');
      db.writeMeta('cursor.deals.value', 'T');
      db.close();

      final reopened = MirrorDatabase.open(path);
      addTearDown(() => discardTempMirror(reopened));

      expect(reopened.readMeta('schema_version'), isNull);
      expect(reopened.readMeta('cursor.channels.value'), isNull);
      expect(reopened.readMeta('cursor.deals.value'), 'T');
    });

    test('the view over both halves is rebuilt on every open', () async {
      final db = openTempMirror();
      addTearDown(() => discardTempMirror(db));

      db.executeSync(
        'INSERT INTO channels (channel_id, handle, subscribers, first_seen_at) '
        'VALUES (?, ?, ?, ?)',
        ['UCa', '@a', '12,345', 'T'],
      );
      // No channel_state row: the view supplies the defaults every untouched
      // channel implicitly has.
      final rows = await db.getAll(
        'SELECT subscribers, vetting_status, channel_tags '
        'FROM influencer_channels',
      );
      expect(rows.single['subscribers'], 12345);
      expect(rows.single['vetting_status'], 'newlyFound');
      expect(rows.single['channel_tags'], '[]');
    });

    test('wipeData clears downloaded rows and cursors but keeps local work',
        () async {
      // The full re-sync a client does when it falls behind the tombstone
      // horizon. The server can resend a deal; nothing can resend an edit
      // that exists only in this queue, and nothing of the pipeline's is this
      // database's to wipe.
      final db = openTempMirror();
      addTearDown(() => discardTempMirror(db));

      db.executeSync(
        'INSERT INTO channels (channel_id, handle, first_seen_at) '
        'VALUES (?, ?, ?)',
        ['UCa', '@a', 'T'],
      );
      db.executeSync(
        'INSERT INTO channel_state (channel_id, handle) VALUES (?, ?)',
        ['UCa', '@a'],
      );
      db.executeSync(
        'INSERT INTO activity_log (id, at, synced) VALUES (?, ?, ?)',
        ['pulled', 'T', 1],
      );
      db.executeSync(
        'INSERT INTO activity_log (id, at, synced) VALUES (?, ?, ?)',
        ['unsent', 'T', 0],
      );
      db.executeSync(
        'INSERT INTO _outbox (kind, payload, created_at) VALUES (?, ?, ?)',
        ['channel.edit', '{"channel_id":"UCa"}', 'now'],
      );
      db.writeMeta(MirrorMetaKeys.cursorValue('channel_state'), 'T');
      db.writeMeta(MirrorMetaKeys.hasSynced, 'true');

      db.wipeData();

      expect(await _column(db, 'channel_state', 'channel_id'), isEmpty);
      expect(await _column(db, 'channels', 'channel_id'), ['UCa']);
      expect(await _column(db, 'activity_log', 'id'), ['unsent']);
      expect(db.readMeta(MirrorMetaKeys.cursorValue('channel_state')), isNull);
      expect(db.readMeta(MirrorMetaKeys.hasSynced), isNull);
      expect(
        await db.getAll('SELECT kind FROM _outbox'),
        [
          {'kind': 'channel.edit'}
        ],
      );
      expect(
        db.readMeta(MirrorMetaKeys.schemaVersion),
        '$kAppSchemaVersion',
      );
    });
  });
}

Future<List<String>> _column(
  MirrorDatabase db,
  String table,
  String column,
) async {
  final rows = await db.getAll('SELECT $column AS v FROM $table ORDER BY v');
  return [for (final row in rows) row['v'] as String];
}

/// The distinction that decides whether the app trusts its local copy.
///
/// `ok` and `complete` are deliberately different questions, and conflating
/// them is how a half-read mirror would announce itself as authoritative:
/// every screen switches to reading the local file on `hasSynced`, so a pass
/// that stopped on its budget with tables still to fetch must not write it —
/// even though nothing about that pass went wrong.
void _reportSemantics() {
  group('MirrorPullReport', () {
    test('a clean full pass is both fine and finished', () {
      const report = MirrorPullReport(
        written: 10,
        failures: [],
        elapsed: Duration(seconds: 1),
      );
      expect(report.ok, isTrue);
      expect(report.complete, isTrue);
    });

    test('running out of time is not a failure, but is not finished either',
        () {
      const report = MirrorPullReport(
        written: 10,
        failures: [],
        incomplete: true,
        elapsed: Duration(minutes: 2),
      );
      // Nothing to alarm anybody with: the rows that came down are good, and
      // the cursors mean the next pass carries on rather than starts again.
      expect(report.ok, isTrue, reason: 'nothing went wrong');
      // But the mirror cannot claim to be a full copy yet.
      expect(report.complete, isFalse);
    });

    test('a failed table is neither', () {
      final report = MirrorPullReport(
        written: 0,
        failures: [MirrorPullFailure('channels', StateError('nope'))],
        elapsed: const Duration(seconds: 1),
      );
      expect(report.ok, isFalse);
      expect(report.complete, isFalse);
    });
  });
}
