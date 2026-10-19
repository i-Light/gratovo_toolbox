import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/channel_stats.dart';
import 'package:gratovo_toolbox/data/repositories/channel_stats_repository.dart';

/// The Dashboard's analytics, computed from the local database.
///
/// Reads the `influencer_channels` view (the pipeline's scraped facts joined
/// to the team's typed-in state) and the pipeline's `channel_archive`, so the
/// numbers describe exactly what the influencer list shows. Every figure is
/// derived here, on every machine, and none of it is stored anywhere.
///
/// Two things worth knowing when reading the numbers:
///
///  * **The median is discrete.** SQLite has no percentile, so this takes the
///    middle value, or the mean of the two middle values on an even count.
///  * **It sees what this machine has synced.** A database that is behind
///    reports the roster as of its last pull; the sync card in Settings is
///    where the age of the data is reported.
class MirrorChannelStatsRepository implements ChannelStatsRepository {
  const MirrorChannelStatsRepository(this._db);

  final LocalSyncDb _db;

  /// The six subscriber bands, and the same six applied to view counts.
  ///
  /// Spelled out here exactly as the SQL function spells them out, and for the
  /// same reason: a histogram whose bars mean something different depending on
  /// which code path drew them cannot be read against the one the reader just
  /// looked at.
  static const _tiers = <({String key, int lo, int? hi})>[
    (key: '<10K', lo: 0, hi: 9999),
    (key: '10K-50K', lo: 10000, hi: 49999),
    (key: '50K-100K', lo: 50000, hi: 99999),
    (key: '100K-500K', lo: 100000, hi: 499999),
    (key: '500K-1M', lo: 500000, hi: 999999),
    (key: '1M+', lo: 1000000, hi: null),
  ];

  @override
  Future<ChannelStats> load(ChannelStatsQuery query) async {
    final (where, params) = _filter(query);

    // Six statements rather than the server's single CTE, and a deliberate
    // yield between each. SQLite's API is synchronous, so without the yields
    // the whole aggregate is one uninterrupted block on the UI isolate: at
    // 100,000 channels that measured 265 ms, which is a fifth of a second in
    // which the app cannot paint. Yielding hands the frame pipeline back
    // between statements, so the worst contiguous stall is the longest single
    // query rather than the sum of all of them.
    //
    // What each statement covers is chosen to keep that worst case down. The
    // headline figures and BOTH histograms come from one pass of conditional
    // sums, because three separate scans of the same 100,000 rows to produce
    // twenty-two numbers is three times the work for no extra answer.
    //
    // Nothing writes to this file between them (the puller commits in one
    // transaction on this same isolate), so they still describe one population
    // — the property the server's single scan was buying.
    final totals = await _one(_totalsSql(where), params);
    await _yield();

    // Top 12, and no "other" bucket — see [ChannelStats.byCountry]. `due` is
    // ordered on `n` (live plus archive-due), not on itself, so the top-12 cut
    // and the row order do not shift just because a checkbox somewhere is off.
    final byCountry = _buckets(await _db.getAllOffThread(
      'SELECT c.country AS k, COUNT(*) AS n, '
      'SUM(CASE WHEN c.archive_due_at IS NOT NULL THEN 1 ELSE 0 END) AS due '
      'FROM influencer_channels c '
      '$where AND c.country IS NOT NULL '
      'GROUP BY k ORDER BY n DESC, k LIMIT 12',
      params,
    ));
    await _yield();

    final byStage = _buckets(await _db.getAllOffThread(
      'SELECT c.pipeline_stage AS k, COUNT(*) AS n, '
      'SUM(CASE WHEN c.archive_due_at IS NOT NULL THEN 1 ELSE 0 END) AS due '
      'FROM influencer_channels c '
      '$where GROUP BY k ORDER BY n DESC, k',
      params,
    ));
    await _yield();

    final byVetting = _buckets(await _db.getAllOffThread(
      'SELECT c.vetting_status AS k, COUNT(*) AS n, '
      'SUM(CASE WHEN c.archive_due_at IS NOT NULL THEN 1 ELSE 0 END) AS due '
      'FROM influencer_channels c '
      '$where GROUP BY k ORDER BY n DESC, k',
      params,
    ));
    await _yield();

    // `json_each` over the JSON-string tag column, so a channel carrying two
    // tags counts under both — the local spelling of the server's `unnest`. The
    // COALESCE is load-bearing, for the reason the influencer list's own tag
    // filter gives: `json_each(NULL)` is not a no-op.
    //
    // The most expensive statement here by some way, because it parses JSON
    // once per row. It stays a `json_each` rather than becoming a set of
    // `instr()` probes for each known tag: probing would mean the breakdown
    // could only ever show tags the Dart enum already knows about, and a value
    // the pipeline writes that the app has not learned yet would vanish from
    // the chart instead of showing up as itself.
    final byTag = _buckets(await _db.getAllOffThread(
      'SELECT t.value AS k, COUNT(*) AS n, '
      'SUM(CASE WHEN c.archive_due_at IS NOT NULL THEN 1 ELSE 0 END) AS due '
      "FROM influencer_channels c, json_each(COALESCE(c.channel_tags, '[]')) t "
      '$where GROUP BY k ORDER BY n DESC, k',
      params,
    ));
    await _yield();

    final byMonth = await _byMonth(where, params);
    await _yield();

    // The archived second series — see [_archive]. Its own pass (plus the yield
    // inside it), last because it is the one the charts can do without: an old
    // mirror with no `channel_archive` rows yet just draws the live bars.
    final archive = await _archive(query);
    await _yield();

    return ChannelStats(
      channels: _int(totals['channels']),
      withSubscribers: _int(totals['with_subscribers']),
      totalSubscribers: _int(totals['total_subscribers']),
      meanSubscribers: _nullableInt(totals['mean_subscribers']),
      medianSubscribers: await _median(
        where,
        params,
        withSubscribers: _int(totals['with_subscribers']),
      ),
      maxSubscribers: _nullableInt(totals['max_subscribers']),
      videosLast30: _int(totals['videos_last_30']),
      medianViews: _nullableInt(totals['median_views']),
      withMedianViews: _int(totals['with_median_views']),
      withADeal: _int(totals['with_a_deal']),
      withoutCountry: _int(totals['without_country']),
      byTier: _readTiers(totals, 'sub_tier', archive.subTier),
      byViewTier: _readTiers(totals, 'view_tier', archive.viewTier),
      byCountry: byCountry,
      byStage: byStage,
      byVetting: byVetting,
      byTag: _mergeTags(byTag, archive.byLabel),
      byMonth: _mergeMonths(byMonth, archive.byMonth),
      archivedChannels: archive.channels,
      archivedWithSubscribers: archive.withSubscribers,
      archivedTotalSubscribers: archive.totalSubscribers,
      archivedWithMedianViews: archive.withMedianViews,
      archivedMedianViews: archive.medianViews,
      archiveDueChannels: _int(totals['archive_due_channels']),
      archiveDueTotalSubscribers: _int(totals['archive_due_total_subscribers']),
      archiveDueMedianViews: _nullableInt(totals['archive_due_median_views']),
    );
  }

  /// The live tag breakdown with the archive's per-label counts folded in — a
  /// key on either side survives (a label nobody live carries still draws its
  /// archived bar), and the merged list is ordered by the FULL bar height, live
  /// plus archived, then by key. The local spelling of the SQL function's
  /// `all_tags` FULL JOIN and its `order by n + archived desc, key`.
  static List<StatBucket> _mergeTags(
    List<StatBucket> live,
    Map<String, int> archivedByLabel,
  ) {
    if (archivedByLabel.isEmpty) return live;
    final counts = {for (final b in live) b.key: b.count};
    final due = {for (final b in live) b.key: b.archiveDue};
    final keys = {...counts.keys, ...archivedByLabel.keys}.toList()
      ..sort((a, b) {
        final byTotal = ((counts[b] ?? 0) + (archivedByLabel[b] ?? 0))
            .compareTo((counts[a] ?? 0) + (archivedByLabel[a] ?? 0));
        return byTotal != 0 ? byTotal : a.compareTo(b);
      });
    return [
      for (final key in keys)
        StatBucket(
          key: key,
          count: counts[key] ?? 0,
          archiveDue: due[key] ?? 0,
          archived: archivedByLabel[key] ?? 0,
        ),
    ];
  }

  /// The live month histogram with the archive's per-month counts stacked
  /// alongside — the local spelling of the SQL function's `archive_months` CTE
  /// joined to `months` by key. The live side already carries all twelve month
  /// keys (they are generated, not grouped), so this only has to attach a
  /// count to each. An empty [archivedByMonth] (an old mirror, or a filter the
  /// archive cannot answer) leaves every point live-only.
  static List<StatBucket> _mergeMonths(
    List<StatBucket> live,
    Map<String, int> archivedByMonth,
  ) {
    if (archivedByMonth.isEmpty) return live;
    return [
      for (final bucket in live)
        StatBucket(
          key: bucket.key,
          count: bucket.count,
          archiveDue: bucket.archiveDue,
          archived: archivedByMonth[bucket.key] ?? 0,
        ),
    ];
  }

  /// Hands the frame pipeline back between statements — see [load].
  ///
  /// `Future.delayed(Duration.zero)` rather than `Future.value()`: an already
  /// completed future resumes on the microtask queue, which drains fully before
  /// the event loop gets a turn, so it would not yield to the renderer at all.
  static Future<void> _yield() => Future<void>.delayed(Duration.zero);

  /// The headline figures and both histograms, from one pass.
  ///
  /// The tier columns are conditional sums generated from [_tiers], so the six
  /// bands are still defined exactly once even though they now appear in this
  /// statement twice.
  static String _totalsSql(String where) {
    final tierSums = [
      for (final prefix in const ['sub_tier', 'view_tier'])
        for (final (index, tier) in _tiers.indexed) ...[
          'SUM(CASE WHEN ${_tierTest(
            prefix == 'sub_tier' ? 'c.subscribers' : _liveViews,
            tier,
          )} THEN 1 ELSE 0 END) AS ${prefix}_$index',
          // The archive-due subset of the same band — see [StatBucket.archiveDue].
          'SUM(CASE WHEN ${_tierTest(
            prefix == 'sub_tier' ? 'c.subscribers' : _liveViews,
            tier,
          )} AND c.archive_due_at IS NOT NULL THEN 1 ELSE 0 END) AS ${prefix}_due_$index',
        ],
    ];

    return '''
SELECT COUNT(*)                                           AS channels,
       COUNT(c.subscribers)                               AS with_subscribers,
       COALESCE(SUM(c.subscribers), 0)                    AS total_subscribers,
       AVG(c.subscribers)                                 AS mean_subscribers,
       MAX(c.subscribers)                                 AS max_subscribers,
       COALESCE(SUM(c.videos_last_30), 0)                 AS videos_last_30,
       AVG(c.median_views_last_30)                           AS median_views,
       COUNT(c.median_views_last_30)                         AS with_median_views,
       SUM(CASE WHEN c.last_deal_at IS NOT NULL
                THEN 1 ELSE 0 END)                        AS with_a_deal,
       SUM(CASE WHEN c.country IS NULL THEN 1 ELSE 0 END) AS without_country,
       SUM(CASE WHEN c.archive_due_at IS NOT NULL
                THEN 1 ELSE 0 END)                        AS archive_due_channels,
       COALESCE(SUM(CASE WHEN c.archive_due_at IS NOT NULL
                THEN c.subscribers ELSE 0 END), 0)         AS archive_due_total_subscribers,
       AVG(CASE WHEN c.archive_due_at IS NOT NULL
                THEN c.median_views_last_30 END)          AS archive_due_median_views,
       ${tierSums.join(',\n       ')}
  FROM influencer_channels c
 $where''';
  }

  /// One histogram back out of the totals row, in the fixed tier order, with the
  /// archived count per tier stacked alongside.
  ///
  /// The empty tiers are kept at zero, which the conditional sums give for free
  /// — and which matters: the gap between two populated bands is information,
  /// and a histogram that omits it draws a smooth distribution that is not
  /// there. [archived] is indexed the same as [_tiers]; an empty list (an old
  /// mirror, or a filter the archive cannot answer) leaves every bar live-only.
  static List<StatBucket> _readTiers(
    Map<String, Object?> totals,
    String prefix,
    List<int> archived,
  ) {
    return [
      for (final (index, tier) in _tiers.indexed)
        _tierBucket(totals, prefix, index, tier.key, archived),
    ];
  }

  /// One band out of the totals row — see [_buckets] for why [count] is the
  /// band's full match count with the archive-due share subtracted back out.
  static StatBucket _tierBucket(
    Map<String, Object?> totals,
    String prefix,
    int index,
    String key,
    List<int> archived,
  ) {
    final due = _int(totals['${prefix}_due_$index']);
    return StatBucket(
      key: key,
      count: _int(totals['${prefix}_$index']) - due,
      archiveDue: due,
      archived: index < archived.length ? archived[index] : 0,
    );
  }

  @override
  Future<ChannelStatsFacets> facets() async {
    List<String> column(List<Map<String, Object?>> rows) => [
          for (final row in rows)
            if (row['k']?.toString() case final value?)
              if (value.isNotEmpty) value,
        ];

    // Four scans, yielded between like [load]'s — the tag one parses JSON per
    // row and the vetting one has no index behind it, so together they are as
    // long a block as the aggregate itself if left to run uninterrupted.
    final countries = column(await _db.getAllOffThread(
      'SELECT DISTINCT country AS k FROM influencer_channels '
      'WHERE country IS NOT NULL ORDER BY k',
    ));
    await _yield();
    final stages = column(await _db.getAllOffThread(
      'SELECT DISTINCT pipeline_stage AS k FROM influencer_channels ORDER BY k',
    ));
    await _yield();
    final vetting = column(await _db.getAllOffThread(
      'SELECT DISTINCT vetting_status AS k FROM influencer_channels ORDER BY k',
    ));
    await _yield();
    final tags = column(await _db.getAllOffThread(
      'SELECT DISTINCT t.value AS k FROM influencer_channels c, '
      "json_each(COALESCE(c.channel_tags, '[]')) t ORDER BY k",
    ));

    // Routed back through `fromJson` rather than building the record directly,
    // so the wire-value-to-enum mapping — including its rule about dropping
    // values it does not recognise — stays in one place shared with the network
    // path.
    return ChannelStatsFacets.fromJson({
      'countries': countries,
      'stages': stages,
      'vetting': vetting,
      'tags': tags,
    });
  }

  // ---------------------------------------------------------------------------
  // The filter
  // ---------------------------------------------------------------------------

  /// The `WHERE` every statement above shares, plus its parameters.
  ///
  /// Always non-empty — it starts at `WHERE 1 = 1` — so a caller that needs to
  /// add a clause of its own appends ` AND ...` unconditionally rather than
  /// each working out whether it is the first.
  (String, List<Object?>) _filter(ChannelStatsQuery query) {
    final clauses = <String>['1 = 1'];
    final params = <Object?>[];

    if (query.country case final country?) {
      clauses.add('c.country = ?');
      params.add(country);
    }
    if (query.tag case final tag?) {
      clauses.add(
        "EXISTS (SELECT 1 FROM json_each(COALESCE(c.channel_tags, '[]')) "
        'WHERE json_each.value = ?)',
      );
      // The wire value, not the Dart identifier. `PipelineStage.isNew` stores
      // 'new' because `new` is reserved in Dart, and sending `name` here would
      // silently match no rows — the same trap the Supabase path notes.
      params.add(tag.wire);
    }
    if (query.stage case final stage?) {
      clauses.add('c.pipeline_stage = ?');
      params.add(stage.wire);
    }
    if (query.vetting case final vetting?) {
      clauses.add('c.vetting_status = ?');
      params.add(vetting.name);
    }
    if (query.minSubscribers case final min?) {
      clauses.add('c.subscribers >= ?');
      params.add(min);
    }
    if (query.maxSubscribers case final max?) {
      clauses.add('c.subscribers <= ?');
      params.add(max);
    }
    // Bounds on the zero-for-null column, not the raw one, so "at most 9,999
    // median views" selects exactly the rows the `<10K` bar counts — see
    // [_liveViews]. A bound the chart it narrows cannot be read against is
    // worse than none.
    if (query.minMedianViews case final min?) {
      clauses.add('$_liveViews >= ?');
      params.add(min);
    }
    if (query.maxMedianViews case final max?) {
      clauses.add('$_liveViews <= ?');
      params.add(max);
    }
    if (query.minVideosLast30 case final min?) {
      clauses.add('COALESCE(c.videos_last_30, 0) >= ?');
      params.add(min);
    }

    return ('WHERE ${clauses.join(' AND ')}', params);
  }

  // ---------------------------------------------------------------------------
  // The archive — the second series the tier, view-tier and tag charts draw
  // ---------------------------------------------------------------------------

  /// The archive as the aggregates below read it: the subscriber count cast
  /// from the text the pipeline stores, and the median frozen at archive
  /// time.
  static const _archiveRows =
      'SELECT channel_id, label, found_at, median_views_last_30, '
      "CAST(NULLIF(REPLACE(subscribers, ',', ''), '') AS INTEGER) AS subscribers "
      'FROM channel_archive';

  /// The `channel_archive` filter that parallels [_filter], or `null` when the
  /// query cannot match any archived row at all.
  ///
  /// `channel_archive` keeps a handful of facts per rejected channel:
  /// subscriber count, the median views frozen at archive time, and the
  /// rejecting `label`. It has no country, pipeline stage, vetting status or
  /// upload-recency column, so a filter on any of those matches nothing here
  /// — the same rule `country = 'EG'` already follows against a null country.
  /// In that case this returns `null` and the archived series comes out empty
  /// rather than as an invented number.
  (String, List<Object?>)? _archiveFilter(ChannelStatsQuery query) {
    if (query.country != null ||
        query.stage != null ||
        query.vetting != null ||
        query.minVideosLast30 != null) {
      return null;
    }

    final clauses = <String>['1 = 1'];
    final params = <Object?>[];

    if (query.tag case final tag?) {
      // The wire value, matched against `label` — that IS the archive's tag,
      // exactly one rejecting tag per row.
      clauses.add('r.label = ?');
      params.add(tag.wire);
    }
    if (query.minSubscribers case final min?) {
      clauses.add('r.subscribers >= ?');
      params.add(min);
    }
    if (query.maxSubscribers case final max?) {
      clauses.add('r.subscribers <= ?');
      params.add(max);
    }
    if (query.minMedianViews case final min?) {
      clauses.add('$_archiveViews >= ?');
      params.add(min);
    }
    if (query.maxMedianViews case final max?) {
      clauses.add('$_archiveViews <= ?');
      params.add(max);
    }

    return ('WHERE ${clauses.join(' AND ')}', params);
  }

  /// The archived headline counts and the archived side of both histograms, in
  /// one pass of conditional sums — the local spelling of the SQL function's
  /// `archive_totals` / `archive_tiers` / `archive_view_tiers` CTEs. Plus the
  /// per-label counts the tag chart's second series needs.
  ///
  /// All zero (and an empty label map) when [_archiveFilter] returned `null`.
  Future<_ArchiveStats> _archive(ChannelStatsQuery query) async {
    final filter = _archiveFilter(query);
    if (filter == null) return _ArchiveStats.empty;
    final (where, params) = filter;

    final tierSums = [
      for (final prefix in const ['sub_tier', 'view_tier'])
        for (final (index, tier) in _tiers.indexed)
          'SUM(CASE WHEN ${_tierTest(
            prefix == 'sub_tier' ? 'r.subscribers' : _archiveViews,
            tier,
          )} THEN 1 ELSE 0 END) AS ${prefix}_$index',
    ];
    final totals = await _one(
      '''
SELECT COUNT(*)                                AS channels,
       COUNT(r.subscribers)                    AS with_subscribers,
       COALESCE(SUM(r.subscribers), 0)         AS total_subscribers,
       COUNT(r.median_views_last_30)                      AS with_median_views,
       AVG(r.median_views_last_30)                        AS median_views,
       ${tierSums.join(',\n       ')}
  FROM ($_archiveRows) r
 $where''',
      params,
    );
    await _yield();

    final byLabel = <String, int>{
      for (final row in await _db.getAllOffThread(
        'SELECT r.label AS k, COUNT(*) AS n FROM ($_archiveRows) r '
        '$where GROUP BY k',
        params,
      ))
        if (row['k']?.toString() case final key?) key: _int(row['n']),
    };
    await _yield();

    // The archived side of the month histogram, keyed `YYYY-MM` off the first
    // seven characters of `found_at` — the same `substr` shortcut, and the same
    // ISO-and-UTC assumption, that [_byMonth] takes on `first_seen_at`. Rows
    // with a null `found_at` (archived before the sweep started copying it) fall
    // out here rather than bucketing at a bogus month; [_mergeMonths] then only
    // has twelve keys to attach these to, so no window bound is needed.
    final byMonth = <String, int>{
      for (final row in await _db.getAllOffThread(
        'SELECT substr(r.found_at, 1, 7) AS k, COUNT(*) AS n '
        'FROM ($_archiveRows) r $where AND r.found_at IS NOT NULL GROUP BY k',
        params,
      ))
        if (row['k']?.toString() case final key?) key: _int(row['n']),
    };

    return _ArchiveStats(
      channels: _int(totals['channels']),
      withSubscribers: _int(totals['with_subscribers']),
      totalSubscribers: _int(totals['total_subscribers']),
      withMedianViews: _int(totals['with_median_views']),
      medianViews: _nullableInt(totals['median_views']),
      subTier: [
        for (final (index, _) in _tiers.indexed)
          _int(totals['sub_tier_$index']),
      ],
      viewTier: [
        for (final (index, _) in _tiers.indexed)
          _int(totals['view_tier_$index']),
      ],
      byLabel: byLabel,
      byMonth: byMonth,
    );
  }

  // ---------------------------------------------------------------------------
  // The pieces SQLite cannot express in one pass
  // ---------------------------------------------------------------------------

  /// The middle subscriber count, over the channels that have one.
  ///
  /// An offset into the ordered values rather than a window function, and the
  /// count it needs to pick that offset is [withSubscribers], already computed
  /// by the totals pass — so this is one indexed lookup rather than a second
  /// scan. On an odd count it is the middle value; on an even one the mean of
  /// the two straddling the middle, which is what `percentile_cont(0.5)`
  /// returns for the same input.
  Future<int?> _median(
    String where,
    List<Object?> params, {
    required int withSubscribers,
  }) async {
    final n = withSubscribers;
    if (n == 0) return null;

    final offset = n.isOdd ? n ~/ 2 : n ~/ 2 - 1;
    final take = n.isOdd ? 1 : 2;
    final rows = await _db.getAllOffThread(
      'SELECT c.subscribers AS v FROM influencer_channels c '
      '$where AND c.subscribers IS NOT NULL '
      'ORDER BY c.subscribers LIMIT ? OFFSET ?',
      [...params, take, offset],
    );
    if (rows.isEmpty) return null;
    final values = [for (final row in rows) _int(row['v'])];
    return (values.reduce((a, b) => a + b) / values.length).round();
  }

  /// Channels first seen per month, twelve months ending this one.
  ///
  /// The empty months are filled in here rather than generated in SQL — SQLite
  /// has no `generate_series` — but the result is the shape the server sends,
  /// zeros included, for the reason [ChannelStats.byMonth] gives: a month with
  /// no finds has to be a point at zero, not a gap the line skips over.
  Future<List<StatBucket>> _byMonth(String where, List<Object?> params) async {
    // UTC throughout, because that is the calendar the buckets are cut on:
    // `first_seen_at` is stored as a UTC ISO string and `strftime` reads it as
    // written, so a label generated from the local month would be off by one
    // for anything found in the hours either side of a month boundary — and
    // silently, since both months exist in the list. Postgres cuts these the
    // same way, `date_trunc` running under the database's UTC session.
    //
    // `DateTime.utc` normalises an out-of-range month, so `month - 11` in
    // January is February of last year with no arithmetic here.
    final now = DateTime.now().toUtc();
    final months = [
      for (var back = 11; back >= 0; back--)
        DateTime.utc(now.year, now.month - back),
    ];
    String label(DateTime month) => '${month.year.toString().padLeft(4, '0')}-'
        '${month.month.toString().padLeft(2, '0')}';

    // `substr`, not `strftime`. The column holds an ISO-8601 UTC timestamp, so
    // its first seven characters already ARE the `YYYY-MM` this groups by, and
    // taking them is a string slice instead of a date parse per row — 46 ms
    // down to 26 ms over 100,000 channels. It depends on the stored format
    // being ISO and UTC, which is what the puller writes and what the whole
    // mirror already assumes (see `mirror_schema.dart`); a row stored with a
    // non-zero offset would bucket by its own clock rather than by UTC.
    final rows = await _db.getAllOffThread(
      'SELECT substr(c.first_seen_at, 1, 7) AS k, COUNT(*) AS n, '
      'SUM(CASE WHEN c.archive_due_at IS NOT NULL THEN 1 ELSE 0 END) AS due '
      'FROM influencer_channels c $where AND c.first_seen_at >= ? GROUP BY k',
      [...params, months.first.toIso8601String()],
    );
    final counts = {
      for (final row in rows)
        if (row['k']?.toString() case final key?) key: _int(row['n']),
    };
    final due = {
      for (final row in rows)
        if (row['k']?.toString() case final key?) key: _int(row['due']),
    };

    return [
      for (final month in months)
        StatBucket(
          key: label(month),
          // Every match in the month, archive-due ones included, with [due]
          // subtracted back out — see [_buckets].
          count: (counts[label(month)] ?? 0) - (due[label(month)] ?? 0),
          archiveDue: due[label(month)] ?? 0,
        ),
    ];
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  /// The median view count as the view-tier histogram and the median-views
  /// bounds read it: an unmeasured channel counts as zero.
  ///
  /// The one place this file departs from "a null matches no band". A null
  /// here is not missing data the way a hidden subscriber count is: the
  /// auto-clean gate archives a too-small channel before its videos are ever
  /// fetched, and the post-run sweep tags the same kind of channel — so on any
  /// roster with the rule on, the population with no median IS the population
  /// of dead-on-arrival channels, and leaving it out of the `<10K` bar hid
  /// exactly the shape the chart exists to show. [_archiveViews] is the same
  /// rule for the archive's frozen column, and the keyword evaluation's sample
  /// reads follow it too.
  static const _liveViews = 'COALESCE(c.median_views_last_30, 0)';
  static const _archiveViews = 'COALESCE(r.median_views_last_30, 0)';

  /// Whether [column] falls in one tier, as SQL.
  ///
  /// Interpolating the bounds rather than binding them is safe and deliberate:
  /// they are integer literals from a `const` list in this file, and binding
  /// them would mean threading fourteen parameters through in the right order.
  ///
  /// A null column matches nothing here, which is the rule the subscriber
  /// bands follow: a channel whose subscriber count YouTube hides belongs in
  /// no band rather than in the bottom one. The view bands are passed
  /// [_liveViews] / [_archiveViews], which have already turned null into zero
  /// — see those for why unmeasured views are the exception.
  static String _tierTest(String column, ({String key, int lo, int? hi}) tier) {
    if (tier.hi case final hi?) return '$column BETWEEN ${tier.lo} AND $hi';
    return '$column >= ${tier.lo}';
  }

  // `n` is every matching row in a bucket, archive-due ones included (it is
  // what the ORDER BY and the top-12 cut in [load] run on) — [due] is
  // subtracted back out of it so [StatBucket.count] is the truly-live figure
  // and the two come out disjoint.
  static List<StatBucket> _buckets(List<Map<String, Object?>> rows) => [
        for (final row in rows)
          if (row['k']?.toString() case final key?)
            StatBucket(
              key: key,
              count: _int(row['n']) - _int(row['due']),
              archiveDue: _int(row['due']),
            ),
      ];

  Future<Map<String, Object?>> _one(String sql, List<Object?> params) async {
    final rows = await _db.getAllOffThread(sql, params);
    return rows.isEmpty ? const {} : rows.first;
  }

  static int _int(Object? value) => switch (value) {
        final int v => v,
        final num v => v.round(),
        _ => 0,
      };

  /// Rounds rather than truncates, matching the `::bigint` cast the SQL
  /// function applies to its averages.
  static int? _nullableInt(Object? value) => switch (value) {
        final int v => v,
        final num v => v.round(),
        _ => null,
      };
}

/// The archived side of one [ChannelStats], gathered by
/// [MirrorChannelStatsRepository._archive] before it is folded into the model.
///
/// [subTier] and [viewTier] are counts per band, indexed the same as
/// `MirrorChannelStatsRepository._tiers`. [byLabel] is the archive's per-tag
/// counts (its `label` column), keyed by wire value. [byMonth] is its per-month
/// counts off `found_at`, keyed `YYYY-MM`.
class _ArchiveStats {
  const _ArchiveStats({
    required this.channels,
    required this.withSubscribers,
    required this.totalSubscribers,
    required this.withMedianViews,
    required this.medianViews,
    required this.subTier,
    required this.viewTier,
    required this.byLabel,
    required this.byMonth,
  });

  static const empty = _ArchiveStats(
    channels: 0,
    withSubscribers: 0,
    totalSubscribers: 0,
    withMedianViews: 0,
    medianViews: null,
    subTier: [],
    viewTier: [],
    byLabel: {},
    byMonth: {},
  );

  final int channels;
  final int withSubscribers;
  final int totalSubscribers;
  final int withMedianViews;
  final int? medianViews;
  final List<int> subTier;
  final List<int> viewTier;
  final Map<String, int> byLabel;
  final Map<String, int> byMonth;
}
