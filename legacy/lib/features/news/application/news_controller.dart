import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/news_item.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';

/// Which slice of the news the page is showing.
///
/// Source and niche are mutually exclusive rather than combined: a source
/// already belongs to exactly one niche, so filtering by both is either
/// redundant or contradictory, and offering it as two independent controls
/// invites the contradictory case.
class NewsFilter {
  const NewsFilter({this.sourceId, this.niche});

  final String? sourceId;
  final String? niche;

  bool get isUnfiltered => sourceId == null && niche == null;

  @override
  bool operator ==(Object other) =>
      other is NewsFilter && other.sourceId == sourceId && other.niche == niche;

  @override
  int get hashCode => Object.hash(sourceId, niche);
}

class NewsFilterNotifier extends Notifier<NewsFilter> {
  @override
  NewsFilter build() => const NewsFilter();

  void showAll() => state = const NewsFilter();

  void showSource(String sourceId) => state = NewsFilter(sourceId: sourceId);

  void showNiche(String niche) => state = NewsFilter(niche: niche);
}

final newsFilterProvider =
    NotifierProvider<NewsFilterNotifier, NewsFilter>(NewsFilterNotifier.new);

final newsSourcesProvider = FutureProvider<List<NewsSource>>(
  (ref) => ref.watch(newsRepositoryProvider).getSources(),
);

/// The niches that at least one configured feed covers, for the filter row.
/// Derived from the sources rather than kept as its own list, so a niche
/// disappears from the filter the moment its last feed is removed.
final newsNichesProvider = Provider<List<String>>((ref) {
  final sources = ref.watch(newsSourcesProvider).value ?? const [];
  final niches = <String>{
    for (final source in sources)
      if (source.niche != null && source.niche!.trim().isNotEmpty)
        source.niche!.trim(),
  };
  final sorted = niches.toList()..sort();
  return sorted;
});

final newsItemsProvider = FutureProvider<List<NewsItem>>((ref) {
  final filter = ref.watch(newsFilterProvider);
  return ref.watch(newsRepositoryProvider).getItems(
        limit: 100,
        sourceId: filter.sourceId,
        niche: filter.niche,
      );
});
