import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/data/models/edit_conflict.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_influencer_repository.dart';

import '../../data/repositories/mirror/memory_mirror.dart';

/// The queue is the half of a local write that has no visible effect until the
/// machine reconnects, which is exactly why it needs tests of its own: a
/// repository that updates the local row and forgets to enqueue passes every
/// read-back assertion in the suite and silently drops the edit.
void main() {
  late MemoryMirror mirror;
  late MirrorInfluencerRepository repository;

  setUp(() {
    mirror = MemoryMirror();
    repository = MirrorInfluencerRepository(
      mirror,
      actor: const SyncActor(id: 'user-1', name: 'Sara'),
    );
  });

  tearDown(() => mirror.close());

  // A channel is two rows in two tables: the pipeline's scraped row and the
  // app's typed-in state. The seed writes both, the way a synced machine
  // would hold them.
  Future<void> seedChannel({
    String id = 'UCabc',
    String notes = 'first note',
  }) async {
    await mirror.execute(
      'INSERT INTO channels (channel_id, handle, first_seen_at) '
      'VALUES (?, ?, ?)',
      [id, '@abc', '2026-01-01T00:00:00Z'],
    );
    await mirror.execute(
      'INSERT INTO channel_state (channel_id, handle, notes, vetting_status, '
      'pipeline_stage, channel_tags, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        '@abc',
        notes,
        'newlyFound',
        'new',
        '["undecided"]',
        '2026-01-01T00:00:00Z'
      ],
    );
  }

  group('what a write leaves in the queue', () {
    test('an applied edit queues the base it was composed against', () async {
      await seedChannel();

      final outcome = await repository.updateNotes(
        'UCabc',
        'second note',
        base: 'first note',
      );

      expect(outcome, EditOutcome.applied);

      final queued = await mirror.outbox();
      expect(queued, hasLength(1));
      expect(queued.single['kind'], OutboxKind.channelEdit);

      // The base travelling with the edit is the whole point: the server runs
      // the same compare-and-set against whatever the column holds by the time
      // this arrives, which may be minutes later.
      final payload = jsonDecode(queued.single['payload'] as String) as Map;
      expect(payload['channel_id'], 'UCabc');
      expect(payload['field'], 'notes');
      expect(payload['base'], 'first note');
      expect(payload['next'], 'second note');
    });

    test('a refused edit queues the conflict and no channel write', () async {
      await seedChannel(notes: 'somebody else got here first');

      final outcome = await repository.updateNotes(
        'UCabc',
        'mine',
        base: 'first note',
      );

      expect(outcome, EditOutcome.conflict);

      // Nothing may be queued against `channel_state`. The local row was not
      // written either — the refused text lives only in the conflict row.
      final queued = await mirror.outbox();
      expect(queued.map((row) => row['kind']), [OutboxKind.conflictFile]);

      final rows = await mirror.getAll('SELECT notes FROM channel_state');
      expect(rows.single['notes'], 'somebody else got here first');
    });

    test('re-saving against the same stale base updates one conflict',
        () async {
      // Mirrors the `on conflict ... do update` in apply_channel_edit: somebody
      // who keeps typing and re-saving files one disagreement, not a page full
      // of copies of it.
      await seedChannel(notes: 'theirs');

      await repository.updateNotes('UCabc', 'mine', base: 'first note');
      await repository.updateNotes('UCabc', 'mine again', base: 'first note');

      final conflicts = await mirror.getAll('SELECT id FROM edit_conflicts');
      expect(conflicts, hasLength(1));

      // Two queued entries carrying the same conflict id, so whichever order
      // they reach the server it converges on one row.
      final queued = await mirror.outbox();
      expect(queued, hasLength(2));
      final ids = [
        for (final row in queued)
          (jsonDecode(row['payload'] as String) as Map)['id'],
      ];
      expect(ids.first, ids.last);
      expect(ids.first, conflicts.single['id']);
    });

    test('a noop edit queues nothing at all', () async {
      // A save with no change in it must not put anything on the wire — the
      // database answers `noop` for this case, and not asking is cheaper.
      await seedChannel();

      final outcome = await repository.updateNotes(
        'UCabc',
        'first note',
        base: 'first note',
      );

      expect(outcome, EditOutcome.noop);
      expect(await mirror.outbox(), isEmpty);
    });

    test('a manual channel queues only its typed-in state', () async {
      await repository.create(
        const NewInfluencer(handle: 'newcreator', name: 'New Creator'),
      );

      final queued = await mirror.outbox();
      expect(queued.single['kind'], OutboxKind.rowUpsert);

      final payload = jsonDecode(queued.single['payload'] as String) as Map;
      expect(payload['table'], 'channel_state');
      expect(payload['id'], 'manual:@newcreator');
      final row = payload['row'] as Map;
      expect(row['channel_id'], 'manual:@newcreator');
      expect(row['handle'], '@newcreator');
      // The scraped facts (name, link, subscribers) go to the pipeline's own
      // table and never to the server: nothing scraped lives there.
      expect(row.containsKey('name'), isFalse);
      expect(row.containsKey('first_seen_at'), isFalse);
      // A real list, not the JSON string the local column holds, because the
      // payload is what PostgREST receives.
      expect(row['channel_tags'], isA<List<Object?>>());

      // And the pipeline's row exists, flagged for a fetch.
      final channels = await mirror.getAll(
        'SELECT name, force_refetch FROM channels WHERE channel_id = ?',
        ['manual:@newcreator'],
      );
      expect(channels.single['name'], 'New Creator');
      expect(channels.single['force_refetch'], 1);
    });

    test('entries come back in the order they were made', () async {
      // A channel created offline and then edited has to arrive in that order,
      // or the edit lands on nothing.
      await repository.create(const NewInfluencer(handle: 'newcreator'));
      await repository.updateNotes('manual:@newcreator', 'a note', base: null);

      final queued = await mirror.outbox();
      expect(
        queued.map((row) => row['kind']),
        [OutboxKind.rowUpsert, OutboxKind.channelEdit],
      );
      expect(
        queued.first['seq'] as int,
        lessThan(queued.last['seq'] as int),
      );
    });

    test('tagging a channel rejected starts the countdown locally only',
        () async {
      await seedChannel();

      await repository.updateChannelTags(
        'UCabc',
        [ChannelTag.irrelevant],
        base: [ChannelTag.undecided],
      );

      // One entry: the tag edit. The server's own trigger derives the
      // countdown from the tag, so nothing is queued for the date — the one
      // written locally is what the row shows until the next pull.
      final queued = await mirror.outbox();
      expect(queued.map((row) => row['kind']), [OutboxKind.channelEdit]);

      final rows = await mirror.getAll(
        'SELECT archive_due_at FROM channel_state WHERE channel_id = ?',
        ['UCabc'],
      );
      expect(rows.single['archive_due_at'], isNotNull);
    });

    // "Archive now" is the one path that waives the grace period. The sweep
    // used to be a nightly database job; it is this machine's now, so the
    // channel goes at once — locally, and through the pipeline in the bucket.
    test('archiving now tombstones locally and queues the R2 side', () async {
      await seedChannel();
      await repository.updateChannelTags(
        'UCabc',
        [ChannelTag.irrelevant],
        base: [ChannelTag.undecided],
      );
      await mirror.execute('DELETE FROM _outbox');

      await repository.archiveNow('UCabc');

      final queued = await mirror.outbox();
      expect(
        queued.map((row) => row['kind']),
        [
          // The moved date, for teammates who see the countdown chip.
          OutboxKind.rowUpsert,
          // The state row is gone with the channel.
          OutboxKind.rowDeleteMany,
          // And the pipeline deletes the object and announces the tombstone.
          OutboxKind.archiveChannels,
        ],
      );
      final payload = jsonDecode(queued.last['payload'] as String) as Map;
      final entries = payload['entries'] as List;
      expect(entries.single['channel_id'], 'UCabc');
      expect(entries.single['label'], 'irrelevant');

      expect(await mirror.getAll('SELECT * FROM channels'), isEmpty);
      expect(await mirror.getAll('SELECT * FROM channel_state'), isEmpty);
      final tombstone = await mirror.getAll('SELECT * FROM channel_archive');
      expect(tombstone.single['channel_id'], 'UCabc');
      expect(tombstone.single['label'], 'irrelevant');
      expect(tombstone.single['handle'], '@abc');
    });
  });

  group('OutboxEntry.fromRow', () {
    test('reads back what enqueueOutbox wrote', () async {
      await enqueueOutbox(
        mirror,
        kind: OutboxKind.archiveRestore,
        payload: {
          'channel_ids': ['UCabc']
        },
      );

      final entry = OutboxEntry.fromRow((await mirror.outbox()).single);
      expect(entry, isNotNull);
      expect(entry!.kind, OutboxKind.archiveRestore);
      expect(entry.payload['channel_ids'], ['UCabc']);
    });

    test('returns null for a payload that will not parse', () {
      // Only reachable on a database somebody has edited by hand. The uploader
      // discards these rather than retrying forever, because an entry it cannot
      // read is an entry it can never send — and it sits in front of every
      // later edit until it goes.
      expect(
        OutboxEntry.fromRow({'seq': 1, 'kind': 'x', 'payload': 'not json'}),
        isNull,
      );
      expect(
        OutboxEntry.fromRow({'seq': 1, 'kind': 'x', 'payload': '[1,2]'}),
        isNull,
      );
      expect(
        OutboxEntry.fromRow({'seq': null, 'kind': 'x', 'payload': '{}'}),
        isNull,
      );
    });
  });
}
