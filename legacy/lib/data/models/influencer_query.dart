import 'package:gratovo_toolbox/data/models/influencer.dart';

/// How the Influencer Database list is sorted.
///
/// Every value here maps to a real column on the `influencer_rows` view, which
/// is the point: sorting has to happen in the database, not in Dart. Sorting a
/// page of fifty rows in memory sorts *that page*, not the list — which looks
/// right until the second page arrives holding a channel that should have been
/// on the first.
enum InfluencerSortBy {
  subscribers,
  recentActivity,
  medianViews,
  videosThisMonth,
  daysSinceLastDeal,
  discovered;

  /// The `influencer_rows` column this orders by.
  String get column => switch (this) {
        InfluencerSortBy.subscribers => 'subscribers',
        InfluencerSortBy.recentActivity => 'latest_upload_at',
        InfluencerSortBy.medianViews => 'median_views_last_30',
        InfluencerSortBy.videosThisMonth => 'videos_last_30',
        InfluencerSortBy.daysSinceLastDeal => 'days_since_last_deal',
        InfluencerSortBy.discovered => 'first_seen_at',
      };
}

/// Quick yes/no filters on the list (fix #10): each one checked narrows the
/// list to channels that have it.
enum InfluencerFlag {
  /// An email in the contacts, or one the pipeline found published (fix #11).
  hasEmail,

  /// Sponsorship disclosures in at least one stored video.
  sponsored,

  /// Vetting status "shortlisted".
  shortlisted,

  /// Media kit complete, a rate agreed, enough audience in the brand's
  /// countries, not out of scope — `PitchReadiness` in media_kit.dart.
  readyToPitch,

  /// Nothing sent to them yet (no outbound message in any of their threads).
  /// The Comms queue's "New outreach" asks for this, so creators already
  /// written to never crowd the window.
  neverContacted,
}

/// Where the search box looks for its text.
///
/// Names are what somebody usually means. The descriptions are for the other
/// question -- "which of these channels ever talked about X" -- which a name
/// cannot answer: a channel called "Omar's Kitchen" that reviews phones, or a
/// gaming channel whose videos keep mentioning a sponsor's category.
enum InfluencerSearchScope {
  /// The channel name and its handle.
  names,

  /// The channel's own About text.
  channelDescriptions,

  /// Any stored video's description. The slow one: it reads every stored
  /// video of every channel it has to rule out.
  videoDescriptions,
}

/// One page's worth of results, plus whether there is another page.
///
/// [hasMore] is derived from whether the database returned a full page rather
/// than from a total count. A `count: exact` on every scroll is a second query
/// over the whole table for a number the UI only uses as a boolean, and it
/// goes stale the moment a teammate's search run inserts a row.
class InfluencerPage {
  const InfluencerPage({required this.items, required this.hasMore});

  const InfluencerPage.empty()
      : items = const [],
        hasMore = false;

  final List<Influencer> items;
  final bool hasMore;
}

/// Everything the list can filter and sort by, as one value.
///
/// This travels to the repository and is translated into a single indexed
/// query, rather than the list fetching everything and narrowing it in Dart.
/// That was the old behaviour and it does not survive the data growing: it
/// pulls every channel over the wire to show fifty, and a "min subscribers"
/// filter that runs after the fetch cannot make the fetch smaller.
///
/// Null means "no constraint" for every field here, which is why the ranges
/// are nullable ints rather than defaulting to 0 — a minimum of 0 and no
/// minimum at all are the same result today but different queries, and only
/// one of them stays correct if a channel ever records a negative value.
class InfluencerQuery {
  const InfluencerQuery({
    this.search,
    this.searchIn = const {InfluencerSearchScope.names},
    this.includeCountries = const {},
    this.excludeCountries = const {},
    this.includeChannelTags = const {},
    this.excludeChannelTags = const {},
    this.includePipelineStages = const {},
    this.excludePipelineStages = const {},
    this.minSubscribers,
    this.maxSubscribers,
    this.minMedianViews,
    this.maxMedianViews,
    this.minDaysSinceLastDeal,
    this.maxDaysSinceLastDeal,
    this.requireFlags = const {},
    this.sortBy = InfluencerSortBy.subscribers,
    this.descending = true,
  });

  /// Matched case-insensitively against whatever [searchIn] names.
  final String? search;

  /// Where [search] looks; a channel matches when any of them has the text.
  /// Empty is read as names only -- a search box that searches nothing is
  /// not a state anybody means.
  final Set<InfluencerSearchScope> searchIn;

  /// ISO-3166 alpha-2 codes, matching what the pipeline stores. A channel
  /// matches when its country is in this set — empty means no constraint.
  /// Independent of [excludeCountries] rather than one flag flipping the
  /// other, because a country can only be in one of the two sets at once, but
  /// the two sets together can narrow on some countries while ruling out
  /// others in the same filter.
  final Set<String> includeCountries;

  /// Countries a channel must NOT be in. A channel with no known country
  /// always passes this — there is nothing here to exclude it for.
  final Set<String> excludeCountries;

  /// A channel matches when it carries at least one of these tags — empty
  /// means no constraint. OR within the set: "qualified or undecided" finds
  /// channels with either, not both.
  final Set<ChannelTag> includeChannelTags;

  /// Tags a channel must carry none of.
  final Set<ChannelTag> excludeChannelTags;

  final Set<PipelineStage> includePipelineStages;
  final Set<PipelineStage> excludePipelineStages;

  final int? minSubscribers;
  final int? maxSubscribers;

  /// Against `median_views_last_30` — the channel's trailing-30-day median
  /// per-video views, the sourcing signal that actually predicts a video's
  /// reach, unlike a subscriber count a dormant channel keeps forever.
  final int? minMedianViews;
  final int? maxMedianViews;

  /// Time since the last deal, in whole days. A channel that has never had a
  /// deal has no value here at all, so it matches neither bound — which is
  /// correct: "at least 90 days since the last deal" is a question about
  /// channels that have had one.
  final int? minDaysSinceLastDeal;
  final int? maxDaysSinceLastDeal;

  /// Every flag here must hold.
  final Set<InfluencerFlag> requireFlags;

  final InfluencerSortBy sortBy;
  final bool descending;

  /// True when nothing is constrained — the list uses this to decide whether
  /// to offer a "clear filters" affordance.
  bool get isUnfiltered =>
      (search == null || search!.trim().isEmpty) &&
      includeCountries.isEmpty &&
      excludeCountries.isEmpty &&
      includeChannelTags.isEmpty &&
      excludeChannelTags.isEmpty &&
      includePipelineStages.isEmpty &&
      excludePipelineStages.isEmpty &&
      minSubscribers == null &&
      maxSubscribers == null &&
      minMedianViews == null &&
      maxMedianViews == null &&
      minDaysSinceLastDeal == null &&
      maxDaysSinceLastDeal == null &&
      requireFlags.isEmpty;

  /// How many constraints are active, for the filter button's badge. Each of
  /// country/tag/stage counts once for the whole dimension — however many
  /// values are checked within it — rather than once per checked value, so
  /// narrowing to three countries does not make the badge claim three filters
  /// are doing three different jobs.
  int get activeFilterCount => [
        search != null && search!.trim().isNotEmpty,
        includeCountries.isNotEmpty || excludeCountries.isNotEmpty,
        includeChannelTags.isNotEmpty || excludeChannelTags.isNotEmpty,
        includePipelineStages.isNotEmpty || excludePipelineStages.isNotEmpty,
        minSubscribers != null,
        maxSubscribers != null,
        minMedianViews != null,
        maxMedianViews != null,
        minDaysSinceLastDeal != null,
        maxDaysSinceLastDeal != null,
        requireFlags.isNotEmpty,
      ].where((active) => active).length;

  /// The nullable int fields take a `T? Function()?` rather than a plain
  /// `T?`, because their vocabulary is "null means no constraint" — with a
  /// plain `T?` there would be no way to express *clearing* a filter, which
  /// is the single most common thing a user does to one. The set fields don't
  /// need that trick: a caller that wants to clear one passes an empty set,
  /// and `null` here always means "leave it as it is".
  InfluencerQuery copyWith({
    String? Function()? search,
    Set<InfluencerSearchScope>? searchIn,
    Set<String>? includeCountries,
    Set<String>? excludeCountries,
    Set<ChannelTag>? includeChannelTags,
    Set<ChannelTag>? excludeChannelTags,
    Set<PipelineStage>? includePipelineStages,
    Set<PipelineStage>? excludePipelineStages,
    int? Function()? minSubscribers,
    int? Function()? maxSubscribers,
    int? Function()? minMedianViews,
    int? Function()? maxMedianViews,
    int? Function()? minDaysSinceLastDeal,
    int? Function()? maxDaysSinceLastDeal,
    Set<InfluencerFlag>? requireFlags,
    InfluencerSortBy? sortBy,
    bool? descending,
  }) {
    return InfluencerQuery(
      search: search != null ? search() : this.search,
      searchIn: searchIn ?? this.searchIn,
      includeCountries: includeCountries ?? this.includeCountries,
      excludeCountries: excludeCountries ?? this.excludeCountries,
      includeChannelTags: includeChannelTags ?? this.includeChannelTags,
      excludeChannelTags: excludeChannelTags ?? this.excludeChannelTags,
      includePipelineStages:
          includePipelineStages ?? this.includePipelineStages,
      excludePipelineStages:
          excludePipelineStages ?? this.excludePipelineStages,
      minSubscribers:
          minSubscribers != null ? minSubscribers() : this.minSubscribers,
      maxSubscribers:
          maxSubscribers != null ? maxSubscribers() : this.maxSubscribers,
      minMedianViews:
          minMedianViews != null ? minMedianViews() : this.minMedianViews,
      maxMedianViews:
          maxMedianViews != null ? maxMedianViews() : this.maxMedianViews,
      minDaysSinceLastDeal: minDaysSinceLastDeal != null
          ? minDaysSinceLastDeal()
          : this.minDaysSinceLastDeal,
      maxDaysSinceLastDeal: maxDaysSinceLastDeal != null
          ? maxDaysSinceLastDeal()
          : this.maxDaysSinceLastDeal,
      requireFlags: requireFlags ?? this.requireFlags,
      sortBy: sortBy ?? this.sortBy,
      descending: descending ?? this.descending,
    );
  }

  static bool _setEquals<T>(Set<T> a, Set<T> b) =>
      a.length == b.length && a.every(b.contains);

  /// Value equality, so a Riverpod family keyed on a query reuses its cached
  /// page instead of re-fetching every time the widget rebuilds and hands over
  /// an identical-but-new instance.
  @override
  bool operator ==(Object other) =>
      other is InfluencerQuery &&
      other.search == search &&
      _setEquals(other.searchIn, searchIn) &&
      _setEquals(other.includeCountries, includeCountries) &&
      _setEquals(other.excludeCountries, excludeCountries) &&
      _setEquals(other.includeChannelTags, includeChannelTags) &&
      _setEquals(other.excludeChannelTags, excludeChannelTags) &&
      _setEquals(other.includePipelineStages, includePipelineStages) &&
      _setEquals(other.excludePipelineStages, excludePipelineStages) &&
      other.minSubscribers == minSubscribers &&
      other.maxSubscribers == maxSubscribers &&
      other.minMedianViews == minMedianViews &&
      other.maxMedianViews == maxMedianViews &&
      other.minDaysSinceLastDeal == minDaysSinceLastDeal &&
      other.maxDaysSinceLastDeal == maxDaysSinceLastDeal &&
      _setEquals(other.requireFlags, requireFlags) &&
      other.sortBy == sortBy &&
      other.descending == descending;

  @override
  int get hashCode => Object.hash(
        search,
        Object.hashAllUnordered(searchIn),
        Object.hashAllUnordered(includeCountries),
        Object.hashAllUnordered(excludeCountries),
        Object.hashAllUnordered(includeChannelTags),
        Object.hashAllUnordered(excludeChannelTags),
        Object.hashAllUnordered(includePipelineStages),
        Object.hashAllUnordered(excludePipelineStages),
        minSubscribers,
        maxSubscribers,
        minMedianViews,
        maxMedianViews,
        minDaysSinceLastDeal,
        maxDaysSinceLastDeal,
        sortBy,
        descending,
      );
}

/// The fields a manually added channel is created from.
///
/// Manual entry exists for the channel someone found by hand, off a
/// recommendation or a competitor's sponsor list, that no keyword search has
/// surfaced. Only [handle] is required — everything else is what the pipeline
/// would otherwise fill in, and a blank stays blank rather than becoming a
/// zero that looks like a real measurement.
class NewInfluencer {
  const NewInfluencer({
    required this.handle,
    this.channelId,
    this.name,
    this.channelUrl,
    this.country,
    this.subscriberCount,
    this.notes,
    this.channelTags = const [],
  });

  final String handle;

  /// YouTube's own `UC...` id, when whoever is adding the channel knows it.
  ///
  /// Worth asking for even though it is optional: the id is the primary key,
  /// so a manual row created without one gets a synthetic id, and the day the
  /// pipeline discovers that same channel under its real id it lands as a
  /// second row rather than merging into this one. Supplying it makes the
  /// manual entry and the eventual discovery the same channel.
  final String? channelId;

  final String? name;
  final String? channelUrl;
  final String? country;
  final int? subscriberCount;
  final String? notes;
  final List<ChannelTag> channelTags;
}
