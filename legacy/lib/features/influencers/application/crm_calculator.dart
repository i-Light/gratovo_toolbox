import 'package:gratovo_toolbox/data/models/video.dart';

/// One niche's CPM range, USD per thousand views.
class NicheCpm {
  const NicheCpm(this.key, this.low, this.high);

  final String key;
  final int low;
  final int high;
}

/// House choice HC-05: the owner's niche CPM table — the widest of both
/// course ranges. A person picks the number; the helper shows the range.
const List<NicheCpm> kNicheCpmRanges = [
  NicheCpm('tech', 20, 50),
  NicheCpm('finance', 15, 80),
  NicheCpm('fitness', 10, 35),
  NicheCpm('entertainment', 5, 20),
  NicheCpm('gaming', 10, 20),
  NicheCpm('beauty', 10, 25),
  NicheCpm('travel', 12, 20),
  NicheCpm('education', 25, 40),
  NicheCpm('food', 10, 20),
  NicheCpm('luxury', 30, 50),
];

/// The agency's niche is AI, which prices as tech.
const NicheCpm kDefaultCpmNiche = NicheCpm('tech', 20, 50);

/// What a set of chosen videos says about what a channel is worth.
///
/// Deliberately a pure value computed from an explicit list, not from "the
/// channel's recent videos". Which videos belong in the basis is a judgement
/// call a human has to make — a viral outlier, a community post, a video from
/// before the channel changed direction — and a calculator that silently
/// decides for you produces a number nobody can defend to a brand.
class CrmEstimate {
  const CrmEstimate({
    required this.includedCount,
    required this.excludedCount,
    required this.unusableCount,
    required this.totalViews,
    required this.averageViews,
    required this.medianViews,
    required this.minViews,
    required this.maxViews,
    required this.spanDays,
    required this.uploadsPerMonth,
  });

  /// Videos actually in the basis.
  final int includedCount;

  /// Videos the user deselected.
  final int excludedCount;

  /// Videos that CANNOT be in the basis because they have no view count —
  /// which is not the same thing as being deselected, and is common in this
  /// data. Surfaced separately so a thin basis is visibly thin rather than
  /// looking like a confident average over everything.
  final int unusableCount;

  final int totalViews;
  final double averageViews;

  /// The middle value. Shown next to the mean because they diverge exactly
  /// when it matters: one video at 10x the others pulls the mean far above
  /// what the next upload will realistically do, and the gap between the two
  /// numbers is the warning.
  final double medianViews;

  final int minViews;
  final int maxViews;

  /// Days between the oldest and newest included upload. Null when fewer than
  /// two included videos have a date, because a span needs two points.
  final int? spanDays;

  /// Uploads per 30 days across that span, or null when [spanDays] is.
  final double? uploadsPerMonth;

  bool get isEmpty => includedCount == 0;

  /// How far the mean sits above the median, as a fraction of the median.
  ///
  /// The practical read: above about 0.25 the average is being carried by one
  /// or two outliers and the median is the safer number to quote.
  double get skew {
    if (medianViews <= 0) return 0;
    return (averageViews - medianViews) / medianViews;
  }

  /// Cost per mille at a given price — the number the whole calculator is for.
  /// Uses the median rather than the mean, for the reason above.
  double? cpmAt(num price) {
    if (medianViews <= 0) return null;
    return price / (medianViews / 1000);
  }

  /// What a video would cost at a target CPM.
  double? priceAtCpm(num cpm) {
    if (medianViews <= 0) return null;
    return (medianViews / 1000) * cpm;
  }

  static const empty = CrmEstimate(
    includedCount: 0,
    excludedCount: 0,
    unusableCount: 0,
    totalViews: 0,
    averageViews: 0,
    medianViews: 0,
    minViews: 0,
    maxViews: 0,
    spanDays: null,
    uploadsPerMonth: null,
  );
}

/// Computes a [CrmEstimate] over [all] videos, counting only those whose ids
/// are in [includedIds] and which actually have a view count.
///
/// A video with no view count is never silently treated as zero views. That is
/// the single most important rule here: 379 of the 695 videos in this project's
/// data have no view count, and averaging zeros in would understate every
/// channel that was fetched before the pipeline collected statistics — quietly,
/// and in the direction that loses money on a quote.
CrmEstimate computeCrmEstimate({
  required List<Video> all,
  required Set<String> includedIds,
}) {
  final usable = <Video>[];
  var unusable = 0;
  var excluded = 0;

  for (final video in all) {
    if (!includedIds.contains(video.id)) {
      excluded++;
      continue;
    }
    if (video.viewCount == null) {
      unusable++;
      continue;
    }
    usable.add(video);
  }

  if (usable.isEmpty) {
    return CrmEstimate(
      includedCount: 0,
      excludedCount: excluded,
      unusableCount: unusable,
      totalViews: 0,
      averageViews: 0,
      medianViews: 0,
      minViews: 0,
      maxViews: 0,
      spanDays: null,
      uploadsPerMonth: null,
    );
  }

  final views = [for (final v in usable) v.viewCount!]..sort();
  final total = views.fold<int>(0, (sum, v) => sum + v);
  final median = views.length.isOdd
      ? views[views.length ~/ 2].toDouble()
      : (views[views.length ~/ 2 - 1] + views[views.length ~/ 2]) / 2;

  // Dates come only from the videos that have one; a fetch that failed left
  // some included videos dateless, and treating those as the epoch would
  // report a span of decades.
  final dates = [
    for (final v in usable)
      if (v.publishedAt != null) v.publishedAt!,
  ]..sort();

  int? spanDays;
  double? uploadsPerMonth;
  if (dates.length >= 2) {
    spanDays = dates.last.difference(dates.first).inDays;
    // A span of 0 (everything posted the same day) would divide by zero. One
    // day is the smallest honest denominator.
    uploadsPerMonth = usable.length / (spanDays == 0 ? 1 : spanDays) * 30;
  }

  return CrmEstimate(
    includedCount: usable.length,
    excludedCount: excluded,
    unusableCount: unusable,
    totalViews: total,
    averageViews: total / usable.length,
    medianViews: median,
    minViews: views.first,
    maxViews: views.last,
    spanDays: spanDays,
    uploadsPerMonth: uploadsPerMonth,
  );
}

/// The median per-video view count over every video that has one — the
/// "all stored videos" figure the influencer details page shows beside the
/// channel's trailing-30-day median. Discrete median (mean of the two middle
/// values, rounded, for an even count), the same shape the mirror uses so the
/// two sides of the app agree. Null when no video has a view count.
int? medianViewsAcrossVideos(List<Video> videos) {
  final views = [
    for (final v in videos)
      if (v.viewCount != null) v.viewCount!,
  ]..sort();
  if (views.isEmpty) return null;
  final mid = views.length ~/ 2;
  return views.length.isOdd
      ? views[mid]
      : ((views[mid - 1] + views[mid]) / 2).round();
}

/// The videos that should start out ticked.
///
/// Everything with a view count, and nothing without one. Starting from "all
/// usable videos" rather than "none" means the card shows a real number the
/// moment it opens; excluding the unusable ones means the count beside it is
/// honest about what that number is actually based on.
Set<String> defaultCrmSelection(List<Video> videos) {
  return {
    for (final video in videos)
      if (video.viewCount != null) video.id,
  };
}

/// How one deal price divides between the agency and the creator.
///
/// Separate from [CrmEstimate] on purpose: the estimate is about what the
/// channel does, the split is about what was agreed. They meet only at the
/// price, and keeping them apart means changing the commission never silently
/// moves a view figure.
class CommissionSplit {
  const CommissionSplit({
    required this.price,
    required this.percent,
    required this.yours,
    required this.theirs,
  });

  /// The whole deal price the brand pays.
  final double price;

  /// The agency's share, 0–100.
  final double percent;

  /// The agency's cut of [price].
  final double yours;

  /// What is left for the creator. Always `price - yours`, never rounded
  /// independently — two figures that are each rounded to the nearest unit can
  /// add up to something other than the price, and the one place this is read
  /// out loud is a conversation where that discrepancy gets noticed.
  final double theirs;
}

/// The split at [percent] of [price], or null when either is missing or out of
/// range.
///
/// Null rather than a clamped or zeroed result: a commission of 150% is a
/// typo, and showing "you earn 1.5x the deal" as though it were an answer is
/// worse than showing nothing while the user finishes typing.
CommissionSplit? computeCommissionSplit({
  required double? price,
  required double? percent,
}) {
  if (price == null || percent == null) return null;
  if (price < 0 || percent < 0 || percent > 100) return null;
  final yours = price * percent / 100;
  return CommissionSplit(
    price: price,
    percent: percent,
    yours: yours,
    theirs: price - yours,
  );
}
