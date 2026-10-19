import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/data/models/archived_channel.dart';
import 'package:gratovo_toolbox/data/models/bulk_archive_due.dart';
import 'package:gratovo_toolbox/data/models/bulk_rejection.dart';
import 'package:gratovo_toolbox/data/models/edit_conflict.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/local_archive.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_archive_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_conflict_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_influencer_repository.dart';

import 'memory_mirror.dart';

/// The archive and the conflicts, against a real SQLite engine.
///
/// Both are local-first now, and the things worth pinning are the ones a
/// mock cannot reproduce: nulls-last ordering (which SQLite gets backwards by
/// default), the bulk tools' SQL over the `influencer_channels` view, and
/// exactly what each write leaves in the outbox — because the queue is the
/// half of a write that has no visible effect until the machine reconnects.
void main() {
  late MemoryMirror mirror;

  String iso(DateTime value) => value.toUtc().toIso8601String();

  setUp(() => mirror = MemoryMirror());
  tearDown(() => mirror.close());

  Future<List<String>> kinds() async =>
      [for (final row in await mirror.outbox()) row['kind'] as String];

  Map<String, dynamic> payloadOf(Map<String, Object?> row) =>
      jsonDecode(row['payload']! as String) as Map<String, dynamic>;

  group('the archive', () {
    late MirrorArchiveRepository repo;

    /// A tombstone, as the pipeline (or a previous sweep) would leave it.
    Future<void> addArchived({
      required String id,
      String? handle,
      int? subscribers,
      String label = 'irrelevant',
      DateTime? archivedAt,
    }) {
      return mirror.execute(
        'INSERT INTO channel_archive (channel_id, handle, subscribers, label, '
        "archived_at, source, announced) VALUES (?, ?, ?, ?, ?, 'remote', 1)",
        [
          id,
          handle ?? '@$id',
          subscribers?.toString(),
          label,
          iso(archivedAt ?? DateTime.now().toUtc()),
        ],
      );
    }

    /// A live channel: the pipeline's row, plus (optionally) the app's state.
    Future<void> addLive({
      required String id,
      int? subscribers,
      int? medianViews,
      int videosLast30 = 0,
      List<String>? tags,
      DateTime? archiveDueAt,
      DateTime? firstSeenAt,
    }) async {
      await mirror.execute(
        'INSERT INTO channels (channel_id, handle, subscribers, '
        'median_views_last_30, videos_last_30, first_seen_at) '
        'VALUES (?, ?, ?, ?, ?, ?)',
        [
          id,
          '@$id',
          subscribers?.toString(),
          medianViews,
          videosLast30,
          iso(firstSeenAt ?? DateTime.utc(2026, 1, 1)),
        ],
      );
      await mirror.execute(
        'INSERT INTO channel_keywords (channel_id, keyword, discovered_at) '
        'VALUES (?, ?, ?)',
        [id, 'cats', iso(DateTime.utc(2026, 1, 1))],
      );
      if (tags != null || archiveDueAt != null) {
        await mirror.execute(
          'INSERT INTO channel_state (channel_id, handle, channel_tags, '
          'archive_due_at) VALUES (?, ?, ?, ?)',
          [
            id,
            '@$id',
            jsonEncode(tags ?? const <String>[]),
            archiveDueAt == null ? null : iso(archiveDueAt),
          ],
        );
      }
    }

    setUp(() => repo = MirrorArchiveRepository(mirror));

    test('a channel with no subscriber count sorts last either way', () async {
      await addArchived(id: 'known', subscribers: 5000);
      await addArchived(id: 'unknown');

      for (final descending in [true, false]) {
        final page = await repo.getPage(
          offset: 0,
          limit: 10,
          query: ArchiveQuery(
            sortBy: ArchiveSortBy.subscribers,
            descending: descending,
          ),
        );
        expect(
          page.map((c) => c.channelId).toList(),
          ['known', 'unknown'],
          reason: 'descending: $descending',
        );
      }
    });

    test('subscribers sort numerically, not as text', () async {
      // The pipeline stores the count as text. "9" must not sort after
      // "10000".
      await addArchived(id: 'small', subscribers: 9);
      await addArchived(id: 'big', subscribers: 10000);

      final page = await repo.getPage(
        offset: 0,
        limit: 10,
        query: const ArchiveQuery(sortBy: ArchiveSortBy.subscribers),
      );
      expect(page.map((c) => c.channelId), ['big', 'small']);
    });

    test('filters by label and searches the handle', () async {
      await addArchived(id: 'a', handle: '@cookingcorner', label: 'haramStuff');
      await addArchived(id: 'b', handle: '@techtaha', label: 'irrelevant');

      final byLabel = await repo.getPage(
        offset: 0,
        limit: 10,
        query: const ArchiveQuery(label: ChannelTag.haramStuff),
      );
      expect(byLabel.map((c) => c.channelId), ['a']);

      final bySearch = await repo.getPage(
        offset: 0,
        limit: 10,
        query: const ArchiveQuery(search: 'TAHA'),
      );
      expect(bySearch.map((c) => c.channelId), ['b']);
    });

    test('reports which of a page of ids are archived', () async {
      await addArchived(id: 'gone');
      final archived = await repo.archivedIdsAmong(['gone', 'still_here']);
      expect(archived, {'gone'});
      expect(await repo.archivedIdsAmong(const []), isEmpty);
    });

    test('counts everything, ignoring any filter', () async {
      await addArchived(id: 'a', label: 'haramStuff');
      await addArchived(id: 'b', label: 'irrelevant');
      expect(await repo.count(), 2);
    });

    test(
        'un-archiving drops the tombstone, seeds a bare row, queues the '
        'restore', () async {
      await addArchived(id: 'a');
      await repo.unarchive('a');

      expect(await repo.count(), 0);
      // The object was deleted from the bucket when it was archived, so
      // what comes back is a row flagged for a fresh scrape.
      final rows = await mirror.getAll(
        'SELECT handle, force_refetch FROM channels WHERE channel_id = ?',
        ['a'],
      );
      expect(rows.single['handle'], '@a');
      expect(rows.single['force_refetch'], 1);

      final queued = await mirror.outbox();
      expect(queued.single['kind'], OutboxKind.archiveRestore);
      expect(payloadOf(queued.single)['channel_ids'], ['a']);
    });

    test('un-archiving a channel that is not archived does nothing', () async {
      await repo.unarchive('nope');
      expect(await mirror.outbox(), isEmpty);
      expect(await mirror.getAll('SELECT * FROM channels'), isEmpty);
    });

    test('re-labelling keeps the row, changes the label, queues the pipeline',
        () async {
      await addArchived(id: 'a', label: 'irrelevant', subscribers: 500);
      await repo.updateLabel('a', ChannelTag.inactive);

      final row = (await repo.getPage(offset: 0, limit: 1)).single;
      expect(row.label, ChannelTag.inactive);
      expect(row.subscriberCount, 500, reason: 'nothing else on the row moves');

      final queued = await mirror.outbox();
      expect(queued.single['kind'], OutboxKind.archiveChannels);
      expect(payloadOf(queued.single)['entries'], [
        {'channel_id': 'a', 'label': 'inactive'},
      ]);
    });

    test('re-labelling with the label it already has queues nothing', () async {
      await addArchived(id: 'a', label: 'inactive');
      await repo.updateLabel('a', ChannelTag.inactive);
      expect(await mirror.outbox(), isEmpty);
    });

    test('re-labelling refuses a non-rejecting tag', () async {
      await addArchived(id: 'a');
      expect(
        () => repo.updateLabel('a', ChannelTag.qualified),
        throwsArgumentError,
      );
    });

    test('the channel URL is rebuilt rather than stored', () async {
      await addArchived(id: 'a', handle: 'nohandleprefix');
      final row = (await repo.getPage(offset: 0, limit: 1)).single;
      expect(row.channelUrl, 'https://www.youtube.com/@nohandleprefix');
    });

    group('bulk reject', () {
      test('a dry run counts and writes nothing', () async {
        await addLive(id: 'small', subscribers: 500);
        await addLive(id: 'big', subscribers: 50000);
        await addLive(id: 'unknown');
        await addLive(id: 'already', subscribers: 100, tags: ['irrelevant']);

        final outcome = await repo.bulkReject(
          const BulkRejectionRequest(maxSubscribers: 1000),
        );

        expect(outcome.matched, 1);
        expect(outcome.tagged, 0);
        expect(outcome.skippedAlreadyTagged, 1);
        expect(outcome.skippedUnknownSize, 1);
        expect(outcome.skippedProtected, 0);
        expect(await mirror.outbox(), isEmpty);
        expect(
            await mirror.getAll('SELECT * FROM channel_state'), hasLength(1));
      });

      test('a real run tags the matched rows and queues one entry', () async {
        await addLive(id: 'small', subscribers: 500);
        await addLive(id: 'tiny', subscribers: 5);
        await addLive(id: 'big', subscribers: 50000);

        final outcome = await repo.bulkReject(
          const BulkRejectionRequest(
            maxSubscribers: 1000,
            label: ChannelTag.inactive,
          ),
          dryRun: false,
        );

        expect(outcome.matched, 2);
        expect(outcome.tagged, 2);
        expect(outcome.archived, 0, reason: 'not immediate: the 7 days run');
        expect(outcome.pendingIds, isEmpty);

        final state = await mirror.getAll(
          'SELECT channel_id, channel_tags, archive_due_at FROM channel_state '
          'ORDER BY channel_id',
        );
        expect(state.map((r) => r['channel_id']), ['small', 'tiny']);
        expect(state.first['channel_tags'], '["inactive"]');
        expect(state.first['archive_due_at'], isNotNull);

        // Thousands of rows are one entry, not thousands.
        final queued = await mirror.outbox();
        expect(queued.single['kind'], OutboxKind.rowUpsertMany);
        final payload = payloadOf(queued.single);
        expect(payload['table'], 'channel_state');
        final rows = payload['rows'] as List;
        expect(rows, hasLength(2));
        expect(rows.first['channel_tags'], ['inactive']);
        expect(rows.first['handle'], isNotNull);
      });

      test('a channel with a deal or a thread is protected', () async {
        await addLive(id: 'dealt', subscribers: 500);
        await addLive(id: 'contacted', subscribers: 500);
        await addLive(id: 'plain', subscribers: 500);
        await mirror.execute(
          "INSERT INTO deals (id, channel_id) VALUES ('d1', 'dealt')",
        );
        await mirror.execute(
          "INSERT INTO outreach_threads (id, channel_id) VALUES ('t1', 'contacted')",
        );

        final outcome = await repo.bulkReject(
          const BulkRejectionRequest(maxSubscribers: 1000),
          dryRun: false,
        );

        expect(outcome.matched, 1);
        expect(outcome.skippedProtected, 2);
      });

      test('the median-views and videos bounds narrow together', () async {
        await addLive(id: 'dead', subscribers: 80000, medianViews: 300);
        await addLive(id: 'alive', subscribers: 2000, medianViews: 40000);
        await addLive(
            id: 'quiet', subscribers: 80000, medianViews: 300, videosLast30: 4);

        final outcome = await repo.bulkReject(
          const BulkRejectionRequest(
            maxMedianViews: 1000,
            minVideosLast30: 2,
          ),
        );
        // `dead` posts nothing and is watched by nobody; `quiet` posts 4 a
        // month, so it clears the videos floor and survives.
        expect(outcome.matched, 1);
      });

      test('an unmeasured median counts as zero, not as unknown', () async {
        // `neverScraped` is the auto-clean gate's own doing: archived on
        // subscriber count alone, before its videos -- and so its median --
        // were ever fetched. A clean aimed at "median views below 10K" has to
        // reach it the same way the dashboard's <10K bucket already counts it,
        // or the bucket can never shrink no matter how many times it runs.
        await addLive(id: 'neverScraped', subscribers: 80000);
        await addLive(id: 'measuredLow', subscribers: 80000, medianViews: 300);
        await addLive(
            id: 'measuredHigh', subscribers: 80000, medianViews: 40000);

        final outcome = await repo.bulkReject(
          const BulkRejectionRequest(maxMedianViews: 10000),
        );

        expect(outcome.matched, 2);
        expect(outcome.skippedUnknownSize, 0);
      });

      test('first-seen-after reaches only that run\'s channels', () async {
        await addLive(
            id: 'old', subscribers: 500, firstSeenAt: DateTime.utc(2026, 1, 1));
        await addLive(
            id: 'new', subscribers: 500, firstSeenAt: DateTime.utc(2026, 6, 1));

        final outcome = await repo.bulkReject(
          BulkRejectionRequest(
            maxSubscribers: 1000,
            firstSeenAfter: DateTime.utc(2026, 5, 1),
          ),
        );
        expect(outcome.matched, 1);
      });

      test('untouched-only skips anything a person has decided about',
          () async {
        // Five channels below the floor. Only the one nobody has touched is
        // the standing sweep's to take: a tag (rejecting or not), a vetting
        // verdict or a stage each mean somebody looked, and "too small" is no
        // longer the last word on it.
        await addLive(id: 'plain', subscribers: 500);
        await addLive(id: 'kept', subscribers: 500, tags: ['qualified']);
        await addLive(id: 'gone', subscribers: 500, tags: ['irrelevant']);
        await addLive(id: 'vetted', subscribers: 500);
        await mirror.execute(
          'INSERT INTO channel_state (channel_id, handle, vetting_status) '
          "VALUES ('vetted', '@vetted', 'relevant')",
        );
        await addLive(id: 'staged', subscribers: 500);
        await mirror.execute(
          'INSERT INTO channel_state (channel_id, handle, pipeline_stage) '
          "VALUES ('staged', '@staged', 'contacted')",
        );

        final outcome = await repo.bulkReject(
          const BulkRejectionRequest(maxSubscribers: 1000, untouchedOnly: true),
          dryRun: false,
        );

        expect(outcome.matched, 1);
        expect(outcome.tagged, 1);
        final due = await mirror.getAll(
          'SELECT channel_id FROM channel_state '
          'WHERE archive_due_at IS NOT NULL ORDER BY channel_id',
        );
        expect(due.map((r) => r['channel_id']), ['plain']);
        // `kept` still says what the person said.
        final kept = await mirror.getAll(
          "SELECT channel_tags FROM channel_state WHERE channel_id = 'kept'",
        );
        expect(kept.single['channel_tags'], '["qualified"]');
      });

      test('an immediate run tombstones locally and queues the R2 side',
          () async {
        await addLive(id: 'a', subscribers: 500);
        await addLive(id: 'b', subscribers: 600);
        await addLive(id: 'keep', subscribers: 60000);
        final progress = <(int, int)>[];

        final outcome = await repo.bulkReject(
          const BulkRejectionRequest(maxSubscribers: 1000, immediate: true),
          dryRun: false,
          onSweepProgress: (swept, total) => progress.add((swept, total)),
        );

        expect(outcome.tagged, 2);
        expect(outcome.archived, 2);
        expect(outcome.pendingIds, isEmpty);
        expect(progress.first, (0, 2));
        expect(progress.last, (2, 2));

        expect(
          (await mirror.getAll('SELECT channel_id FROM channels'))
              .map((r) => r['channel_id']),
          ['keep'],
        );
        expect(await mirror.getAll('SELECT * FROM channel_keywords'),
            hasLength(1));
        final tombstones = await mirror.getAll(
          'SELECT channel_id, label, subscribers, found_via, source, announced '
          'FROM channel_archive ORDER BY channel_id',
        );
        expect(tombstones, hasLength(2));
        expect(tombstones.first['label'], 'irrelevant');
        expect(tombstones.first['subscribers'], '500');
        expect(tombstones.first['source'], 'local');
        expect(tombstones.first['announced'], 1,
            reason: 'the pipeline announces it when the queued entry is sent');
        expect(
          (jsonDecode(tombstones.first['found_via'] as String) as List)
              .single['keyword'],
          'cats',
        );

        expect(await kinds(), [
          OutboxKind.rowUpsertMany, // the tags and date, for teammates
          OutboxKind.rowDeleteMany, // the state rows, gone with the channels
          OutboxKind.archiveChannels, // objects deleted, tombstones announced
        ]);
        final last = (await mirror.outbox()).last;
        expect(payloadOf(last)['entries'], [
          {'channel_id': 'a', 'label': 'irrelevant'},
          {'channel_id': 'b', 'label': 'irrelevant'},
        ]);
      });

      test('stopping between batches leaves the rest tagged and due', () async {
        for (var i = 0; i < 120; i++) {
          await addLive(
              id: 'c${i.toString().padLeft(3, '0')}', subscribers: 10);
        }
        var batchesDone = 0;

        final outcome = await repo.bulkReject(
          const BulkRejectionRequest(maxSubscribers: 1000, immediate: true),
          dryRun: false,
          onSweepProgress: (swept, total) {
            if (swept > 0) batchesDone++;
          },
          // One batch, then stop.
          shouldStop: () => batchesDone >= 1,
        );

        // 120 ids in batches of 50: the first batch went, the other 70 stay
        // tagged and past their date for the ordinary sweep to take.
        expect(outcome.tagged, 120);
        expect(outcome.archived, 50);
        expect(await mirror.getAll('SELECT * FROM channel_archive'),
            hasLength(50));
        final left = await mirror.getAll(
          'SELECT archive_due_at FROM channel_state',
        );
        expect(left, hasLength(70));
        expect(left.every((r) => r['archive_due_at'] != null), isTrue);
      });

      test('the last partial batch is not dropped', () {
        // The off-by-one that matters is silent: a loop that loses the last
        // partial batch leaves channels tagged, due and undeleted, and the
        // only sign is a count lower than the one that was confirmed.
        final batches = MirrorArchiveRepository.sweepBatches(
          [for (var i = 0; i < 120; i++) '$i'],
        );
        expect(batches.map((b) => b.length), [50, 50, 20]);
      });

      test('refuses a request with no bound', () async {
        expect(
          () => repo.bulkReject(const BulkRejectionRequest()),
          throwsArgumentError,
        );
      });
    });

    group('bulk manage due', () {
      test('undo clears the tags and the countdown', () async {
        await addLive(
            id: 'due',
            subscribers: 500,
            tags: ['irrelevant'],
            archiveDueAt: DateTime.utc(2026, 9, 1));
        await addLive(id: 'not_due', subscribers: 500, tags: ['qualified']);

        final outcome = await repo.bulkManageArchiveDue(
          const BulkArchiveDueRequest(action: ArchiveDueAction.undo),
          dryRun: false,
        );

        expect(outcome.matched, 1);
        expect(outcome.updated, 1);
        final rows = await mirror.getAll(
          'SELECT channel_tags, archive_due_at FROM channel_state '
          "WHERE channel_id = 'due'",
        );
        expect(rows.single['channel_tags'], '[]');
        expect(rows.single['archive_due_at'], isNull);

        final queued = await mirror.outbox();
        expect(queued.single['kind'], OutboxKind.rowUpsertMany);
        final row = (payloadOf(queued.single)['rows'] as List).single;
        expect(row['channel_tags'], isEmpty);
        expect(row['archive_due_at'], isNull);
      });

      test('archive now sweeps under the strongest rejecting tag', () async {
        await addLive(
            id: 'due',
            subscribers: 500,
            tags: ['inactive', 'haramStuff'],
            archiveDueAt: DateTime.utc(2026, 9, 1));

        final outcome = await repo.bulkManageArchiveDue(
          const BulkArchiveDueRequest(action: ArchiveDueAction.archiveNow),
          dryRun: false,
        );

        expect(outcome.updated, 1);
        expect(outcome.archived, 1);
        final tombstone =
            await mirror.getAll('SELECT label FROM channel_archive');
        expect(tombstone.single['label'], 'haramStuff');
      });

      test('a stale countdown without a rejecting tag is not a candidate',
          () async {
        await addLive(
            id: 'stale',
            subscribers: 500,
            tags: ['qualified'],
            archiveDueAt: DateTime.utc(2026, 9, 1));
        final outcome = await repo.bulkManageArchiveDue(
          const BulkArchiveDueRequest(action: ArchiveDueAction.archiveNow),
        );
        expect(outcome.matched, 0);
      });
    });
  });

  group('the archive sweep', () {
    Future<void> addDue({
      required String id,
      required List<String> tags,
      required DateTime dueAt,
    }) async {
      await mirror.execute(
        'INSERT INTO channels (channel_id, handle, first_seen_at) '
        'VALUES (?, ?, ?)',
        [id, '@$id', 'T'],
      );
      await mirror.execute(
        'INSERT INTO channel_state (channel_id, handle, channel_tags, '
        'archive_due_at) VALUES (?, ?, ?, ?)',
        [id, '@$id', jsonEncode(tags), iso(dueAt)],
      );
    }

    test('takes what is due, under its strongest tag, and nothing else',
        () async {
      final now = DateTime.utc(2026, 9, 13, 12);
      await addDue(
          id: 'due',
          tags: ['inactive', 'haramStuff'],
          dueAt: now.subtract(const Duration(hours: 1)));
      await addDue(
          id: 'later',
          tags: ['irrelevant'],
          dueAt: now.add(const Duration(days: 3)));
      // A countdown left behind by tags that were since changed back.
      await addDue(
          id: 'stale',
          tags: ['qualified'],
          dueAt: now.subtract(const Duration(days: 1)));
      // Due, but somebody has a thread with them.
      await addDue(
          id: 'contacted',
          tags: ['irrelevant'],
          dueAt: now.subtract(const Duration(days: 1)));
      await mirror.execute(
        "INSERT INTO outreach_threads (id, channel_id) VALUES ('t', 'contacted')",
      );
      for (final v in ['a', 'b', 'c']) {
        await mirror.execute(
          "INSERT INTO videos (video_id, channel_id) VALUES ('due_$v', 'due')",
        );
      }

      expect(await sweepDueArchives(mirror, now: now), 1);

      final left = await mirror
          .getAll('SELECT channel_id FROM channels ORDER BY channel_id');
      expect(left.map((r) => r['channel_id']), ['contacted', 'later', 'stale']);
      final tombstone = await mirror.getAll('SELECT * FROM channel_archive');
      expect(tombstone.single['channel_id'], 'due');
      expect(tombstone.single['label'], 'haramStuff');
      // Frozen on the tombstone: the videos themselves are gone.
      expect(tombstone.single['videos_found_count'], 3);
      expect(await mirror.getAll('SELECT * FROM videos'), isEmpty);
      expect(await kinds(), [
        OutboxKind.rowDeleteMany,
        OutboxKind.archiveChannels,
      ]);
    });

    /// A video row on [id], with an optional view count.
    Future<void> addVideo(String id, String vid, {String? views}) =>
        mirror.execute(
          'INSERT INTO videos (video_id, channel_id, view_count) '
          'VALUES (?, ?, ?)',
          ['${id}_$vid', id, views],
        );

    Future<Map<String, Object?>> tombstoneOf(String id) async {
      final rows = await mirror.getAll(
        'SELECT * FROM channel_archive WHERE channel_id = ?',
        [id],
      );
      return rows.single;
    }

    test('an inactive channel keeps a median over everything it posted',
        () async {
      // The rollup on `channels` covers the trailing 30 days, and an inactive
      // channel has nothing in it — which is the shape of most of this table,
      // and used to freeze as "3 videos, median unknown".
      final now = DateTime.utc(2026, 9, 13, 12);
      await addDue(
          id: 'due',
          tags: ['inactive'],
          dueAt: now.subtract(const Duration(hours: 1)));
      await addVideo('due', 'a', views: '100');
      await addVideo('due', 'b', views: '500');
      await addVideo('due', 'c', views: '300');
      // No view count: not a video with zero views, so it stays out.
      await addVideo('due', 'd');

      expect(await sweepDueArchives(mirror, now: now), 1);

      final row = await tombstoneOf('due');
      expect(row['median_views_last_30'], 300);
      // Labelled, because it is not the figure the influencer list shows.
      expect(row['median_basis'], 'lifetime');
      expect(row['videos_found_count'], 4);
    });

    test('the 30-day rollup is preferred, and says so', () async {
      final now = DateTime.utc(2026, 9, 13, 12);
      await addDue(
          id: 'due',
          tags: ['irrelevant'],
          dueAt: now.subtract(const Duration(hours: 1)));
      await mirror.execute(
        "UPDATE channels SET median_views_last_30 = 4200 WHERE channel_id = 'due'",
      );
      await addVideo('due', 'a', views: '1');

      expect(await sweepDueArchives(mirror, now: now), 1);

      final row = await tombstoneOf('due');
      expect(row['median_views_last_30'], 4200);
      expect(row['median_basis'], 'window30');
    });

    test('a machine without the channel\'s videos records unknown, not zero',
        () async {
      // The sweep runs on every machine's sync tick, including ones that
      // pulled the channel from the catalog and never downloaded its videos.
      // Such a machine has no count to report, and "we looked and there were
      // none" is a finding it is in no position to make.
      final now = DateTime.utc(2026, 9, 13, 12);
      await addDue(
          id: 'due',
          tags: ['irrelevant'],
          dueAt: now.subtract(const Duration(hours: 1)));
      // The stamp came with the catalog row; the object behind it never did.
      await mirror.execute(
        "UPDATE channels SET videos_fetched_at = 'T' WHERE channel_id = 'due'",
      );

      expect(await sweepDueArchives(mirror, now: now), 1);

      final row = await tombstoneOf('due');
      expect(row['videos_found_count'], isNull);
      expect(row['median_views_last_30'], isNull);
    });

    test('a machine that did read the videos records a real zero', () async {
      final now = DateTime.utc(2026, 9, 13, 12);
      await addDue(
          id: 'due',
          tags: ['irrelevant'],
          dueAt: now.subtract(const Duration(hours: 1)));
      // It ran the pass itself and put the object up: nothing to find is a
      // finding, and it is a different one from never having looked.
      await mirror.execute(
        "UPDATE channels SET videos_fetched_at = 'T', blob_uploaded_at = 'T' "
        "WHERE channel_id = 'due'",
      );

      expect(await sweepDueArchives(mirror, now: now), 1);
      expect((await tombstoneOf('due'))['videos_found_count'], 0);
    });

    test('a sweep with nothing to measure cannot blank a tombstone that has it',
        () async {
      // The other half of the same guarantee: the numbers already on a row
      // belong to whichever machine held the videos, and a later write that
      // knows less must not take them away. This used to be an
      // INSERT OR REPLACE.
      final now = DateTime.utc(2026, 9, 13, 12);
      await mirror.execute(
        'INSERT INTO channel_archive (channel_id, handle, label, archived_at, '
        '  source, announced, median_views_last_30, median_basis, '
        '  videos_found_count) '
        "VALUES ('due', '@due', 'irrelevant', 'T', 'remote', 1, 200, "
        "        'window30', 5)",
      );
      await addDue(
          id: 'due',
          tags: ['haramStuff'],
          dueAt: now.subtract(const Duration(hours: 1)));

      expect(await sweepDueArchives(mirror, now: now), 1);

      final row = await tombstoneOf('due');
      // The decision is this write's to state...
      expect(row['label'], 'haramStuff');
      // ...the numbers are not.
      expect(row['median_views_last_30'], 200);
      expect(row['median_basis'], 'window30');
      expect(row['videos_found_count'], 5);
    });

    test('a better count does replace a weaker one, median and all', () async {
      final now = DateTime.utc(2026, 9, 13, 12);
      await mirror.execute(
        'INSERT INTO channel_archive (channel_id, handle, label, archived_at, '
        '  source, announced, median_views_last_30, median_basis, '
        '  videos_found_count) '
        "VALUES ('due', '@due', 'irrelevant', 'T', 'remote', 1, 9, "
        "        'lifetime', 1)",
      );
      await addDue(
          id: 'due',
          tags: ['irrelevant'],
          dueAt: now.subtract(const Duration(hours: 1)));
      await mirror.execute(
        "UPDATE channels SET median_views_last_30 = 500 WHERE channel_id = 'due'",
      );
      for (final v in ['a', 'b', 'c']) {
        await addVideo('due', v, views: '500');
      }

      expect(await sweepDueArchives(mirror, now: now), 1);

      final row = await tombstoneOf('due');
      expect(row['median_views_last_30'], 500);
      // The basis travels with the median it describes.
      expect(row['median_basis'], 'window30');
      expect(row['videos_found_count'], 3);
    });

    test('a second sweep finds nothing to do', () async {
      final now = DateTime.utc(2026, 9, 13, 12);
      await addDue(
          id: 'due',
          tags: ['irrelevant'],
          dueAt: now.subtract(const Duration(hours: 1)));
      expect(await sweepDueArchives(mirror, now: now), 1);
      expect(await sweepDueArchives(mirror, now: now), 0);
    });
  });

  group('conflicts', () {
    late MirrorConflictRepository repo;

    Future<void> add({
      required String id,
      String channelId = 'a',
      String field = 'notes',
      Object? mine = 'Mine.',
      Object? theirs = 'Theirs.',
      DateTime? detectedAt,
      DateTime? resolvedAt,
    }) {
      return mirror.execute(
        'INSERT INTO edit_conflicts (id, channel_id, channel_label, field, '
        'base_value, mine_value, theirs_value, mine_actor_name, detected_at, '
        'resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          channelId,
          'Tech With Taha',
          field,
          jsonEncode('Base.'),
          jsonEncode(mine),
          jsonEncode(theirs),
          'Omar',
          iso(detectedAt ?? DateTime.now().toUtc()),
          resolvedAt == null ? null : iso(resolvedAt),
        ],
      );
    }

    setUp(() {
      repo = MirrorConflictRepository(
        mirror,
        const SyncActor(id: 'user-1', name: 'Sara'),
      );
    });

    test('open and settled conflicts are read from different ends', () async {
      await add(id: 'open_one');
      await add(id: 'settled', resolvedAt: DateTime.now().toUtc());

      expect((await repo.getOpen()).map((c) => c.id), ['open_one']);
      expect((await repo.getResolved()).map((c) => c.id), ['settled']);
    });

    test('a channel filter narrows to that channel', () async {
      await add(id: 'here', channelId: 'a');
      await add(id: 'elsewhere', channelId: 'b');

      expect((await repo.getOpenForChannel('a')).map((c) => c.id), ['here']);
      expect(await repo.getOpenForChannel('c'), isEmpty);
    });

    test('a list value comes back as a list, not as JSON text', () async {
      await add(
        id: 'tags',
        field: 'channel_tags',
        mine: ['qualified'],
        theirs: ['irrelevant'],
      );

      final conflict = (await repo.getOpen()).single;
      expect(conflict.mineValue, ['qualified']);
      expect(conflict.theirsValue, ['irrelevant']);
    });

    test('resolving force-writes locally and queues the server\'s resolve',
        () async {
      await add(id: 'open_one');

      await repo.resolve('open_one', ConflictResolution.merged, 'Merged text.');

      // The chosen value is on the channel now, created if need be.
      final state = await mirror.getAll(
        'SELECT notes, last_edited_by_name FROM channel_state '
        "WHERE channel_id = 'a'",
      );
      expect(state.single['notes'], 'Merged text.');
      expect(state.single['last_edited_by_name'], 'Sara');

      // And the conflict reads as settled, by name.
      final settled = (await repo.getResolved()).single;
      expect(settled.id, 'open_one');
      expect(settled.resolvedByName, 'Sara');
      expect(settled.resolution, ConflictResolution.merged);

      // The one queued entry asks the server's `resolve_edit_conflict` to do
      // the same — the only force-write in the system, and the reason there
      // is no `row.upsert` of the channel here.
      final queued = await mirror.outbox();
      expect(queued.single['kind'], OutboxKind.conflictResolve);
      expect(payloadOf(queued.single), {
        'id': 'open_one',
        'resolution': 'merged',
        'value': 'Merged text.',
      });
    });

    test('a list value is stored as JSON on the channel', () async {
      await add(
          id: 'tags',
          field: 'channel_tags',
          mine: ['qualified'],
          theirs: ['irrelevant']);

      await repo.resolve('tags', ConflictResolution.mine, ['qualified']);

      final state = await mirror.getAll(
          "SELECT channel_tags FROM channel_state WHERE channel_id = 'a'");
      expect(state.single['channel_tags'], '["qualified"]');
    });

    test('resolving an already-settled conflict is a no-op', () async {
      await add(id: 'settled', resolvedAt: DateTime.now().toUtc());
      await repo.resolve('settled', ConflictResolution.theirs, 'x');
      expect(await mirror.outbox(), isEmpty);
    });
  });
}
