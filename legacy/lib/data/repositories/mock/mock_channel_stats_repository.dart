import 'package:gratovo_toolbox/data/models/channel_stats.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/channel_stats_repository.dart';

/// A seeded population, used when there is no client or nobody is signed in.
///
/// Seeded rather than empty for the reason every mock here is: an empty chart
/// and a broken chart look identical, and the whole job of this screen is to
/// draw shapes. The shape is deliberately the real one — a long tail of small
/// channels, a handful of large ones, two countries carrying most of the list —
/// so a layout that only works on a flat distribution fails here rather than in
/// production.
///
/// The filter is applied to the seed rather than ignored. A mock that returns
/// the same numbers whatever the dropdowns say makes the filters look broken,
/// which is worse than showing no numbers at all.
class MockChannelStatsRepository implements ChannelStatsRepository {
  const MockChannelStatsRepository();

  /// One synthetic channel per entry: subscribers, country, stage, vetting,
  /// tags, month first seen, uploads in the last 30 days, average views over
  /// those 30 days.
  ///
  /// The view figures are deliberately NOT a fixed multiple of the subscriber
  /// count. Two of the large channels here are watched far below their size and
  /// one small one far above it, so the view histogram comes out a different
  /// shape from the subscriber one — which is the entire reason the two charts
  /// are drawn next to each other, and a seed where they matched bar for bar
  /// would make a broken chart look correct.
  static const _seed = <_MockChannel>[
    _MockChannel(420, 'EG', PipelineStage.isNew, VettingStatus.newlyFound,
        [ChannelTag.undecided], 1, 0, 180),
    // Tagged irrelevant and counting down to archival — still a full live row
    // with every column, unlike anything in [_archiveSeed]. Exercises
    // [StatBucket.archiveDue] on the tier, country, stage, vetting, tag and
    // month breakdowns all at once.
    _MockChannel(950, 'EG', PipelineStage.isNew, VettingStatus.newlyFound,
        [ChannelTag.irrelevant], 2, 0, 610,
        due: true),
    _MockChannel(1800, 'EG', PipelineStage.contacted, VettingStatus.shortlisted,
        [ChannelTag.qualified], 2, 3, 5200),
    _MockChannel(4400, 'SA', PipelineStage.isNew, VettingStatus.newlyFound,
        [ChannelTag.undecided], 3, 1, 900),
    _MockChannel(8200, 'SA', PipelineStage.contacted, VettingStatus.shortlisted,
        [ChannelTag.qualified], 4, 4, 14000),
    _MockChannel(12500, 'EG', PipelineStage.interested,
        VettingStatus.shortlisted, [ChannelTag.qualified], 5, 2, 3100),
    _MockChannel(31000, 'AE', PipelineStage.roster, VettingStatus.shortlisted,
        [ChannelTag.qualified], 6, 5, 22000),
    _MockChannel(47000, 'EG', PipelineStage.negotiating,
        VettingStatus.shortlisted, [ChannelTag.qualified], 7, 3, 61000),
    _MockChannel(88000, 'US', PipelineStage.contract, VettingStatus.shortlisted,
        [ChannelTag.qualified], 8, 6, 35000),
    _MockChannel(140000, 'EG', PipelineStage.paid, VettingStatus.shortlisted,
        [ChannelTag.qualified], 9, 4, 120000),
    _MockChannel(260000, 'SA', PipelineStage.roster, VettingStatus.shortlisted,
        [ChannelTag.qualified], 10, 2, 74000),
    // The second archive-due channel — already tagged irrelevant and at the
    // end of the pipeline, which is exactly the shape of row this state
    // exists for.
    _MockChannel(610000, 'US', PipelineStage.lost, VettingStatus.rejected,
        [ChannelTag.irrelevant], 11, 0, 41000,
        due: true),
    _MockChannel(1400000, 'EG', PipelineStage.roster, VettingStatus.shortlisted,
        [ChannelTag.qualified], 12, 7, 880000),
    // Subscriber count hidden by the channel owner, and views never measured.
    // Present so the "of which N have a count" line, the null-safe averages and
    // the two histograms that must LEAVE OUT an unmeasured channel rather than
    // bucket it at zero all get exercised.
    _MockChannel(null, null, PipelineStage.isNew, VettingStatus.newlyFound, [],
        12, 1, null),
  ];

  /// The rejected population — subscriber count, lifetime average views, the
  /// rejecting label, and the month (1-based within the same twelve-month
  /// window as [_seed]) the channel was found. Spread across the tiers and both
  /// rejecting labels so the archived color lands on more than one bar, and
  /// with two rows in the current month so the "Found channels this month"
  /// figure carries an archived sub-line.
  static const _archiveSeed = <_MockArchived>[
    _MockArchived(300, 90, ChannelTag.irrelevant, 3),
    _MockArchived(2600, 1400, ChannelTag.irrelevant, 5),
    _MockArchived(7400, 320, ChannelTag.haramStuff, 8),
    _MockArchived(19000, 8800, ChannelTag.irrelevant, 10),
    _MockArchived(52000, 4100, ChannelTag.haramStuff, 12),
    _MockArchived(240000, 61000, ChannelTag.irrelevant, 12),
  ];

  @override
  Future<ChannelStats> load(ChannelStatsQuery query) async {
    final matching = [
      for (final c in _seed)
        if ((query.country == null || c.country == query.country) &&
            (query.tag == null || c.tags.contains(query.tag)) &&
            (query.stage == null || c.stage == query.stage) &&
            (query.vetting == null || c.vetting == query.vetting) &&
            (query.minSubscribers == null ||
                (c.subscribers ?? -1) >= query.minSubscribers!) &&
            (query.maxSubscribers == null ||
                (c.subscribers != null &&
                    c.subscribers! <= query.maxSubscribers!)) &&
            (query.minMedianViews == null ||
                (c.medianViews != null &&
                    c.medianViews! >= query.minMedianViews!)) &&
            (query.maxMedianViews == null ||
                (c.medianViews != null &&
                    c.medianViews! <= query.maxMedianViews!)) &&
            (query.minVideosLast30 == null ||
                c.videosLast30 >= query.minVideosLast30!))
          c,
    ];

    // The archive's parallel population — the second color the tier, view-tier
    // and tag charts draw. It carries only subscriber count, a lifetime
    // average-views mean and the rejecting label, so a filter on country, stage,
    // vetting or upload recency empties it, exactly as the SQL function's `a`
    // CTE does.
    final archived = (query.country != null ||
            query.stage != null ||
            query.vetting != null ||
            query.minVideosLast30 != null)
        ? const <_MockArchived>[]
        : [
            for (final r in _archiveSeed)
              if ((query.tag == null || r.label == query.tag) &&
                  (query.minSubscribers == null ||
                      r.subscribers >= query.minSubscribers!) &&
                  (query.maxSubscribers == null ||
                      r.subscribers <= query.maxSubscribers!) &&
                  (query.minMedianViews == null ||
                      r.medianViews >= query.minMedianViews!) &&
                  (query.maxMedianViews == null ||
                      r.medianViews <= query.maxMedianViews!))
                r,
          ];
    final archivedViews = [for (final r in archived) r.medianViews];
    int archivedInTier(int lo, int hi, int Function(_MockArchived) pick) =>
        archived.where((r) {
          final v = pick(r);
          return v >= lo && v <= hi;
        }).length;

    final subs = [
      for (final c in matching)
        if (c.subscribers != null) c.subscribers!,
    ]..sort();

    final views = [
      for (final c in matching)
        if (c.medianViews != null) c.medianViews!,
    ]..sort();

    // The archive-due subset of [matching] — still full live rows, so they get
    // split out of the same population rather than drawn from a second seed
    // the way [archived] is. See [StatBucket.archiveDue].
    final dueChannels = matching.where((c) => c.due).toList();
    final dueSubs = [
      for (final c in dueChannels)
        if (c.subscribers != null) c.subscribers!,
    ];
    final dueViews = [
      for (final c in dueChannels)
        if (c.medianViews != null) c.medianViews!,
    ];
    int dueInRange(List<int> values, int lo, int hi) =>
        values.where((v) => v >= lo && v <= hi).length;

    final archivedSubs = [for (final r in archived) r.subscribers];
    final archivedByLabel = <String, int>{};
    for (final r in archived) {
      archivedByLabel[r.label.wire] = (archivedByLabel[r.label.wire] ?? 0) + 1;
    }

    return ChannelStats(
      channels: matching.length,
      withSubscribers: subs.length,
      totalSubscribers: subs.fold(0, (sum, value) => sum + value),
      meanSubscribers: subs.isEmpty
          ? null
          : subs.fold(0, (sum, value) => sum + value) ~/ subs.length,
      medianSubscribers: subs.isEmpty ? null : subs[subs.length ~/ 2],
      maxSubscribers: subs.isEmpty ? null : subs.last,
      videosLast30: matching.fold(0, (sum, c) => sum + c.videosLast30),
      medianViews: views.isEmpty
          ? null
          : views.fold(0, (sum, value) => sum + value) ~/ views.length,
      withMedianViews: views.length,
      withADeal: matching.where((c) => c.stage == PipelineStage.paid).length,
      withoutCountry: matching.where((c) => c.country == null).length,
      byTier: [
        for (final tier in _tiers)
          StatBucket(
            key: tier.key,
            // Empty tiers are kept, at zero — the gap between two populated
            // tiers is information, and a histogram that omits it draws a
            // smooth distribution that is not there. `subs` counts every
            // matching channel, archive-due ones included, so their count is
            // subtracted back out here the same way [_tally] does.
            count: subs
                    .where((value) => value >= tier.lo && value <= tier.hi)
                    .length -
                dueInRange(dueSubs, tier.lo, tier.hi),
            archiveDue: dueInRange(dueSubs, tier.lo, tier.hi),
            archived: archivedInTier(tier.lo, tier.hi, (r) => r.subscribers),
          ),
      ],
      byCountry: _tally(
        [
          for (final c in matching)
            if (c.country != null) c.country!,
        ],
        dueValues: [
          for (final c in dueChannels)
            if (c.country != null) c.country!,
        ],
      ),
      byStage: _tally(
        [for (final c in matching) c.stage.wire],
        dueValues: [for (final c in dueChannels) c.stage.wire],
      ),
      byVetting: _tally(
        [for (final c in matching) c.vetting.name],
        dueValues: [for (final c in dueChannels) c.vetting.name],
      ),
      byTag: _tally(
        [
          for (final c in matching)
            for (final tag in c.tags) tag.wire,
        ],
        dueValues: [
          for (final c in dueChannels)
            for (final tag in c.tags) tag.wire,
        ],
        archivedByKey: archivedByLabel,
      ),
      byMonth: _months(matching, dueChannels, archived),
      byViewTier: [
        for (final tier in _tiers)
          StatBucket(
            key: tier.key,
            count: views
                    .where((value) => value >= tier.lo && value <= tier.hi)
                    .length -
                dueInRange(dueViews, tier.lo, tier.hi),
            archiveDue: dueInRange(dueViews, tier.lo, tier.hi),
            archived: archivedInTier(tier.lo, tier.hi, (r) => r.medianViews),
          ),
      ],
      archivedChannels: archived.length,
      archivedWithSubscribers: archivedSubs.length,
      archivedTotalSubscribers:
          archivedSubs.fold(0, (sum, value) => sum + value),
      archivedWithMedianViews: archivedViews.length,
      archivedMedianViews: archivedViews.isEmpty
          ? null
          : archivedViews.fold(0, (sum, value) => sum + value) ~/
              archivedViews.length,
      archiveDueChannels: dueChannels.length,
      archiveDueTotalSubscribers: dueSubs.fold(0, (sum, value) => sum + value),
      archiveDueMedianViews: dueViews.isEmpty
          ? null
          : dueViews.fold(0, (sum, value) => sum + value) ~/ dueViews.length,
    );
  }

  @override
  Future<ChannelStatsFacets> facets() async => ChannelStatsFacets(
        countries: {
          for (final c in _seed)
            if (c.country != null) c.country!,
        }.toList()
          ..sort(),
        stages: {for (final c in _seed) c.stage}.toList()
          ..sort((a, b) => a.index.compareTo(b.index)),
        vetting: {for (final c in _seed) c.vetting}.toList()
          ..sort((a, b) => a.index.compareTo(b.index)),
        tags: {
          for (final c in _seed) ...c.tags,
        }.toList()
          ..sort((a, b) => a.index.compareTo(b.index)),
      );

  /// Descending by count, then by key — the same order the SQL asks Postgres
  /// for, so a bar that moves in production moves here too.
  ///
  /// [dueValues] is the same shape as [values], restricted to the archive-due
  /// subset of the same rows — see [StatBucket.archiveDue]. [archivedByKey],
  /// when given, folds an archived count in beside each live one: a key
  /// present only on the archived side still gets a row, and the order is by
  /// the full bar height (live + archived), matching the SQL function's
  /// `all_tags` FULL JOIN.
  static List<StatBucket> _tally(
    List<String> values, {
    List<String> dueValues = const [],
    Map<String, int> archivedByKey = const {},
  }) {
    final counts = <String, int>{};
    for (final value in values) {
      counts[value] = (counts[value] ?? 0) + 1;
    }
    final due = <String, int>{};
    for (final value in dueValues) {
      due[value] = (due[value] ?? 0) + 1;
    }
    final keys = {...counts.keys, ...archivedByKey.keys}.toList()
      ..sort((a, b) {
        final byCount = ((counts[b] ?? 0) + (archivedByKey[b] ?? 0))
            .compareTo((counts[a] ?? 0) + (archivedByKey[a] ?? 0));
        return byCount != 0 ? byCount : a.compareTo(b);
      });
    return [
      for (final key in keys)
        StatBucket(
          key: key,
          // `counts` tallies every matching row under this key, archive-due
          // ones included (that full figure is what the ORDER BY above runs
          // on) — [due] is subtracted back out so [StatBucket.count] and
          // [StatBucket.archiveDue] come out disjoint.
          count: (counts[key] ?? 0) - (due[key] ?? 0),
          archiveDue: due[key] ?? 0,
          archived: archivedByKey[key] ?? 0,
        ),
    ];
  }

  /// Twelve months ending this one, empty ones included — the seed's `month`
  /// field is a 1-based offset from the oldest of those twelve. [dueChannels]
  /// is the archive-due subset of [matching], counted per month the same way.
  /// [archived] stacks the rejected population's per-month count alongside the
  /// live one, off the same `month` field, matching the SQL function's
  /// `archive_months`.
  static List<StatBucket> _months(
    List<_MockChannel> matching,
    List<_MockChannel> dueChannels,
    List<_MockArchived> archived,
  ) {
    final now = DateTime.now();
    return [
      for (var index = 1; index <= 12; index++)
        StatBucket(
          key: _monthKey(DateTime(now.year, now.month - 12 + index)),
          // `matching` counts every channel found that month, archive-due
          // ones included — subtracted back out here, as [_tally] does.
          count: matching.where((c) => c.month == index).length -
              dueChannels.where((c) => c.month == index).length,
          archiveDue: dueChannels.where((c) => c.month == index).length,
          archived: archived.where((r) => r.month == index).length,
        ),
    ];
  }

  static String _monthKey(DateTime date) =>
      '${date.year.toString().padLeft(4, '0')}-'
      '${date.month.toString().padLeft(2, '0')}';

  /// Shared by both histograms — the subscriber one and the view one are cut at
  /// the same boundaries so they can be read against each other. See
  /// [ChannelStats.byViewTier].
  static const _tiers = <({String key, int lo, int hi})>[
    (key: '<10K', lo: 0, hi: 9999),
    (key: '10K-50K', lo: 10000, hi: 49999),
    (key: '50K-100K', lo: 50000, hi: 99999),
    (key: '100K-500K', lo: 100000, hi: 499999),
    (key: '500K-1M', lo: 500000, hi: 999999),
    (key: '1M+', lo: 1000000, hi: 9223372036854775807),
  ];
}

class _MockChannel {
  const _MockChannel(this.subscribers, this.country, this.stage, this.vetting,
      this.tags, this.month, this.videosLast30, this.medianViews,
      {this.due = false});

  /// Null when the owner hides it — not zero. The same distinction the real
  /// column makes.
  final int? subscribers;
  final String? country;
  final PipelineStage stage;
  final VettingStatus vetting;
  final List<ChannelTag> tags;

  /// 1-based, within the twelve-month window the chart covers.
  final int month;
  final int videosLast30;

  /// Mean views per video over the last 30 days, or null where we have never
  /// measured it — not zero, the same distinction [subscribers] makes.
  final int? medianViews;

  /// Whether this row is counting down to being archived
  /// (`archive_due_at IS NOT NULL`) — still a full live row, unlike anything in
  /// [MockChannelStatsRepository._archiveSeed]. See [StatBucket.archiveDue].
  final bool due;
}

/// One rejected channel, reduced to what `channel_archive` actually keeps: a
/// subscriber count, a lifetime average-views mean, and the rejecting label.
///
/// Seeded across a couple of tiers and both rejecting labels so the second
/// color shows up on the subscriber, view-tier and tag charts against the
/// mock population — a broken two-series bar and an absent one look identical.
class _MockArchived {
  const _MockArchived(
      this.subscribers, this.medianViews, this.label, this.month);

  final int subscribers;
  final int medianViews;
  final ChannelTag label;

  /// 1-based, within the twelve-month window the chart covers — the month the
  /// channel was found, mirrored from `channel_archive.found_at`.
  final int month;
}
