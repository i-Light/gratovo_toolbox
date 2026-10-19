import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_news_repository.dart';

/// Covers the parts of the News contract that are easy to get wrong and hard
/// to notice: how an undated story sorts, and what filtering by niche means
/// when the niche belongs to the source rather than the story.
void main() {
  group('getItems ordering', () {
    test('returns stories newest first', () async {
      final items = await MockNewsRepository().getItems();
      final dated = [
        for (final item in items)
          if (item.publishedAt != null) item.publishedAt!,
      ];
      for (var i = 1; i < dated.length; i++) {
        expect(
          dated[i - 1].isAfter(dated[i]) ||
              dated[i - 1].isAtSameMomentAs(dated[i]),
          isTrue,
          reason: 'item $i is newer than the one before it',
        );
      }
    });

    test('puts an undated story last, never first', () async {
      // The rule the parser exists to preserve. A feed that omits dates would,
      // if those were defaulted to the fetch time, permanently occupy the top
      // of the page ahead of everything genuinely recent — and be re-stamped
      // to the top again on every refresh.
      final items = await MockNewsRepository().getItems();
      final undatedIndex = items.indexWhere((i) => i.publishedAt == null);
      expect(undatedIndex, isNot(-1), reason: 'seed data must include one');
      expect(undatedIndex, items.length - 1);
    });
  });

  group('getItems filtering', () {
    test('by source returns only that source', () async {
      final items = await MockNewsRepository().getItems(sourceId: 'src_1');
      expect(items, isNotEmpty);
      expect(items.every((i) => i.sourceId == 'src_1'), isTrue);
    });

    test('by niche resolves through the sources in that niche', () async {
      // The niche lives on the source, not the story, so this only works if
      // the filter resolves source ids first — which is the same thing the
      // Supabase implementation does with a separate id lookup.
      final items =
          await MockNewsRepository().getItems(niche: 'influencer marketing');
      expect(items, isNotEmpty);
      expect(items.every((i) => i.sourceId == 'src_2'), isTrue);
    });

    test('an unknown niche returns nothing rather than everything', () async {
      final items =
          await MockNewsRepository().getItems(niche: 'not a real niche');
      expect(items, isEmpty);
    });

    test('paging does not repeat or drop a story', () async {
      final repository = MockNewsRepository();
      final all = await repository.getItems();
      final first = await repository.getItems(limit: 2, offset: 0);
      final second = await repository.getItems(limit: 2, offset: 2);

      expect(first, hasLength(2));
      expect([...first, ...second].map((i) => i.id).toList(),
          all.map((i) => i.id).toList());
    });

    test('an offset past the end is empty, not an error', () async {
      expect(await MockNewsRepository().getItems(offset: 99), isEmpty);
    });
  });

  group('sources', () {
    test('a failing feed reports itself as failing, with a reason', () async {
      final sources = await MockNewsRepository().getSources();
      final failing = sources.where((s) => s.isFailing).toList();
      expect(failing, isNotEmpty);
      expect(failing.first.lastFetchError, isNotNull);
    });

    test('displayName falls back to the host, not the whole URL', () async {
      final repository = MockNewsRepository();
      await repository.addSource(feedUrl: 'https://www.example.com/rss/feed/');
      final added = (await repository.getSources())
          .firstWhere((s) => s.feedUrl.contains('example.com'));
      expect(added.displayName, 'example.com');
    });

    test('adding the same feed twice does not create a second source',
        () async {
      final repository = MockNewsRepository();
      final before = (await repository.getSources()).length;
      await repository.addSource(feedUrl: 'https://new.test/feed/');
      await repository.addSource(feedUrl: 'https://new.test/feed/');
      expect((await repository.getSources()).length, before + 1);
    });

    test('removing a source removes its stories too', () async {
      final repository = MockNewsRepository();
      expect(await repository.getItems(sourceId: 'src_1'), isNotEmpty);

      await repository.removeSource('src_1');

      expect(await repository.getItems(sourceId: 'src_1'), isEmpty);
      expect(
        (await repository.getSources()).any((s) => s.id == 'src_1'),
        isFalse,
      );
    });

    test('disabling a source keeps it, and keeps its stories', () async {
      final repository = MockNewsRepository();
      await repository.setSourceEnabled('src_1', false);

      final source =
          (await repository.getSources()).firstWhere((s) => s.id == 'src_1');
      expect(source.enabled, isFalse);
      // Disabling stops future fetching; it is not a delete.
      expect(await repository.getItems(sourceId: 'src_1'), isNotEmpty);
    });
  });

  group('stored-story maintenance', () {
    test('countItems matches the number of stored stories', () async {
      final repository = MockNewsRepository();
      final all = await repository.getItems(limit: 1000);
      expect(await repository.countItems(), all.length);
    });

    test('clearItems drops every story but keeps the feeds', () async {
      final repository = MockNewsRepository();
      expect(await repository.countItems(), greaterThan(0));
      final sourcesBefore = (await repository.getSources()).length;

      await repository.clearItems();

      expect(await repository.countItems(), 0);
      expect(await repository.getItems(), isEmpty);
      expect((await repository.getSources()).length, sourcesBefore);
    });
  });
}
