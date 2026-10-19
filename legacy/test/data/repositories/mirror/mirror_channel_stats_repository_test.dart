import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/channel_stats.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_channel_stats_repository.dart';

import 'memory_mirror.dart';

/// `MirrorChannelStatsRepository` is a second definition of every number on the
/// Dashboard's analytics section — the first being `channel_stats` in
/// `backend/schema.sql`. Two definitions can disagree, and this is the file
/// where that has to be caught, because nothing else will: a breakdown that
/// counts the wrong rows still draws a chart, and a chart that is wrong by 3%
/// looks exactly like a chart that is right.
///
/// So these run the real SQL against a real SQLite engine (see [MemoryMirror]),
/// and every assertion below is a rule the SQL function states in its own
/// comments: what counts as missing, which histograms sum to what, and which
/// buckets survive being empty.
void main() {
  late MemoryMirror mirror;
  late MirrorChannelStatsRepository repo;

  String iso(DateTime value) => value.toUtc().toIso8601String();

  /// A channel is two rows: the pipeline's scraped facts and the app's
  /// typed-in state. The repository reads them through the
  /// `influencer_channels` view, so both are seeded here.
  Future<void> addChannel({
    required String id,
    int? subscribers,
    String? country,
    List<String> tags = const [],
    String pipelineStage = 'new',
    String vettingStatus = 'newlyFound',
    int? videosLast30,
    int? medianViewsLast30,
    DateTime? firstSeenAt,
    DateTime? lastDealAt,
    DateTime? archiveDueAt,
  }) async {
    await mirror.execute(
      'INSERT INTO channels (channel_id, handle, subscribers, country, '
      'videos_last_30, median_views_last_30, first_seen_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        '@$id',
        subscribers?.toString(),
        country,
        videosLast30 ?? 0,
        medianViewsLast30,
        iso(firstSeenAt ?? DateTime.now()),
      ],
    );
    await mirror.execute(
      'INSERT INTO channel_state (channel_id, handle, channel_tags, '
      'pipeline_stage, vetting_status, last_deal_at, archive_due_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        '@$id',
        jsonEncode(tags),
        pipelineStage,
        vettingStatus,
        lastDealAt == null ? null : iso(lastDealAt),
        archiveDueAt == null ? null : iso(archiveDueAt),
      ],
    );
  }

  Future<void> addArchived({
    required String id,
    int? subscribers,
    int? medianViews,
    String label = 'irrelevant',
    DateTime? foundAt,
  }) {
    return mirror.execute(
      'INSERT INTO channel_archive (channel_id, handle, subscribers, '
      'median_views_last_30, label, found_at, archived_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        '@$id',
        subscribers?.toString(),
        medianViews,
        label,
        foundAt == null ? null : iso(foundAt),
        iso(DateTime.now()),
      ],
    );
  }

  int countIn(List<StatBucket> buckets, String key) => buckets
      .firstWhere((b) => b.key == key,
          orElse: () => const StatBucket(key: '', count: -1))
      .count;

  int archivedIn(List<StatBucket> buckets, String key) => buckets
      .firstWhere((b) => b.key == key,
          orElse: () => const StatBucket(key: '', count: 0))
      .archived;

  int archiveDueIn(List<StatBucket> buckets, String key) => buckets
      .firstWhere((b) => b.key == key,
          orElse: () => const StatBucket(key: '', count: 0))
      .archiveDue;

  setUp(() {
    mirror = MemoryMirror();
    repo = MirrorChannelStatsRepository(mirror);
  });

  tearDown(() => mirror.close());

  test('an empty mirror reports zeroes rather than failing', () async {
    final stats = await repo.load(const ChannelStatsQuery());

    expect(stats.channels, 0);
    expect(stats.meanSubscribers, isNull);
    expect(stats.medianSubscribers, isNull);
    // The fixed histograms keep their bars even with nothing in them — an empty
    // tier is drawn at zero, which is the rule [ChannelStats.byTier] states.
    expect(stats.byTier.map((b) => b.key), hasLength(6));
    expect(stats.byTier.every((b) => b.count == 0), isTrue);
    expect(stats.byMonth, hasLength(12));
    expect(stats.byCountry, isEmpty);
  });

  test('a hidden subscriber count is missing, not zero', () async {
    await addChannel(id: 'a', subscribers: 1000);
    await addChannel(id: 'b', subscribers: 3000);
    // YouTube hides this one's count.
    await addChannel(id: 'c');

    final stats = await repo.load(const ChannelStatsQuery());

    expect(stats.channels, 3);
    expect(stats.withSubscribers, 2);
    expect(stats.totalSubscribers, 4000);
    // Averaged over the two that have a count, not over all three — averaging
    // in the unmeasured one as a zero would report 1333.
    expect(stats.meanSubscribers, 2000);
    // The unmeasured channel is in no subscriber tier either.
    expect(stats.byTier.fold<int>(0, (sum, b) => sum + b.count), 2);
  });

  test('the median is the middle value, and interpolates on an even count',
      () async {
    await addChannel(id: 'a', subscribers: 100);
    await addChannel(id: 'b', subscribers: 200);
    await addChannel(id: 'c', subscribers: 900);

    expect((await repo.load(const ChannelStatsQuery())).medianSubscribers, 200);

    // Four values: percentile_cont(0.5) is the mean of the two in the middle,
    // and so is this.
    await addChannel(id: 'd', subscribers: 300);
    expect((await repo.load(const ChannelStatsQuery())).medianSubscribers, 250);
  });

  test('subscriber tiers cut at the same boundaries as the SQL function',
      () async {
    await addChannel(id: 'a', subscribers: 9999);
    await addChannel(id: 'b', subscribers: 10000);
    await addChannel(id: 'c', subscribers: 49999);
    await addChannel(id: 'd', subscribers: 50000);
    await addChannel(id: 'e', subscribers: 5000000);

    final tiers = (await repo.load(const ChannelStatsQuery())).byTier;

    expect(countIn(tiers, '<10K'), 1);
    expect(countIn(tiers, '10K-50K'), 2);
    expect(countIn(tiers, '50K-100K'), 1);
    expect(countIn(tiers, '100K-500K'), 0);
    expect(countIn(tiers, '1M+'), 1);
    // Order is fixed and ascending, not sorted by count.
    expect(tiers.first.key, '<10K');
    expect(tiers.last.key, '1M+');
  });

  test('view tiers count an unmeasured channel as zero, under <10K', () async {
    await addChannel(id: 'a', subscribers: 5000, medianViewsLast30: 500);
    await addChannel(id: 'b', subscribers: 5000, medianViewsLast30: 20000);
    await addChannel(id: 'c', subscribers: 5000);
    await addArchived(id: 'x', subscribers: 3000, label: 'irrelevant');

    final stats = await repo.load(const ChannelStatsQuery());

    // The headline average and the "measured" count are still over the
    // channels that were measured...
    expect(stats.withMedianViews, 2);
    expect(stats.medianViews, 10250);
    expect(stats.archivedWithMedianViews, 0);
    // ...but the histogram sums to every channel: with the auto-clean rule on,
    // "no median" is a channel archived or tagged before its videos were
    // fetched for being too small, and that IS the bottom of the distribution.
    expect(stats.byViewTier.fold<int>(0, (sum, b) => sum + b.count), 3);
    expect(countIn(stats.byViewTier, '<10K'), 2);
    expect(countIn(stats.byViewTier, '10K-50K'), 1);
    // The archive's never-fetched tombstone follows the same rule.
    expect(archivedIn(stats.byViewTier, '<10K'), 1);
  });

  test('a median-views bound selects the rows the bar counts', () async {
    await addChannel(id: 'a', subscribers: 5000, medianViewsLast30: 500);
    await addChannel(id: 'b', subscribers: 5000, medianViewsLast30: 20000);
    await addChannel(id: 'c', subscribers: 5000);

    // "At most 9,999" is the <10K bar: the measured 500 and the unmeasured
    // one bounded as zero.
    final under =
        await repo.load(const ChannelStatsQuery(maxMedianViews: 9999));
    expect(under.channels, 2);
    // A floor of zero excludes nothing, the same as no floor.
    final floor = await repo.load(const ChannelStatsQuery(minMedianViews: 0));
    expect(floor.channels, 3);
  });

  test('a channel with two tags counts under both', () async {
    await addChannel(id: 'a', tags: const ['undecided', 'irrelevant']);
    await addChannel(id: 'b', tags: const ['undecided']);
    await addChannel(id: 'c');

    final stats = await repo.load(const ChannelStatsQuery());

    expect(countIn(stats.byTag, 'undecided'), 2);
    expect(countIn(stats.byTag, 'irrelevant'), 1);
    // Sums to more than the channel count, on purpose; the section says so.
    expect(stats.byTag.fold<int>(0, (sum, b) => sum + b.count), 3);
    expect(stats.channels, 3);
  });

  test('an untagged channel does not break the tag breakdown', () async {
    // A channel nobody has touched has no `channel_state` row at all, so the
    // view's COALESCE is what turns "no tags" into `[]` — `json_each(NULL)`
    // is not a no-op.
    await mirror.execute(
      'INSERT INTO channels (channel_id, handle, subscribers, first_seen_at) '
      "VALUES ('a', '@a', '10', ?)",
      [iso(DateTime.now())],
    );

    final stats = await repo.load(const ChannelStatsQuery());

    expect(stats.channels, 1);
    expect(stats.byTag, isEmpty);
  });

  test('countries: unknown is counted apart, never drawn as a country',
      () async {
    await addChannel(id: 'a', country: 'EG');
    await addChannel(id: 'b', country: 'EG');
    await addChannel(id: 'c', country: 'US');
    await addChannel(id: 'd');

    final stats = await repo.load(const ChannelStatsQuery());

    expect(stats.withoutCountry, 1);
    expect(stats.byCountry.map((b) => b.key), ['EG', 'US']);
    expect(stats.byCountry.first.count, 2);
  });

  test('uploads are summed from the 30-day rollup, and a null count is zero',
      () async {
    await addChannel(id: 'a', videosLast30: 4);
    await addChannel(id: 'b', videosLast30: 0);
    await addChannel(id: 'c');

    final stats = await repo.load(const ChannelStatsQuery());

    expect(stats.videosLast30, 4);
  });

  test('minVideosLast30 is a floor, and a null count does not clear it',
      () async {
    await addChannel(id: 'a', videosLast30: 4);
    await addChannel(id: 'b', videosLast30: 2);
    await addChannel(id: 'c', videosLast30: 0);
    await addChannel(id: 'd'); // null — COALESCE(...,0), so below any floor

    expect(
      (await repo.load(const ChannelStatsQuery(minVideosLast30: 3))).channels,
      1,
    );
    expect(
      (await repo.load(const ChannelStatsQuery(minVideosLast30: 1))).channels,
      2,
    );
  });

  test('the average-views range narrows on the trailing-30-day column',
      () async {
    await addChannel(id: 'a', subscribers: 5000, medianViewsLast30: 500);
    await addChannel(id: 'b', subscribers: 5000, medianViewsLast30: 20000);
    await addChannel(id: 'c', subscribers: 5000, medianViewsLast30: 90000);
    await addChannel(id: 'd', subscribers: 5000); // no figure — bounded as 0

    expect(
      (await repo.load(const ChannelStatsQuery(minMedianViews: 10000)))
          .channels,
      2,
    );
    expect(
      (await repo.load(const ChannelStatsQuery(maxMedianViews: 10000)))
          .channels,
      2,
    );
    expect(
      (await repo.load(
        const ChannelStatsQuery(minMedianViews: 10000, maxMedianViews: 50000),
      ))
          .channels,
      1,
    );
  });

  test('the archive is a second series on the tier, view-tier and tag charts',
      () async {
    await addChannel(id: 'a', subscribers: 5000, medianViewsLast30: 4000);
    await addChannel(id: 'b', subscribers: 40000, medianViewsLast30: 30000);
    await addArchived(
        id: 'x', subscribers: 3000, medianViews: 800, label: 'irrelevant');
    await addArchived(
        id: 'y', subscribers: 45000, medianViews: 25000, label: 'haramStuff');
    await addArchived(
        id: 'z', subscribers: 6000, medianViews: 900, label: 'irrelevant');

    final stats = await repo.load(const ChannelStatsQuery());

    // Reported beside the live count, never folded into it.
    expect(stats.channels, 2);
    expect(stats.archivedChannels, 3);
    expect(stats.archivedTotalSubscribers, 54000);
    expect(stats.archivedWithMedianViews, 3);
    expect(stats.archivedMedianViews, ((800 + 25000 + 900) / 3).round());

    // Subscriber tiers: the archived rows stack on the same bands.
    expect(archivedIn(stats.byTier, '<10K'), 2);
    expect(archivedIn(stats.byTier, '10K-50K'), 1);
    expect(countIn(stats.byTier, '<10K'), 1);

    // View tiers, over the archive's median_views_last_30.
    expect(archivedIn(stats.byViewTier, '<10K'), 2);
    expect(archivedIn(stats.byViewTier, '10K-50K'), 1);

    // Tags: a label nobody live carries still draws its archived bar.
    expect(archivedIn(stats.byTag, 'irrelevant'), 2);
    expect(archivedIn(stats.byTag, 'haramStuff'), 1);
  });

  // Archive-due channels are still full rows in `channels` — unlike the
  // fully-archived population, they carry every column, so [StatBucket.archiveDue]
  // is available on every breakdown, not just the four the archive itself
  // can answer.
  test('archive-due channels split out of the live count on every breakdown',
      () async {
    await addChannel(
      id: 'a',
      subscribers: 5000,
      country: 'EG',
      tags: const ['irrelevant'],
      medianViewsLast30: 4000,
      firstSeenAt: DateTime.now(),
      archiveDueAt: DateTime.now().add(const Duration(days: 7)),
    );
    await addChannel(
      id: 'b',
      subscribers: 40000,
      country: 'EG',
      tags: const ['qualified'],
      medianViewsLast30: 30000,
    );

    final stats = await repo.load(const ChannelStatsQuery());

    // The headline total still counts both — an archive-due channel has not
    // left `channels` yet.
    expect(stats.channels, 2);
    expect(stats.archiveDueChannels, 1);
    expect(stats.archiveDueTotalSubscribers, 5000);
    expect(stats.archiveDueMedianViews, 4000);

    // Every breakdown splits the same way: count is truly-live, archiveDue is
    // the disjoint counting-down share, and the two sum to the old undivided
    // figure.
    expect(countIn(stats.byTier, '<10K'), 0);
    expect(archiveDueIn(stats.byTier, '<10K'), 1);
    expect(countIn(stats.byCountry, 'EG'), 1);
    expect(archiveDueIn(stats.byCountry, 'EG'), 1);
    expect(countIn(stats.byTag, 'irrelevant'), 0);
    expect(archiveDueIn(stats.byTag, 'irrelevant'), 1);
    final thisMonth = stats.byMonth.last;
    expect(thisMonth.count, 1);
    expect(thisMonth.archiveDue, 1);
  });

  test('a filter the archive cannot answer zeroes its series, not the page',
      () async {
    await addChannel(
        id: 'a', subscribers: 5000, country: 'EG', videosLast30: 3);
    await addArchived(id: 'x', subscribers: 5000, medianViews: 800);

    // Country, stage, vetting and minVideosLast30 have no column in the archive.
    for (final query in const [
      ChannelStatsQuery(country: 'EG'),
      ChannelStatsQuery(minVideosLast30: 1),
    ]) {
      final stats = await repo.load(query);
      expect(stats.channels, 1, reason: 'live side still answers: $query');
      expect(stats.archivedChannels, 0, reason: 'archive cannot match: $query');
      expect(archivedIn(stats.byTier, '<10K'), 0);
    }

    // A subscriber bound, which the archive DOES keep, still narrows both.
    final bounded =
        await repo.load(const ChannelStatsQuery(minSubscribers: 10000));
    expect(bounded.archivedChannels, 0);
  });

  test('deals are counted from last_deal_at', () async {
    await addChannel(id: 'a', lastDealAt: DateTime.now());
    await addChannel(id: 'b');

    expect((await repo.load(const ChannelStatsQuery())).withADeal, 1);
  });

  test('every filter narrows the whole page, not just its own chart', () async {
    await addChannel(
      id: 'a',
      subscribers: 5000,
      country: 'EG',
      tags: const ['undecided'],
      pipelineStage: 'contacted',
    );
    await addChannel(
      id: 'b',
      subscribers: 50000,
      country: 'EG',
      tags: const ['irrelevant'],
    );
    await addChannel(id: 'c', subscribers: 5000, country: 'US');

    Future<int> channelsFor(ChannelStatsQuery query) async =>
        (await repo.load(query)).channels;

    expect(await channelsFor(const ChannelStatsQuery(country: 'EG')), 2);
    expect(
      await channelsFor(const ChannelStatsQuery(tag: ChannelTag.undecided)),
      1,
    );
    expect(
      await channelsFor(
        const ChannelStatsQuery(stage: PipelineStage.contacted),
      ),
      1,
    );
    expect(
      await channelsFor(
        const ChannelStatsQuery(vetting: VettingStatus.newlyFound),
      ),
      3,
    );
    expect(
      await channelsFor(const ChannelStatsQuery(minSubscribers: 10000)),
      1,
    );
    expect(
      await channelsFor(const ChannelStatsQuery(maxSubscribers: 10000)),
      2,
    );

    // Combined, and the breakdowns describe the narrowed population too.
    final narrowed = await repo.load(
      const ChannelStatsQuery(country: 'EG', maxSubscribers: 10000),
    );
    expect(narrowed.channels, 1);
    expect(countIn(narrowed.byTag, 'undecided'), 1);
    expect(narrowed.byCountry.single.key, 'EG');
  });

  test('the tag filter matches the wire value, not the Dart identifier',
      () async {
    // `PipelineStage.isNew` stores 'new'; the same trap applies to tags, and a
    // filter that sent `name` would silently match nothing.
    await addChannel(id: 'a', tags: const ['haramStuff']);

    final stats =
        await repo.load(const ChannelStatsQuery(tag: ChannelTag.haramStuff));
    expect(stats.channels, 1);
  });

  test('twelve months, in order, with the quiet ones present at zero',
      () async {
    // UTC, matching how the buckets are cut — a local midnight on the 1st is
    // the previous month once it is written as UTC, which is exactly the
    // off-by-one this test is here to hold down.
    final now = DateTime.now().toUtc();
    await addChannel(id: 'a', firstSeenAt: now);
    await addChannel(
      id: 'b',
      firstSeenAt: DateTime.utc(now.year, now.month - 2, 15),
    );
    // Older than the window, so it is in none of the twelve buckets.
    await addChannel(
      id: 'c',
      firstSeenAt: DateTime.utc(now.year - 2, now.month, 15),
    );
    // Rejected channels sit in the month they were FOUND, off `found_at` — the
    // same one they would have sat in while live. One this month, one two back.
    await addArchived(id: 'x', foundAt: now);
    await addArchived(
        id: 'y', foundAt: DateTime.utc(now.year, now.month - 2, 9));
    // A row archived before the sweep copied a found date is left out, not
    // bucketed at a bogus month.
    await addArchived(id: 'z');

    final months = (await repo.load(const ChannelStatsQuery())).byMonth;

    expect(months, hasLength(12));
    expect(months.last.count, 1);
    expect(months[9].count, 1);
    // The gap between them is a point at zero, not a missing bar.
    expect(months[10].count, 0);
    // The archived series stacks on the same buckets.
    expect(months.last.archived, 1);
    expect(months[9].archived, 1);
    expect(months[10].archived, 0);
    // Ascending, so the line is drawn left to right.
    final keys = months.map((b) => b.key).toList();
    expect(keys, equals([...keys]..sort()));
  });

  test('months are read from the stored timestamp, in either ISO spelling',
      () async {
    // PostgREST writes a timestamptz as ISO-8601, and which of these two forms
    // it uses is not the app's decision. The month breakdown slices the first
    // seven characters rather than parsing the date, so this is the assertion
    // that keeps that shortcut honest.
    final now = DateTime.now().toUtc();
    final month = '${now.year.toString().padLeft(4, '0')}-'
        '${now.month.toString().padLeft(2, '0')}';
    for (final (id, stamp) in [
      ('a', '$month-15T09:00:00.000Z'),
      ('b', '$month-16T09:00:00+00:00'),
    ]) {
      await mirror.execute(
        'INSERT INTO channels (channel_id, handle, first_seen_at) '
        'VALUES (?, ?, ?)',
        [id, '@$id', stamp],
      );
    }

    final months = (await repo.load(const ChannelStatsQuery())).byMonth;

    expect(months.last.key, month);
    expect(months.last.count, 2);
  });

  test('facets list what the data holds, unnarrowed by the current filter',
      () async {
    await addChannel(
      id: 'a',
      country: 'EG',
      tags: const ['undecided'],
      pipelineStage: 'contacted',
      vettingStatus: 'shortlisted',
    );
    await addChannel(id: 'b', tags: const ['irrelevant']);

    final facets = await repo.facets();

    expect(facets.countries, ['EG']);
    expect(facets.stages, contains(PipelineStage.contacted));
    expect(facets.vetting, contains(VettingStatus.shortlisted));
    expect(
        facets.tags,
        containsAll(
          [ChannelTag.undecided, ChannelTag.irrelevant],
        ));
  });
}
