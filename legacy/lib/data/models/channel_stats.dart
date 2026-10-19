import 'package:gratovo_toolbox/data/models/influencer.dart';

/// One bar: a label, a live count, and — where the breakdown can carry it — the
/// same count over the archive.
///
/// [key] is the raw value out of the database — a country code, a
/// `pipeline_stage` wire value, a subscriber-tier label — not a translated
/// string. Turning it into something a person reads is the widget's job, which
/// is what keeps this model usable from a test and from the Arabic build
/// without either of them going through a `BuildContext`.
class StatBucket {
  const StatBucket({
    required this.key,
    required this.count,
    this.archiveDue = 0,
    this.archived = 0,
  });

  final String key;

  /// Channels still in `channels`, truly live — `archive_due_at IS NULL`.
  /// Disjoint from [archiveDue]: a channel counting down to archival is
  /// counted there instead, not here, so the two can be read (and toggled) as
  /// separate populations rather than one nested inside the other.
  final int count;

  /// Channels still in `channels` but counting down to being archived —
  /// `archive_due_at IS NOT NULL`. Unlike [archived], this is available on
  /// every breakdown: an archive-due channel is a full row with every column
  /// still on it, not the handful of facts a `channel_archive` tombstone
  /// keeps.
  final int archiveDue;

  /// Rejected channels reduced to a `channel_archive` row that fall in this
  /// same bucket, drawn stacked after [count] and [archiveDue] in a third
  /// color.
  ///
  /// Zero on every breakdown the archive cannot answer, which is most of them:
  /// the archive keeps six facts per channel and country, pipeline stage and
  /// vetting status are not among them. See [ChannelStats.archivedChannels] for
  /// which charts carry a second series and why the rest cannot.
  final int archived;

  /// Live, plus archive-due, plus archived — what the bar is as long as, and
  /// the number the tooltip reports as the total. The three are disjoint
  /// populations, so this is a plain sum with nothing to double-count.
  int get total => count + archiveDue + archived;

  static StatBucket fromJson(Map<String, dynamic> json) => StatBucket(
        key: json['key']?.toString() ?? '',
        count: (json['count'] as num?)?.toInt() ?? 0,
        // Absent rather than zero on a breakdown with no archive side, and on
        // any response from a server whose `channel_stats` predates this — an
        // old backend keeps drawing correct live-only bars rather than erroring.
        archiveDue: (json['archive_due'] as num?)?.toInt() ?? 0,
        archived: (json['archived'] as num?)?.toInt() ?? 0,
      );
}

/// Everything the Dashboard's analytics section draws, from one `channel_stats`
/// call.
///
/// Every field is an answer about the *filtered* population, not the whole
/// table — [ChannelStatsQuery] is what narrowed it. Two of them are exceptions
/// worth knowing about before reading a chart:
///
///  * [byTag] sums to more than [channels], because a channel carrying two tags
///    is counted under both.
///  * [byCountry] is the top twelve and has no "other" bucket. [withoutCountry]
///    accounts for the channels YouTube never told us about; the rest of the
///    tail is simply not drawn, because an "other" bar taller than every named
///    one is what you get for pretending a long tail is a category.
///
/// Every non-`archived` field counts **live channels only** — rows still in
/// `channels`. The archive is reported alongside rather than folded in, because
/// the two populations answer different questions and adding them would silently
/// change what "Channels" on this page has always meant. See
/// [archivedChannels].
class ChannelStats {
  const ChannelStats({
    required this.channels,
    required this.withSubscribers,
    required this.totalSubscribers,
    required this.videosLast30,
    required this.withADeal,
    required this.withoutCountry,
    required this.byTier,
    required this.byCountry,
    required this.byStage,
    required this.byVetting,
    required this.byTag,
    required this.byMonth,
    required this.byViewTier,
    this.withMedianViews = 0,
    this.meanSubscribers,
    this.medianSubscribers,
    this.maxSubscribers,
    this.medianViews,
    this.archivedChannels = 0,
    this.archivedWithSubscribers = 0,
    this.archivedTotalSubscribers = 0,
    this.archivedWithMedianViews = 0,
    this.archivedMedianViews,
    this.archiveDueChannels = 0,
    this.archiveDueTotalSubscribers = 0,
    this.archiveDueMedianViews,
  });

  /// How many channels matched the filter. The denominator for everything else.
  final int channels;

  /// How many of those have a subscriber count at all. The averages below are
  /// over these, not over [channels] — a channel whose count YouTube hides is
  /// not a channel with zero subscribers, and averaging in the zero would
  /// understate every figure on the page in proportion to how many creators
  /// keep their counts private.
  final int withSubscribers;

  final int totalSubscribers;

  /// Null when nothing in the filtered set has a subscriber count.
  final int? meanSubscribers;

  /// Shown next to [meanSubscribers] rather than instead of it, because on this
  /// data they say genuinely different things: subscriber counts are heavily
  /// skewed, so one 4M channel pulls a mean of a thousand small ones up by
  /// thousands, and the median is the one that describes what a typical row in
  /// the list looks like.
  final int? medianSubscribers;

  final int? maxSubscribers;

  final int videosLast30;

  /// The average of the per-channel trailing-30-day MEDIAN view counts — one
  /// headline "how watched" number, robust to a single viral upload because
  /// every channel contributed a median. Null when no channel in the filtered
  /// set has one.
  final int? medianViews;

  /// How many of [channels] have a measured 30-day median view count. The
  /// rest are counted at zero by [byViewTier] — see that field — so this is
  /// what the chart's caption reports, not what its bars sum to.
  final int withMedianViews;

  final int withADeal;

  /// Channels whose country YouTube does not expose. Not a bar in [byCountry] —
  /// "unknown" is not a country, and drawing it as one would make it the
  /// largest market in most filters.
  final int withoutCountry;

  /// Subscriber tiers, in ascending order, with the empty ones kept.
  ///
  /// A tier with no channels is still drawn, at zero. The gap is information:
  /// "nothing between 100K and 500K" is a fact about the sourcing, and a
  /// histogram that silently omits empty buckets shows a smooth distribution
  /// that is not there.
  final List<StatBucket> byTier;

  /// The same six tiers as [byTier], over the 30-day median view count
  /// instead of over subscribers, and cut at the same boundaries on purpose:
  /// the two histograms are read against each other, and "are the channels we
  /// found actually watched in proportion to their audience" is only a question
  /// you can ask of them if a bar in one covers the same range as the bar under
  /// it in the other.
  ///
  /// Sums to [channels]: a channel with no measured median counts as zero and
  /// lands in `<10K`. This is the opposite of the rule [withSubscribers]
  /// follows, on purpose. A hidden subscriber count is missing data, but a
  /// missing median is — on any roster with the auto-clean rule on — almost
  /// always a channel the gate archived, or the sweep tagged, before its
  /// videos were ever fetched *because* it was too small to bother with.
  /// Leaving those out drew a bottom bar of a few hundred where the real
  /// population of dead-on-arrival channels was in the thousands, which is the
  /// one thing this chart is read for. [withMedianViews] still says how many
  /// were actually measured.
  final List<StatBucket> byViewTier;

  final List<StatBucket> byCountry;
  final List<StatBucket> byStage;
  final List<StatBucket> byVetting;

  /// Sums to more than [channels]; see the class comment.
  final List<StatBucket> byTag;

  /// Channels first seen per month, twelve months ending this one, in ascending
  /// order and with the empty months present at zero — so a quiet month is a
  /// gap in the line rather than a point the line skips straight over, which
  /// reads as activity that never happened.
  ///
  /// Carries an archived series now that [ArchivedChannel.foundAt] copies the
  /// channel's `first_seen_at` onto the tombstone: a rejected channel has a
  /// month to sit in, the same one it would have sat in while it was live. The
  /// archived side follows the same rule as every other breakdown — empty when
  /// the filter is on a column the archive does not keep (see [archivedChannels])
  /// — and the current-month bucket is what the "Found channels this month"
  /// figure reads.
  final List<StatBucket> byMonth;

  /// How many rejected channels the filter matched — rows in `channel_archive`,
  /// which is all that is left of a channel the team rejected fifteen days after
  /// the tag went on.
  ///
  /// Reported next to [channels] rather than added to it. They are a real part
  /// of what the pipeline found and leaving them out understates the work by
  /// however much of the roster has been rejected — but they are not channels
  /// anyone can act on, so folding them into the same number would quietly
  /// change what every figure on this page means.
  ///
  /// **Only four breakdowns carry an archived series**, because an archived row
  /// keeps a handful of facts and nothing else:
  ///
  ///  * [byTier] — from `channel_archive.subscribers`.
  ///  * [byViewTier] — from `channel_archive.median_views_last_30`, computed
  ///    over every stored video at archive time rather than the strict
  ///    trailing-30-day window the live column holds. A rejected channel is
  ///    usually dormant, so a strict window would be null for nearly all of
  ///    them; the section says so under the chart.
  ///  * [byTag] — from `channel_archive.label`, always `haramStuff` or
  ///    `irrelevant`, exactly one per row.
  ///  * [byMonth] — from `channel_archive.found_at`, the `first_seen_at` the
  ///    sweep copies onto the row.
  ///
  /// [byCountry], [byStage] and [byVetting] carry none, because the archive does
  /// not keep those columns — and a filter on any of them therefore matches no
  /// archived row at all, the same way `country = 'EG'` does not match a null
  /// country. So does [ChannelStatsQuery.minVideosLast30]: upload recency is not
  /// kept either. In each of those cases this is zero and the second color
  /// simply does not appear, rather than the charts inventing a number.
  ///
  /// [StatBucket.archiveDue] does not follow this restriction — it comes off
  /// [channels], not off the archive, so every breakdown carries it.
  final int archivedChannels;

  /// How many of [archivedChannels] have a subscriber count — the denominator
  /// [byTier]'s archived segments actually sum to, following the same rule
  /// [withSubscribers] does.
  final int archivedWithSubscribers;

  final int archivedTotalSubscribers;

  /// How many of [archivedChannels] have a measured median view count. The
  /// rest count at zero in [byViewTier]'s archived segments, the same way the
  /// live side treats them — and the archive is where most of them are, since
  /// the auto-clean gate tombstones a too-small channel before any of its
  /// videos are fetched.
  final int archivedWithMedianViews;

  /// The average of the archived rows' median view counts — measured over every
  /// stored video at archive time, a slightly wider window than [medianViews]
  /// (the strict trailing 30 days). Shown beside the live figure rather than
  /// folded into it. Null when no archived row in the filtered set has one.
  final int? archivedMedianViews;

  /// How many of [channels] are counting down to being archived —
  /// `archive_due_at IS NOT NULL`. A subset of [channels], the same way
  /// [StatBucket.archiveDue] is a subset of [StatBucket.count]; reported beside
  /// it rather than subtracted from it, for the same reason [archivedChannels]
  /// is reported beside [channels] instead of folded in.
  final int archiveDueChannels;

  final int archiveDueTotalSubscribers;

  /// The average of the archive-due rows' 30-day median view counts. Unlike
  /// [archivedMedianViews], this is the same strict trailing-30-day figure
  /// [medianViews] is — an archive-due channel is still a live row with a real
  /// rolling window, not a tombstone frozen at archive time. Null when no
  /// archive-due row in the filtered set has one.
  final int? archiveDueMedianViews;

  static const empty = ChannelStats(
    channels: 0,
    withSubscribers: 0,
    totalSubscribers: 0,
    videosLast30: 0,
    withADeal: 0,
    withoutCountry: 0,
    byTier: [],
    byCountry: [],
    byStage: [],
    byVetting: [],
    byTag: [],
    byMonth: [],
    byViewTier: [],
  );

  static ChannelStats fromJson(Map<String, dynamic> json) {
    List<StatBucket> buckets(String field) => [
          for (final item in (json[field] as List? ?? const []))
            if (item is Map)
              StatBucket.fromJson(Map<String, dynamic>.from(item)),
        ];
    int asInt(String field) => (json[field] as num?)?.toInt() ?? 0;
    int? asNullableInt(String field) => (json[field] as num?)?.toInt();

    return ChannelStats(
      channels: asInt('channels'),
      withSubscribers: asInt('with_subscribers'),
      totalSubscribers: asInt('total_subscribers'),
      meanSubscribers: asNullableInt('mean_subscribers'),
      medianSubscribers: asNullableInt('median_subscribers'),
      maxSubscribers: asNullableInt('max_subscribers'),
      videosLast30: asInt('videos_last_30'),
      medianViews: asNullableInt('median_views'),
      withMedianViews: asInt('with_median_views'),
      withADeal: asInt('with_a_deal'),
      withoutCountry: asInt('without_country'),
      byTier: buckets('by_tier'),
      byCountry: buckets('by_country'),
      byStage: buckets('by_stage'),
      byVetting: buckets('by_vetting'),
      byTag: buckets('by_tag'),
      byMonth: buckets('by_month'),
      byViewTier: buckets('by_view_tier'),
      // Defaulted rather than required, so a client pointed at a database whose
      // `channel_stats` has not been migrated yet draws the live bars it always
      // did instead of failing to parse.
      archivedChannels: asInt('archived_channels'),
      archivedWithSubscribers: asInt('archived_with_subscribers'),
      archivedTotalSubscribers: asInt('archived_total_subscribers'),
      archivedWithMedianViews: asInt('archived_with_median_views'),
      archivedMedianViews: asNullableInt('archived_median_views'),
      archiveDueChannels: asInt('archive_due_channels'),
      archiveDueTotalSubscribers: asInt('archive_due_total_subscribers'),
      archiveDueMedianViews: asNullableInt('archive_due_median_views'),
    );
  }
}

/// What the analytics section is currently narrowed to.
///
/// Null means "no constraint" for every field, the same vocabulary
/// [InfluencerQuery] uses and for the same reason: a minimum of zero and no
/// minimum at all are different questions even where they happen to return the
/// same rows today.
///
/// Value equality matters here more than usual — this is a Riverpod family key,
/// and without it every rebuild would hand over an identical-but-new instance
/// and re-run an aggregate over the whole channel table.
class ChannelStatsQuery {
  const ChannelStatsQuery({
    this.country,
    this.tag,
    this.stage,
    this.vetting,
    this.minSubscribers,
    this.maxSubscribers,
    this.minMedianViews,
    this.maxMedianViews,
    this.minVideosLast30,
  });

  /// ISO-3166 alpha-2, as the pipeline stores it.
  final String? country;

  final ChannelTag? tag;
  final PipelineStage? stage;
  final VettingStatus? vetting;

  final int? minSubscribers;
  final int? maxSubscribers;

  /// Bounds on the trailing-30-day median view count. `null` on either side is
  /// "no limit there" — distinct from a limit of zero, the same as every other
  /// field here. An unmeasured channel is bounded as zero, the same way
  /// [ChannelStats.byViewTier] buckets it, so a bound selects the rows the
  /// bar it corresponds to counts.
  final int? minMedianViews;
  final int? maxMedianViews;

  /// Only channels with at least this many uploads in the last 30 days. Replaces
  /// what used to be a boolean "uploaded at all" toggle — a floor of 1 is that
  /// same question.
  final int? minVideosLast30;

  bool get isUnfiltered =>
      country == null &&
      tag == null &&
      stage == null &&
      vetting == null &&
      minSubscribers == null &&
      maxSubscribers == null &&
      minMedianViews == null &&
      maxMedianViews == null &&
      minVideosLast30 == null;

  /// Like [isUnfiltered] inverted, but a min-bound of zero does not count: the
  /// stepped number fields commit `0` rather than `null` when cleared down to
  /// the floor, and a floor of zero excludes nothing. Used to decide whether to
  /// flag the analytics section as filtered.
  bool get hasEffectiveFilter =>
      country != null ||
      tag != null ||
      stage != null ||
      vetting != null ||
      (minSubscribers ?? 0) != 0 ||
      maxSubscribers != null ||
      (minMedianViews ?? 0) != 0 ||
      maxMedianViews != null ||
      minVideosLast30 != null;

  int get activeFilterCount => [
        country != null,
        tag != null,
        stage != null,
        vetting != null,
        minSubscribers != null,
        maxSubscribers != null,
        minMedianViews != null,
        maxMedianViews != null,
        minVideosLast30 != null,
      ].where((active) => active).length;

  /// Every nullable field takes a `T? Function()?`, because "null means no
  /// constraint" leaves a plain `T?` with no way to express *clearing* a
  /// filter — the single most common thing anyone does to one.
  ChannelStatsQuery copyWith({
    String? Function()? country,
    ChannelTag? Function()? tag,
    PipelineStage? Function()? stage,
    VettingStatus? Function()? vetting,
    int? Function()? minSubscribers,
    int? Function()? maxSubscribers,
    int? Function()? minMedianViews,
    int? Function()? maxMedianViews,
    int? Function()? minVideosLast30,
  }) {
    return ChannelStatsQuery(
      country: country != null ? country() : this.country,
      tag: tag != null ? tag() : this.tag,
      stage: stage != null ? stage() : this.stage,
      vetting: vetting != null ? vetting() : this.vetting,
      minSubscribers:
          minSubscribers != null ? minSubscribers() : this.minSubscribers,
      maxSubscribers:
          maxSubscribers != null ? maxSubscribers() : this.maxSubscribers,
      minMedianViews:
          minMedianViews != null ? minMedianViews() : this.minMedianViews,
      maxMedianViews:
          maxMedianViews != null ? maxMedianViews() : this.maxMedianViews,
      minVideosLast30:
          minVideosLast30 != null ? minVideosLast30() : this.minVideosLast30,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is ChannelStatsQuery &&
      other.country == country &&
      other.tag == tag &&
      other.stage == stage &&
      other.vetting == vetting &&
      other.minSubscribers == minSubscribers &&
      other.maxSubscribers == maxSubscribers &&
      other.minMedianViews == minMedianViews &&
      other.maxMedianViews == maxMedianViews &&
      other.minVideosLast30 == minVideosLast30;

  @override
  int get hashCode => Object.hash(country, tag, stage, vetting, minSubscribers,
      maxSubscribers, minMedianViews, maxMedianViews, minVideosLast30);
}

/// The values the analytics filters offer.
///
/// Read from the data rather than from the enums, so the country dropdown lists
/// the twelve countries the agency has actually found channels in instead of
/// all 249 — the same rule [InfluencerRepository.getCountries] follows for the
/// influencer list.
///
/// Deliberately NOT narrowed by the current filter: these are the options, and
/// a dropdown that drops the option you are currently filtered to is a dropdown
/// you cannot get back out of.
class ChannelStatsFacets {
  const ChannelStatsFacets({
    this.countries = const [],
    this.stages = const [],
    this.vetting = const [],
    this.tags = const [],
  });

  final List<String> countries;
  final List<PipelineStage> stages;
  final List<VettingStatus> vetting;
  final List<ChannelTag> tags;

  static const empty = ChannelStatsFacets();

  static ChannelStatsFacets fromJson(Map<String, dynamic> json) {
    List<String> strings(String field) => [
          for (final item in (json[field] as List? ?? const []))
            if (item != null) item.toString(),
        ];

    return ChannelStatsFacets(
      countries: strings('countries'),
      // Unrecognized wire values are dropped rather than mapped to a default.
      // A facet list is a list of things to offer, and offering a filter that
      // matches nothing is worse than not offering it.
      stages: [
        for (final wire in strings('stages'))
          if (_stageFromWire(wire) case final stage?) stage,
      ],
      vetting: [
        for (final wire in strings('vetting'))
          if (_vettingFromWire(wire) case final status?) status,
      ],
      tags: [
        for (final wire in strings('tags'))
          if (ChannelTag.fromWire(wire) case final tag?) tag,
      ],
    );
  }

  /// [PipelineStage.fromWire] cannot be used here: it falls back to `isNew` for
  /// anything it does not recognize, which is right when reading a channel row
  /// and wrong when building a list of options — it would turn one bad value
  /// into a duplicate "New" entry.
  static PipelineStage? _stageFromWire(String wire) {
    for (final stage in PipelineStage.values) {
      if (stage.wire == wire) return stage;
    }
    return null;
  }

  static VettingStatus? _vettingFromWire(String wire) {
    for (final status in VettingStatus.values) {
      if (status.name == wire) return status;
    }
    return null;
  }
}
