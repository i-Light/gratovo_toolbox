import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/edit_conflict.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/data/models/media_kit.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';

import 'memory_mirror.dart';

/// What `MirrorInfluencerRepository` does is translate the `influencer_rows`
/// view into SQLite and run the compare-and-set locally. Both halves are things
/// that fail silently rather than loudly — a rollup that quietly counts the
/// wrong videos still renders a number, and a CAS that quietly writes anyway
/// still looks like a successful save.
///
/// So these run against a real SQLite engine (see [MemoryMirror]) rather than a
/// stub. Everything asserted here is either a column the view computes or a
/// branch of the decision table in `backend/schema.sql`.
void main() {
  late MemoryMirror mirror;
  late MirrorInfluencerRepository repo;

  String iso(DateTime value) => value.toUtc().toIso8601String();
  DateTime daysAgo(int days) =>
      DateTime.now().toUtc().subtract(Duration(days: days));

  /// A channel is two rows in two tables owned by two programs: the
  /// pipeline's scraped facts (`channels`, rollups included — computed by the
  /// pipeline after each scrape) and the app's typed-in state
  /// (`channel_state`). The repository reads them through the
  /// `influencer_channels` view, so both are seeded here the way a synced
  /// machine would hold them.
  Future<void> addChannel({
    required String id,
    String? handle,
    String? name,
    int? subscribers,
    String? country,
    List<String> tags = const ['undecided'],
    String? notes,
    String pipelineStage = 'new',
    String vettingStatus = 'newlyFound',
    DateTime? lastDealAt,
    DateTime? firstSeenAt,
    String? lastEditedByName,
    List<Map<String, dynamic>>? contacts,
    int? videosLast30,
    int? avgViewsLast30,
    DateTime? latestUploadAt,
  }) async {
    await mirror.execute(
      'INSERT INTO channels (channel_id, handle, name, subscribers, country, '
      'first_seen_at, videos_last_30, median_views_last_30, latest_upload_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        handle ?? '@$id',
        name,
        subscribers?.toString(),
        country,
        iso(firstSeenAt ?? daysAgo(100)),
        videosLast30 ?? 0,
        avgViewsLast30,
        latestUploadAt == null ? null : iso(latestUploadAt),
      ],
    );
    await mirror.execute(
      'INSERT INTO channel_state (channel_id, handle, channel_tags, notes, '
      'pipeline_stage, vetting_status, last_deal_at, last_edited_by_name, '
      'contacts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        handle ?? '@$id',
        jsonEncode(tags),
        notes,
        pipelineStage,
        vettingStatus,
        lastDealAt == null ? null : iso(lastDealAt),
        lastEditedByName,
        contacts == null ? null : jsonEncode(contacts),
      ],
    );
  }

  Future<void> addVideo({
    required String id,
    required String channelId,
    required DateTime publishedAt,
    int? viewCount,
  }) {
    return mirror.execute(
      'INSERT INTO videos (video_id, channel_id, title, published_at, '
      'view_count) VALUES (?, ?, ?, ?, ?)',
      [id, channelId, 'Video $id', iso(publishedAt), viewCount?.toString()],
    );
  }

  setUp(() {
    mirror = MemoryMirror();
    repo = MirrorInfluencerRepository(
      mirror,
      actor: const SyncActor(id: 'user_omar', name: 'Omar'),
    );
  });

  tearDown(() => mirror.close());

  group('the local translation of influencer_rows', () {
    test('reads the 30-day rollups as synced, without touching videos',
        () async {
      // These three used to be computed here, by a grouped subquery over the
      // whole local `videos` table. That was the server's own mistake copied
      // onto the UI isolate — see the note on `_rowSelect` — and it is why
      // this test now seeds columns rather than videos.
      // Held rather than called twice: `daysAgo` reads the clock, so the
      // seeded value and the expected value would differ by the microseconds
      // between the two calls.
      final latestUpload = daysAgo(2);
      await addChannel(
        id: 'a',
        videosLast30: 2,
        avgViewsLast30: 150,
        latestUploadAt: latestUpload,
      );
      // Videos the rollups deliberately disagree with. If the mirror were
      // still aggregating locally, these would win and the assertions below
      // would not hold.
      await addVideo(
          id: 'v1', channelId: 'a', publishedAt: daysAgo(1), viewCount: 9000);
      await addVideo(
          id: 'v2', channelId: 'a', publishedAt: daysAgo(3), viewCount: 9000);
      await addVideo(
          id: 'v3', channelId: 'a', publishedAt: daysAgo(4), viewCount: 9000);

      final channel = await repo.getById('a');
      expect(channel!.videosLast30, 2);
      expect(channel.medianViewsLast30, 150);
      // `.toUtc()` because the mirror stores ISO-8601 with a `Z` and Dart
      // parses that back into local time — the same instant, a different
      // `DateTime`.
      expect(channel.lastVideoAt!.toUtc(), latestUpload.toUtc());
    });

    test('a channel with no rollups yet reports zero, not null', () async {
      // Also the shape of a channel replicated before the first server sweep
      // reached it: `videos_last_30` empty rather than 0. Zero uploads and an
      // unknown average are different answers, and only the count coalesces —
      // the same distinction the view keeps server-side, where
      // `videos_last_30` is NOT NULL and the other two are not.
      await addChannel(id: 'a');
      final channel = await repo.getById('a');
      expect(channel!.videosLast30, 0);
      expect(channel.medianViewsLast30, isNull);
      expect(channel.lastVideoAt, isNull);
    });

    test('days since last deal is null when there has never been one',
        () async {
      await addChannel(id: 'a');
      await addChannel(id: 'b', lastDealAt: daysAgo(45));

      expect((await repo.getById('a'))!.daysSinceLastDeal, isNull);
      expect((await repo.getById('b'))!.daysSinceLastDeal, 45);
    });

    test('counting a vetting status asks the database, not the list', () async {
      // The Dashboard's "new finds" tile. It used to be
      // `getAll().where(...).length`, which on the real database means every
      // channel over the wire to render one integer; here it is a COUNT(*)
      // that returns no rows at all.
      await addChannel(id: 'a');
      await addChannel(id: 'b');
      await addChannel(id: 'c', vettingStatus: 'shortlisted');
      await addChannel(id: 'd', vettingStatus: 'rejected');

      expect(await repo.countByVettingStatus(VettingStatus.newlyFound), 2);
      expect(await repo.countByVettingStatus(VettingStatus.shortlisted), 1);
      expect(await repo.countByVettingStatus(VettingStatus.rejected), 1);
    });

    test('contact attempts are counted from the local outreach tables',
        () async {
      await addChannel(id: 'a');
      await addChannel(id: 'b');
      await mirror.execute(
        "INSERT INTO outreach_threads (id, channel_id) VALUES ('t', 'a')",
      );
      for (final (id, direction) in [
        ('m1', 'outbound'),
        ('m2', 'outbound'),
        ('m3', 'inbound'),
      ]) {
        await mirror.execute(
          'INSERT INTO outreach_messages (id, thread_id, direction) '
          "VALUES (?, 't', ?)",
          [id, direction],
        );
      }

      // Outbound only: a reply is not an attempt.
      expect((await repo.getById('a'))!.contactAttempts, 2);
      expect((await repo.getById('b'))!.contactAttempts, 0);
    });

    test('source keywords are attached from the join table', () async {
      await addChannel(id: 'a');
      await mirror.execute(
        'INSERT INTO channel_keywords (channel_id, keyword, discovered_at) '
        "VALUES ('a', 'gaming', 'T'), ('a', 'setup', 'T')",
      );

      final channel = await repo.getById('a');
      expect(channel!.sourceKeywords, containsAll(<String>['gaming', 'setup']));
    });

    test('contacts survive the round trip through JSON text', () async {
      await addChannel(id: 'a', contacts: [
        {'method': 'email', 'value': 'hi@example.com', 'isPrimary': true},
      ]);

      final channel = await repo.getById('a');
      expect(channel!.contacts, hasLength(1));
      expect(channel.contacts.first.value, 'hi@example.com');
    });
  });

  group('the 1.4 channel facts', () {
    test('sponsorship, found emails, media kit and the creator flag are read',
        () async {
      await addChannel(id: 'a');
      await mirror.execute(
        'UPDATE channels SET sponsored_ratio = 0.4, seen_brands = ?, '
        'found_emails = ? WHERE channel_id = ?',
        ['["NordVPN"]', '["biz@a.io"]', 'a'],
      );
      await mirror.execute(
        'UPDATE channel_state SET media_kit = ?, creator_gender = ? '
        'WHERE channel_id = ?',
        [
          '{"countries":[{"code":"US","pct":41}],"ageBand":"18-34"}',
          'male',
          'a',
        ],
      );

      final channel = (await repo.getById('a'))!;
      expect(channel.sponsoredRatio, 0.4);
      expect(channel.seenBrands, ['NordVPN']);
      expect(channel.foundEmails, ['biz@a.io']);
      expect(channel.mediaKit!.countries.single.code, 'US');
      expect(channel.mediaKit!.ageBand, '18-34');
      expect(channel.creatorGender, CreatorGender.male);
    });

    test('the media kit and the creator flag are edited compare-and-set',
        () async {
      await addChannel(id: 'a');
      const kit = MediaKit(
        countries: [AudienceShare(code: 'US', pct: 41)],
        ageBand: '18-34',
        rates: [RateCardRow(format: 'integration', price: 900, agreed: true)],
      );

      expect(
          await repo.updateMediaKit('a', kit, base: null), EditOutcome.applied);
      expect(
          await repo.updateCreatorGender('a', CreatorGender.male, base: null),
          EditOutcome.applied);

      final channel = (await repo.getById('a'))!;
      expect(channel.mediaKit, kit);
      expect(channel.creatorGender, CreatorGender.male);
      // A second editor working from the old, empty kit is refused.
      expect(
          await repo.updateMediaKit('a', const MediaKit(ageBand: '25-44'),
              base: null),
          EditOutcome.conflict);
      final queued = await mirror
          .getAll("SELECT payload FROM _outbox WHERE kind = 'channel.edit'");
      expect(queued.map((r) => r['payload'] as String).join(),
          allOf(contains('media_kit'), contains('creator_gender')));
    });

    test('sponsor sightings come from every channel with seen brands',
        () async {
      await addChannel(id: 'a', handle: '@a', latestUploadAt: daysAgo(3));
      await addChannel(id: 'b');
      await addChannel(id: 'c');
      await mirror.execute(
          "UPDATE channels SET seen_brands = '[\"Brilliant\",\"Notion\"]' WHERE channel_id = 'a'");
      await mirror.execute(
          "UPDATE channels SET seen_brands = '[]' WHERE channel_id = 'b'");

      final sightings = await repo.sponsorSightings();

      expect(sightings, hasLength(1));
      expect(sightings.single.channelId, 'a');
      expect(sightings.single.handle, '@a');
      expect(sightings.single.brands, ['Brilliant', 'Notion']);
      expect(sightings.single.latestUploadAt, isNotNull);
    });

    test('a channel the pipeline has not derived yet reads as empty', () async {
      await addChannel(id: 'b');

      final channel = (await repo.getById('b'))!;
      expect(channel.sponsoredRatio, isNull);
      expect(channel.foundEmails, isEmpty);
      expect(channel.mediaKit, isNull);
      expect(channel.creatorGender, isNull);
    });
  });

  group('filtering and sorting', () {
    test(
        'the quick filters: email, sponsored, shortlisted, ready to pitch, '
        'never contacted', () async {
      await addChannel(id: 'plain');
      await addChannel(id: 'contacted');
      await mirror.execute(
          "INSERT INTO outreach_threads (id, channel_id) VALUES ('tc', 'contacted')");
      await mirror.execute(
          "INSERT INTO outreach_messages (id, thread_id, direction) VALUES ('mc', 'tc', 'outbound')");
      await addChannel(id: 'emailed', contacts: [
        {'method': 'email', 'value': 'a@b.io'},
      ]);
      await addChannel(id: 'found');
      await addChannel(id: 'sponsored');
      await addChannel(id: 'short', vettingStatus: 'shortlisted');
      await addChannel(id: 'ready');
      await addChannel(id: 'readyButFemale');
      await mirror.execute(
          "UPDATE channels SET found_emails = '[\"x@y.io\"]' WHERE channel_id = 'found'");
      await mirror.execute(
          "UPDATE channels SET sponsored_ratio = 0.2 WHERE channel_id = 'sponsored'");
      const kit = '{"countries":[{"code":"US","pct":18},{"code":"GB","pct":6}],'
          '"ageBand":"18-34","rates":[{"format":"integration","price":900,'
          '"agreed":true}]}';
      await mirror.execute(
          "UPDATE channel_state SET media_kit = ? WHERE channel_id IN ('ready', 'readyButFemale')",
          [kit]);
      await mirror.execute(
          "UPDATE channel_state SET creator_gender = 'female' WHERE channel_id = 'readyButFemale'");

      Future<List<String>> only(InfluencerFlag flag) async {
        final page = await repo.getPage(
            offset: 0, limit: 50, query: InfluencerQuery(requireFlags: {flag}));
        return [for (final i in page.items) i.id]..sort();
      }

      expect(await only(InfluencerFlag.hasEmail), ['emailed', 'found']);
      expect(await only(InfluencerFlag.sponsored), ['sponsored']);
      expect(await only(InfluencerFlag.shortlisted), ['short']);
      expect(await only(InfluencerFlag.readyToPitch), ['ready']);
      expect(await only(InfluencerFlag.neverContacted), [
        'emailed',
        'found',
        'plain',
        'ready',
        'readyButFemale',
        'short',
        'sponsored',
      ]);
      // Same answers from the mock, which filters in Dart.
      final all = await repo.getAll();
      final mock = MockInfluencerRepository()..replaceAllForTesting(all);
      for (final flag in InfluencerFlag.values) {
        final page = await mock.getPage(
            offset: 0, limit: 50, query: InfluencerQuery(requireFlags: {flag}));
        expect([for (final i in page.items) i.id]..sort(), await only(flag),
            reason: flag.name);
      }
    });

    test('nulls sort last under BOTH directions', () async {
      // SQLite's own default puts nulls first ascending, which would float
      // every channel with no uploads this month to the top of the list the
      // moment somebody sorted by average views.
      await addChannel(id: 'has');
      await addChannel(id: 'none');
      await addVideo(
          id: 'v1', channelId: 'has', publishedAt: daysAgo(1), viewCount: 500);

      for (final descending in [true, false]) {
        final page = await repo.getPage(
          offset: 0,
          limit: 10,
          query: InfluencerQuery(
            sortBy: InfluencerSortBy.medianViews,
            descending: descending,
          ),
        );
        expect(
          page.items.map((i) => i.id).toList(),
          ['has', 'none'],
          reason: 'descending: $descending',
        );
      }
    });

    test('a tag filter includes and excludes, and tolerates no tags at all',
        () async {
      await addChannel(id: 'haram', tags: ['haramStuff']);
      await addChannel(id: 'fine', tags: ['qualified']);
      // A channel nobody has touched has no state row at all; the view's
      // COALESCE is what keeps `json_each` off a NULL.
      await mirror.execute(
        'INSERT INTO channels (channel_id, handle, first_seen_at) '
        "VALUES ('bare', '@bare', ?)",
        [iso(daysAgo(1))],
      );

      final included = await repo.getPage(
        offset: 0,
        limit: 10,
        query: const InfluencerQuery(
          includeChannelTags: {ChannelTag.haramStuff},
        ),
      );
      expect(included.items.map((i) => i.id), ['haram']);

      final excluded = await repo.getPage(
        offset: 0,
        limit: 10,
        query: const InfluencerQuery(
          excludeChannelTags: {ChannelTag.haramStuff},
        ),
      );
      expect(excluded.items.map((i) => i.id), containsAll(['fine', 'bare']));
      expect(excluded.items.map((i) => i.id), isNot(contains('haram')));
    });

    test('search matches name or handle, case-insensitively', () async {
      await addChannel(id: 'a', name: 'Tech With Taha', handle: '@techtaha');
      await addChannel(id: 'b', name: 'Cooking Corner', handle: '@cooking');

      final byName = await repo.getPage(
        offset: 0,
        limit: 10,
        query: const InfluencerQuery(search: 'TAHA'),
      );
      expect(byName.items.map((i) => i.id), ['a']);

      final byHandle = await repo.getPage(
        offset: 0,
        limit: 10,
        query: const InfluencerQuery(search: 'cook'),
      );
      expect(byHandle.items.map((i) => i.id), ['b']);
    });

    test('descriptions are searched only where asked, and any match counts',
        () async {
      await addChannel(id: 'about', name: 'Omar Plays');
      await mirror.execute(
        "UPDATE channels SET description = 'Weekly KITCHEN gadget reviews' "
        "WHERE channel_id = 'about'",
      );
      await addChannel(id: 'videos', name: 'Daily Vlogs');
      await addVideo(id: 'v1', channelId: 'videos', publishedAt: daysAgo(3));
      await mirror.execute(
        "UPDATE videos SET description = 'Sponsored by a kitchen brand' "
        "WHERE video_id = 'v1'",
      );
      await addChannel(id: 'named', name: 'Kitchen Stories');

      Future<List<String>> find(Set<InfluencerSearchScope> scopes) async {
        final page = await repo.getPage(
          offset: 0,
          limit: 10,
          query: InfluencerQuery(search: 'kitchen', searchIn: scopes),
        );
        return [for (final i in page.items) i.id]..sort();
      }

      expect(await find(const {InfluencerSearchScope.names}), ['named'],
          reason: 'the default still means names only');
      expect(await find(const {InfluencerSearchScope.channelDescriptions}),
          ['about']);
      expect(await find(const {InfluencerSearchScope.videoDescriptions}),
          ['videos']);
      expect(
        await find(InfluencerSearchScope.values.toSet()),
        ['about', 'named', 'videos'],
      );
      expect(await find(const {}), ['named'],
          reason: 'searching nowhere is read as names');
    });

    test('a wildcard typed into the search box is a character, not a wildcard',
        () async {
      await addChannel(id: 'a', name: 'Fifty Percent');
      await addChannel(id: 'b', name: 'Something Else');

      // Stripped, not escaped, so this degrades to a blank search rather than
      // matching everything. Either behaviour is defensible; matching
      // everything silently is not, which is what an unescaped `%` would do.
      final page = await repo.getPage(
        offset: 0,
        limit: 10,
        query: const InfluencerQuery(search: '%'),
      );
      expect(page.items, hasLength(2));
    });

    test('a days-since-last-deal bound excludes channels that never had one',
        () async {
      await addChannel(id: 'stale', lastDealAt: daysAgo(120));
      await addChannel(id: 'recent', lastDealAt: daysAgo(5));
      await addChannel(id: 'never');

      final page = await repo.getPage(
        offset: 0,
        limit: 10,
        query: const InfluencerQuery(minDaysSinceLastDeal: 90),
      );
      expect(page.items.map((i) => i.id), ['stale']);
    });

    test('paging is stable when the sort key ties', () async {
      // Without the channel_id tie-break, two channels with the same
      // subscriber count can swap places between page requests — showing one
      // twice and hiding the other entirely.
      for (final id in ['c', 'a', 'b', 'd']) {
        await addChannel(id: id, subscribers: 1000);
      }

      final first = await repo.getPage(offset: 0, limit: 2);
      final second = await repo.getPage(offset: 2, limit: 2);

      expect(first.items.map((i) => i.id), ['a', 'b']);
      expect(first.hasMore, isTrue);
      expect(second.items.map((i) => i.id), ['c', 'd']);
      expect(second.hasMore, isTrue,
          reason: 'a full page cannot prove the end');

      final third = await repo.getPage(offset: 4, limit: 2);
      expect(third.items, isEmpty);
      expect(third.hasMore, isFalse);
    });

    test('countries come back distinct, upper-cased and sorted', () async {
      await addChannel(id: 'a', country: 'eg');
      await addChannel(id: 'b', country: 'EG');
      await addChannel(id: 'c', country: 'us');
      await addChannel(id: 'd');

      expect(await repo.getCountries(), ['EG', 'US']);
    });
  });

  group('the compare-and-set, decided locally', () {
    test('an edit on top of what is there applies', () async {
      await addChannel(id: 'a', notes: 'First line.');

      final outcome = await repo.updateNotes(
        'a',
        'First line. Second line.',
        base: 'First line.',
      );

      expect(outcome, EditOutcome.applied);
      expect((await repo.getById('a'))!.notes, 'First line. Second line.');
    });

    test('sequential collaboration never conflicts', () async {
      await addChannel(id: 'a', notes: null);

      var text = '';
      for (var round = 0; round < 10; round++) {
        final next = '$text round $round.';
        final outcome = await repo.updateNotes('a', next, base: text);
        expect(outcome, EditOutcome.applied, reason: 'round $round');
        text = next;
      }
      expect((await repo.getById('a'))!.notes, text);
    });

    test('a stale base is refused and the refused text is NOT written',
        () async {
      await addChannel(id: 'a', notes: 'Base.', name: 'Tech With Taha');

      await repo.updateNotes('a', 'Base. Sara added this.', base: 'Base.');
      final outcome = await repo.updateNotes(
        'a',
        'Base. Omar added this.',
        base: 'Base.',
      );

      expect(outcome, EditOutcome.conflict);
      expect(
        (await repo.getById('a'))!.notes,
        'Base. Sara added this.',
        reason: 'the column must be left exactly as it was',
      );
    });

    test('a refused edit is filed where somebody can see it', () async {
      await addChannel(
          id: 'a',
          notes: 'Base.',
          name: 'Tech With Taha',
          lastEditedByName: 'Sara');
      await repo.updateNotes('a', 'Base. Theirs.', base: 'Base.');
      await repo.updateNotes('a', 'Base. Mine.', base: 'Base.');

      final rows = await mirror.getAll('SELECT * FROM edit_conflicts');
      expect(rows, hasLength(1));
      final row = rows.first;
      expect(row['channel_id'], 'a');
      expect(row['field'], 'notes');
      expect(row['channel_label'], 'Tech With Taha');
      expect(row['mine_actor_name'], 'Omar');
      // The refused text lives here and nowhere else — the database refused it,
      // so this record is the only copy.
      expect(jsonDecode(row['mine_value']! as String), 'Base. Mine.');
      expect(jsonDecode(row['theirs_value']! as String), 'Base. Theirs.');
      expect(jsonDecode(row['base_value']! as String), 'Base.');
    });

    test('re-saving against the same stale base updates one row, not many',
        () async {
      await addChannel(id: 'a', notes: 'Base.');
      await repo.updateNotes('a', 'Base. Theirs.', base: 'Base.');

      await repo.updateNotes('a', 'Base. Mine, take one.', base: 'Base.');
      await repo.updateNotes('a', 'Base. Mine, take two.', base: 'Base.');

      final rows = await mirror.getAll('SELECT * FROM edit_conflicts');
      expect(rows, hasLength(1));
      expect(
        jsonDecode(rows.single['mine_value']! as String),
        'Base. Mine, take two.',
      );
      expect(
        jsonDecode(rows.single['base_value']! as String),
        'Base.',
        reason: 'the base stays where the two versions actually diverged',
      );
    });

    test('agreeing with what is already there is not a disagreement', () async {
      await addChannel(id: 'a', notes: 'Base.');
      await repo.updateNotes('a', 'Same conclusion.', base: 'Base.');

      final outcome =
          await repo.updateNotes('a', 'Same conclusion.', base: 'Base.');

      expect(outcome, EditOutcome.auto);
      expect(await mirror.getAll('SELECT * FROM edit_conflicts'), isEmpty);
    });

    test('a save with no edit in it is a noop, even against a stale base',
        () async {
      await addChannel(id: 'a', notes: 'Base.');
      await repo.updateNotes('a', 'Somebody else.', base: 'Base.');

      final outcome = await repo.updateNotes('a', 'Base.', base: 'Base.');

      expect(outcome, EditOutcome.noop);
      expect(await mirror.getAll('SELECT * FROM edit_conflicts'), isEmpty);
    });

    test('null and the empty string are the same fact', () async {
      await addChannel(id: 'a', notes: null);
      expect(await repo.updateNotes('a', '', base: null), EditOutcome.noop);
    });

    test('editing a channel that is not here is missing, not a conflict',
        () async {
      expect(
        await repo.updateNotes('nobody', 'text', base: null),
        EditOutcome.missing,
      );
    });

    test('a reordered tag list is not a change', () async {
      await addChannel(id: 'a', tags: ['undecided', 'qualified']);

      final outcome = await repo.updateChannelTags(
        'a',
        [ChannelTag.qualified, ChannelTag.undecided],
        base: [ChannelTag.undecided, ChannelTag.qualified],
      );

      expect(outcome, EditOutcome.noop);
    });

    test('a reordered contact list IS a change', () async {
      // Deliberately asymmetric with tags: the first contact is the one the app
      // reaches for, so "make primary" reorders on purpose.
      const email = InfluencerContact(
        method: ContactMethod.email,
        value: 'a@example.com',
      );
      const whatsapp = InfluencerContact(
        method: ContactMethod.whatsapp,
        value: '+201234567890',
      );
      await addChannel(id: 'a', contacts: [
        email.toJson(),
        whatsapp.toJson(),
      ]);

      final outcome = await repo.updateContacts(
        'a',
        [whatsapp, email],
        base: [email, whatsapp],
      );

      expect(outcome, EditOutcome.applied);
      expect((await repo.getById('a'))!.contacts.first.value, '+201234567890');
    });

    test('the check is per field, not per row', () async {
      // A row-level token would make a colleague's stage change invalidate a
      // pending notes edit — the false conflict this design exists to avoid.
      await addChannel(id: 'a', notes: 'Base.', pipelineStage: 'new');

      await repo.updatePipelineStage(
        'a',
        PipelineStage.contacted,
        base: PipelineStage.isNew,
      );

      expect(
        await repo.updateNotes('a', 'Base. Mine.', base: 'Base.'),
        EditOutcome.applied,
      );
    });
  });

  group('tags and the archive countdown', () {
    test('tagging a channel rejected starts the 7 days', () async {
      await addChannel(id: 'a', tags: ['undecided']);

      await repo.updateChannelTags(
        'a',
        [ChannelTag.irrelevant],
        base: [ChannelTag.undecided],
      );

      final channel = await repo.getById('a');
      expect(channel!.isPendingArchive, isTrue);
      expect(
        channel.archiveDueAt!.difference(DateTime.now().toUtc()).inDays,
        inInclusiveRange(5, 7),
      );
    });

    test('re-tagging a channel already counting down does not restart it',
        () async {
      // Otherwise editing tags would postpone an archive indefinitely, which is
      // a way to keep a rejected channel forever by accident.
      await addChannel(id: 'a', tags: ['undecided']);
      await repo.updateChannelTags('a', [ChannelTag.irrelevant],
          base: [ChannelTag.undecided]);
      final first = (await repo.getById('a'))!.archiveDueAt;

      await repo.updateChannelTags(
        'a',
        [ChannelTag.irrelevant, ChannelTag.haramStuff],
        base: [ChannelTag.irrelevant],
      );

      expect((await repo.getById('a'))!.archiveDueAt, first);
    });

    test('taking the rejecting tag off cancels the countdown', () async {
      await addChannel(id: 'a', tags: ['undecided']);
      await repo.updateChannelTags('a', [ChannelTag.irrelevant],
          base: [ChannelTag.undecided]);
      expect((await repo.getById('a'))!.isPendingArchive, isTrue);

      await repo.updateChannelTags('a', [ChannelTag.qualified],
          base: [ChannelTag.irrelevant]);

      expect((await repo.getById('a'))!.isPendingArchive, isFalse);
    });

    test('a refused tag edit leaves the countdown alone', () async {
      await addChannel(id: 'a', tags: ['undecided']);
      await repo.updateChannelTags('a', [ChannelTag.qualified],
          base: [ChannelTag.undecided]);

      final outcome = await repo.updateChannelTags(
        'a',
        [ChannelTag.irrelevant],
        base: [ChannelTag.undecided],
      );

      expect(outcome, EditOutcome.conflict);
      expect(
        (await repo.getById('a'))!.isPendingArchive,
        isFalse,
        reason: 'a deletion must not be scheduled for a decision nobody made',
      );
    });

    test('archiveNow archives at once, under the tag it carries', () async {
      // The sweep is this machine's now, not a nightly job's: a person who
      // confirmed a permanent delete sees the channel go. The tombstone
      // carries the label the tags said.
      await addChannel(id: 'a', tags: ['irrelevant'], subscribers: 900);

      await repo.archiveNow('a');

      expect(await repo.getById('a'), isNull);
      final tombstone = await mirror.getAll(
        'SELECT label, subscribers FROM channel_archive WHERE channel_id = ?',
        ['a'],
      );
      expect(tombstone.single['label'], 'irrelevant');
      expect(tombstone.single['subscribers'], '900');
    });
  });

  group('adding a channel by hand', () {
    test('is readable immediately, before anything has uploaded', () async {
      final id = await repo.create(const NewInfluencer(
        handle: 'newchannel',
        name: 'New Channel',
        country: 'EG',
        subscriberCount: 4200,
      ));

      expect(id, 'manual:@newchannel');
      final channel = await repo.getById(id);
      expect(channel!.handle, '@newchannel');
      expect(channel.name, 'New Channel');
      expect(channel.subscriberCount, 4200);
      expect(channel.channelUrl, 'https://www.youtube.com/@newchannel');
      expect(channel.pipelineStage, PipelineStage.isNew);
    });

    test('keeps a real YouTube id when one is supplied', () async {
      final id = await repo.create(const NewInfluencer(
        handle: '@known',
        channelId: 'UCabc123',
      ));
      expect(id, 'UCabc123');
      expect((await repo.getById('UCabc123'))!.handle, '@known');
    });
  });
}
