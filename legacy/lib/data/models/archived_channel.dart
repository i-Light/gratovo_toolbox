import 'package:gratovo_toolbox/data/models/influencer.dart';

/// What is left of a channel the team rejected.
///
/// A handful of facts and two timestamps, and the shortness of that list is
/// the whole point rather than an oversight. A channel carrying a rejecting
/// tag (see [ChannelTag.rejecting]) is never going to be worked with, but it
/// keeps a row per upload — description, tags, thumbnail — for as long as it
/// exists. Videos are the bulk of this database, and rejected channels are
/// exactly the rows whose bulk buys nothing.
///
/// So 7 days after the tag goes on, the archive sweep (see
/// `local_archive.dart`) reduces the channel to this and deletes the rest,
/// here and — through the pipeline — in the bucket. There are no notes here,
/// no contacts, no description, and no way to get them back. This is a record
/// that a decision was made, not a copy of what the decision was made about.
///
/// It is also the tombstone: the pipeline consults `channel_archive` before
/// recording a discovery, so a later search that re-finds a rejected channel
/// does not quietly put it back in the list for somebody to vet all over again.
class ArchivedChannel {
  const ArchivedChannel({
    required this.channelId,
    required this.handle,
    required this.label,
    required this.archivedAt,
    this.subscriberCount,
    this.medianViewsLast30,
    this.medianBasis,
    this.videosFound,
    this.foundAt,
    this.foundVia = const [],
  });

  final String channelId;
  final String handle;

  /// Why it was rejected. Always one of [ChannelTag.rejecting] — the database's
  /// own check constraint allows nothing else. A channel carrying more than one
  /// is archived under the strongest, per that list's order
  /// (`haramStuff` > `irrelevant` > `inactive`).
  final ChannelTag label;

  final DateTime archivedAt;

  /// The count as the pipeline last read it, copied onto the tombstone at
  /// archive time so the Archive page can still say how big the channel was.
  final int? subscriberCount;

  /// The channel's median views as of the archive sweep, frozen onto the
  /// tombstone. [medianBasis] says which set it was taken over.
  ///
  /// The one derived number the archive keeps, and it keeps it because it
  /// cannot be recomputed: the videos it came from are deleted by the same
  /// sweep. The Dashboard's keyword evaluation reads it, so a search term is
  /// scored on what it found and not only on what survived vetting.
  ///
  /// Null when no stored video anywhere had a view count, when the channel
  /// was archived before any video was ever fetched (the auto-clean gate does
  /// that deliberately — see [videosFound]), or for rows archived before this
  /// was recorded.
  final int? medianViewsLast30;

  /// Which set [medianViewsLast30] was taken over — [ArchiveMedianBasis] as
  /// it is stored, or null when there is no median, or for rows written
  /// before this was recorded.
  ///
  /// Two channels' medians are only comparable when this agrees, which is why
  /// it is kept rather than inferred: the trailing-30-day figure is the one
  /// the influencer list shows, and an inactive channel has no videos in that
  /// window at all — its median is over everything stored, and the page says
  /// so rather than presenting the two as the same measurement.
  final String? medianBasis;

  /// How many of its videos were stored when it was archived — frozen for
  /// the same reason as [medianViewsLast30].
  ///
  /// Zero means the channel's videos were looked at and there were none. Null
  /// means nobody ever counted: no machine holding this channel's videos took
  /// part in archiving it, or — the ordinary case — the auto-clean gate
  /// rejected it on its subscriber count during a search, before a single
  /// video was fetched. The two must not look alike on the page; a blank is
  /// not a finding.
  final int? videosFound;

  /// When the pipeline first found this channel — its `first_seen_at`,
  /// [Influencer.discoveredAt] under another name, copied onto the archive row
  /// so a rejected channel still carries the one date the archive is asked for.
  /// Null for rows written before this was recorded.
  final DateTime? foundAt;

  /// Every keyword that ever led the pipeline to this channel (via
  /// `channel_keywords`, deleted along with the channel by the same sweep that
  /// wrote this row) and the handles-search limit that was in effect for each
  /// one's run. Oldest first. Empty for rows archived before this was recorded,
  /// or for a channel that was never linked to a keyword at all.
  final List<ArchiveKeywordHit> foundVia;

  ArchivedChannel copyWith({ChannelTag? label}) {
    return ArchivedChannel(
      channelId: channelId,
      handle: handle,
      label: label ?? this.label,
      archivedAt: archivedAt,
      subscriberCount: subscriberCount,
      medianViewsLast30: medianViewsLast30,
      medianBasis: medianBasis,
      videosFound: videosFound,
      foundAt: foundAt,
      foundVia: foundVia,
    );
  }

  /// The channel's URL, rebuilt from the handle rather than stored.
  ///
  /// Storing it would be a seventh field carrying no information: a YouTube
  /// handle and its URL are the same fact written twice, and the archive exists
  /// to hold the minimum.
  String get channelUrl {
    final trimmed = handle.trim();
    final at = trimmed.startsWith('@') ? trimmed : '@$trimmed';
    return 'https://www.youtube.com/$at';
  }
}

/// The sets [ArchivedChannel.medianViewsLast30] can have been taken over, as
/// `channel_archive.median_basis` stores them.
///
/// Strings rather than an enum at the boundary: the column is written by both
/// this app's sweep (`local_archive.dart`) and the pipeline
/// (`store.measure_archive_numbers`), and a value neither of them knows about
/// should render as "unstated" rather than crash a page whose whole job is to
/// still be readable years after the data behind it was deleted.
abstract final class ArchiveMedianBasis {
  /// The trailing 30 days — the same measurement the influencer list shows,
  /// anchored on when the channel's videos were last read.
  static const window30 = 'window30';

  /// Every stored video. Used when the 30-day window held nothing, which is
  /// what an inactive channel looks like and therefore most of this table.
  static const lifetime = 'lifetime';
}

/// One entry in [ArchivedChannel.foundVia] — a keyword that led to this
/// channel, and the handles-search limit the pipeline was running under when
/// that keyword was searched. See `channel_archive.found_via` in
/// `backend/schema.sql`.
class ArchiveKeywordHit {
  const ArchiveKeywordHit(
      {required this.keyword, this.limit, this.discoveredAt});

  final String keyword;

  /// The `handles_to_search_limit` in effect for this keyword's run — how many
  /// results the pipeline was told to pull before it stopped. Null for a
  /// keyword claimed before this was recorded.
  final int? limit;

  final DateTime? discoveredAt;
}

/// How the archive is sorted in the viewer.
enum ArchiveSortBy {
  archivedAt,
  handle,
  subscribers,
  medianViews,
  videosFound;

  /// The column this maps to on `channel_archive`. Sorting happens in the
  /// database, for the same reason it does on the influencer list: sorting one
  /// page in Dart sorts that page, not the list, which looks right until the
  /// second page arrives holding a row that belonged on the first.
  String get column => switch (this) {
        ArchiveSortBy.archivedAt => 'archived_at',
        ArchiveSortBy.handle => 'handle',
        ArchiveSortBy.subscribers => 'subscribers',
        ArchiveSortBy.medianViews => 'median_views_last_30',
        ArchiveSortBy.videosFound => 'videos_found_count',
      };
}

/// What the archive viewer is asking for.
class ArchiveQuery {
  const ArchiveQuery({
    this.search = '',
    this.label,
    this.sortBy = ArchiveSortBy.archivedAt,
    this.descending = true,
  });

  /// Matches the handle, case-insensitively. The handle is the only text the
  /// archive keeps, so it is the only thing there is to search.
  final String search;

  /// Null means both labels.
  final ChannelTag? label;

  final ArchiveSortBy sortBy;
  final bool descending;

  ArchiveQuery copyWith({
    String? search,
    ChannelTag? label,
    bool clearLabel = false,
    ArchiveSortBy? sortBy,
    bool? descending,
  }) {
    return ArchiveQuery(
      search: search ?? this.search,
      label: clearLabel ? null : (label ?? this.label),
      sortBy: sortBy ?? this.sortBy,
      descending: descending ?? this.descending,
    );
  }
}
