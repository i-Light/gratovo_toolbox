/// One recent upload from an [Influencer]'s channel, as last fetched by the
/// (Phase 6) refresh action on the Influencer Profile page.
///
/// Kept minimal on purpose — this is sourcing/personalization signal for
/// outreach, not a full video-analytics record.
class Video {
  const Video({
    required this.id,
    required this.title,
    required this.url,
    this.publishedAt,
    this.viewCount,
    this.thumbnail,
    this.description,
  });

  final String id;
  final String title;
  final String url;

  /// Null when the fetch of this video's metadata failed — which is real and
  /// common: 121 of the 360 videos in the first data import are in exactly
  /// this state, because their YouTube API call failed at the time (quota
  /// exhausted, or the video went private between discovery and fetch).
  /// Modelled as nullable rather than defaulted to a sentinel date so the UI
  /// can say "unknown" instead of confidently showing 1 January 1970, and so
  /// the CRM calculator can exclude them rather than averaging in zeros.
  final DateTime? publishedAt;

  /// Null for the same reason, and additionally for every video imported
  /// before the pipeline started requesting the `statistics` part.
  final int? viewCount;

  /// The upload's thumbnail URL. Both stores have carried this column since
  /// the beginning (`videos.thumbnail` in backend/schema.sql and in the
  /// pipeline's SQLite schema) — it simply was never read into Dart until the
  /// recent-videos card started showing it.
  final String? thumbnail;

  /// The video's own description. Same story as [thumbnail]: stored all along,
  /// read now because deciding whether an upload is worth mentioning in an
  /// outreach email is a judgement the title alone rarely settles.
  final String? description;
}
