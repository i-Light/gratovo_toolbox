import 'package:gratovo_toolbox/data/models/news_item.dart';
import 'package:gratovo_toolbox/data/repositories/news_repository.dart';

/// In-memory [NewsRepository], so the News page has something to show before
/// the backend is reachable — and so its empty, failing and disabled states are
/// all visible without waiting for a real feed to break.
class MockNewsRepository implements NewsRepository {
  final List<NewsSource> _sources = [
    NewsSource(
      id: 'src_1',
      feedUrl: 'https://www.tubefilter.com/feed/',
      title: 'Tubefilter',
      niche: 'creator economy',
      enabled: true,
      lastFetchedAt: DateTime.now().subtract(const Duration(hours: 2)),
      lastFetchStatus: 'success',
    ),
    NewsSource(
      id: 'src_2',
      feedUrl: 'https://influencermarketinghub.com/feed/',
      title: 'Influencer Marketing Hub',
      niche: 'influencer marketing',
      enabled: true,
      lastFetchedAt: DateTime.now().subtract(const Duration(hours: 2)),
      lastFetchStatus: 'success',
    ),
    // Deliberately included: a feed whose certificate expired is a real thing
    // that happened while this was built, and the page has to show it as
    // broken rather than as quiet.
    NewsSource(
      id: 'src_3',
      feedUrl: 'https://digiday.com/feed/',
      title: 'Digiday',
      niche: 'marketing',
      enabled: true,
      lastFetchedAt: DateTime.now().subtract(const Duration(hours: 2)),
      lastFetchStatus: 'failed',
      lastFetchError: 'could not reach it (certificate has expired)',
    ),
  ];

  late final List<NewsItem> _items = [
    NewsItem(
      id: 'itm_1',
      sourceId: 'src_1',
      guid: 'g1',
      title: 'Creator fund payouts double for short-form video',
      link: 'https://example.com/1',
      summary: 'Platforms are competing harder for short-form creators, and '
          'the per-thousand rates being quoted have moved sharply this quarter.',
      author: 'A Reporter',
      publishedAt: DateTime.now().subtract(const Duration(hours: 5)),
    ),
    NewsItem(
      id: 'itm_2',
      sourceId: 'src_2',
      guid: 'g2',
      title: 'What brands are actually paying for a mid-roll in 2026',
      link: 'https://example.com/2',
      summary: 'A survey of 400 sponsorships puts the median CPM well above '
          'last year, with the biggest movement in the 50k–200k subscriber band.',
      publishedAt: DateTime.now().subtract(const Duration(days: 1)),
    ),
    NewsItem(
      id: 'itm_3',
      sourceId: 'src_1',
      guid: 'g3',
      title: 'Disclosure rules tighten for paid partnerships',
      link: 'https://example.com/3',
      summary: 'The new guidance covers on-screen labelling as well as the '
          'description box.',
      publishedAt: DateTime.now().subtract(const Duration(days: 3)),
    ),
    // No date: the case that must sort last rather than first.
    const NewsItem(
      id: 'itm_4',
      sourceId: 'src_2',
      guid: 'g4',
      title: 'Undated explainer: how agencies structure a retainer',
      link: 'https://example.com/4',
    ),
  ];

  @override
  Future<List<NewsItem>> getItems({
    int limit = 50,
    int offset = 0,
    String? sourceId,
    String? niche,
  }) async {
    var matched = _items.toList();
    if (sourceId != null) {
      matched = matched.where((i) => i.sourceId == sourceId).toList();
    } else if (niche != null) {
      final ids = {
        for (final source in _sources)
          if (source.niche == niche) source.id,
      };
      matched = matched.where((i) => ids.contains(i.sourceId)).toList();
    }

    // Same ordering as the real query: newest first, undated last.
    matched.sort((a, b) {
      if (a.publishedAt == null && b.publishedAt == null) return 0;
      if (a.publishedAt == null) return 1;
      if (b.publishedAt == null) return -1;
      return b.publishedAt!.compareTo(a.publishedAt!);
    });

    final start = offset.clamp(0, matched.length);
    final end = (offset + limit).clamp(0, matched.length);
    return matched.sublist(start, end);
  }

  @override
  Future<int> countItems() async => _items.length;

  @override
  Future<void> clearItems() async => _items.clear();

  @override
  Future<List<NewsSource>> getSources() async => List.unmodifiable(_sources);

  @override
  Future<void> addSource({
    required String feedUrl,
    String? title,
    String? niche,
  }) async {
    if (_sources.any((s) => s.feedUrl == feedUrl.trim())) return;
    _sources.add(
      NewsSource(
        id: 'src_${_sources.length + 1}',
        feedUrl: feedUrl.trim(),
        title: title,
        niche: niche,
        enabled: true,
      ),
    );
  }

  @override
  Future<void> setSourceEnabled(String id, bool enabled) async {
    final index = _sources.indexWhere((s) => s.id == id);
    if (index == -1) return;
    final source = _sources[index];
    _sources[index] = NewsSource(
      id: source.id,
      feedUrl: source.feedUrl,
      title: source.title,
      niche: source.niche,
      enabled: enabled,
      lastFetchedAt: source.lastFetchedAt,
      lastFetchStatus: source.lastFetchStatus,
      lastFetchError: source.lastFetchError,
    );
  }

  @override
  Future<void> removeSource(String id) async {
    _sources.removeWhere((s) => s.id == id);
    _items.removeWhere((i) => i.sourceId == id);
  }
}
