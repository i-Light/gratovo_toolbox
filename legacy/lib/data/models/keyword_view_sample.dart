/// One channel's trailing-30-day median view count, filed under one of the
/// keywords it was found by — the row the Dashboard's keyword evaluation
/// folds. A channel found by three keywords is three samples.
///
/// Every channel is a sample, and one with no measured median is a sample of
/// **zero** — the same rule the analytics view-tier chart follows. The score
/// this feeds is "does this keyword bring in channels people watch", and the
/// channels with no median are overwhelmingly the ones the auto-clean rule
/// archived or tagged before their videos were fetched, because they were too
/// small to be worth the scrape. Leaving those out let a keyword that sources
/// nothing but dead-on-arrival channels score on the handful that were
/// measured; counting them at zero puts them in the `<50K` tier, where the
/// score's log curve is what stops them from swamping it.
class KeywordViewSample {
  const KeywordViewSample({
    required this.keyword,
    required this.medianViews,
    this.pendingArchive = false,
  });

  final String keyword;
  final int medianViews;

  /// Whether the channel is counting down to being archived. Only meaningful
  /// for a live channel; an archived one is already past that.
  final bool pendingArchive;
}
