import 'package:gratovo_toolbox/data/models/news_item.dart';

/// How the News page reads industry feeds.
///
/// Note what is NOT here: fetching. The app never requests a publisher's feed
/// itself. The web build cannot — a browser will not read a cross-origin feed
/// and almost no publisher permits it — and having every client fetch would
/// mean one request per person per page open, and eight people looking at
/// eight slightly different lists. `pipeline/tools/news.py` fetches on the
/// trusted machine and stores the result; this reads what it stored.
abstract class NewsRepository {
  /// Stories, newest first. [sourceId] and [niche] narrow it; both null means
  /// everything.
  Future<List<NewsItem>> getItems({
    int limit = 50,
    int offset = 0,
    String? sourceId,
    String? niche,
  });

  /// How many stories are stored, across every feed and ignoring any filter.
  /// The News page uses this as the baseline for its "new since the last
  /// fetch" badge — a plain count is cheaper than pulling every row just to
  /// call `.length` on it.
  Future<int> countItems();

  /// Deletes every stored story, leaving the feeds themselves in place. The
  /// pipeline re-pulls all of them on the next fetch. This exists to force the
  /// "new since the last fetch" badge to a known state for testing; it is not
  /// part of normal use.
  Future<void> clearItems();

  /// Every configured feed, including disabled and failing ones — the page
  /// shows those deliberately, since a feed that has quietly stopped working
  /// is otherwise indistinguishable from one with no news.
  Future<List<NewsSource>> getSources();

  /// Adds a feed by URL. The title is filled in from the feed itself on the
  /// first successful fetch, so it is optional here.
  Future<void> addSource(
      {required String feedUrl, String? title, String? niche});

  Future<void> setSourceEnabled(String id, bool enabled);

  /// Removes a feed and, by cascade, every story it produced.
  Future<void> removeSource(String id);
}
