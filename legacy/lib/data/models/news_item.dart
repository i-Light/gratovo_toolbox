/// One feed the team follows for a niche.
///
/// The feed list is shared, not per-person: everyone works the same niches, and
/// a source one person found useful is one the rest should see. It lives in the
/// database for the same reason.
class NewsSource {
  const NewsSource({
    required this.id,
    required this.feedUrl,
    required this.enabled,
    this.title,
    this.niche,
    this.lastFetchedAt,
    this.lastFetchStatus,
    this.lastFetchError,
  });

  final String id;
  final String feedUrl;

  /// Taken from the feed itself on the first successful fetch, so a source
  /// added as a bare URL names itself afterwards.
  final String? title;

  /// Which niche this feed covers, for filtering when the team works more than
  /// one vertical. Null means it is not tied to one.
  final String? niche;

  final bool enabled;

  final DateTime? lastFetchedAt;

  /// 'success' or 'failed', as last recorded by the fetcher.
  final String? lastFetchStatus;

  /// Why the last fetch failed, in words meant for whoever added the feed.
  /// Surfaced in the UI rather than logged, because a feed that has quietly
  /// started failing is otherwise indistinguishable from one with no news.
  final String? lastFetchError;

  bool get isFailing => lastFetchStatus == 'failed';

  /// Best display name: the feed's own title, else its host, else the raw URL.
  /// The host rather than the whole URL because "tubefilter.com" identifies a
  /// source and "https://www.tubefilter.com/feed/" is mostly punctuation.
  String get displayName {
    if (title != null && title!.trim().isNotEmpty) return title!.trim();
    return Uri.tryParse(feedUrl)?.host.replaceFirst('www.', '') ?? feedUrl;
  }
}

/// One story from a [NewsSource].
class NewsItem {
  const NewsItem({
    required this.id,
    required this.sourceId,
    required this.guid,
    required this.title,
    this.link,
    this.summary,
    this.author,
    this.imageUrl,
    this.publishedAt,
  });

  final String id;
  final String sourceId;

  /// The feed's own identifier for this story — RSS `<guid>`, Atom `<id>`, or
  /// the link when it has neither. Unique in the database, which is what stops
  /// every refresh from duplicating the whole feed.
  final String guid;

  final String title;
  final String? link;
  final String? summary;
  final String? author;
  final String? imageUrl;

  /// Null for a feed that omits a date or sends one no parser agrees on. Left
  /// null rather than defaulted to the fetch time: an item stamped "now" sorts
  /// to the top of the page and stays there, re-stamped, on every refresh.
  final DateTime? publishedAt;
}
