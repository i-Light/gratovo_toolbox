/// The bug this whole layer exists to close: a change made on one page left
/// every other page showing the old value, because each mutation carried a
/// hand-written list of which providers to invalidate and no such list is ever
/// complete.
///
/// So what is asserted here is the *contract*, not any one screen. A provider
/// that watches a domain re-reads when that domain changes and only then; the
/// influencer list re-reads without losing the pages under the reader's scroll
/// position. Any screen wired the same way inherits both.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_page_controller.dart';

void main() {
  group('the change bus', () {
    test('a provider watching a domain re-reads when it changes', () async {
      var reads = 0;
      final counted = FutureProvider<int>((ref) async {
        ref.watch(dataRevisionProvider(DataDomain.channels));
        return ++reads;
      });
      final container = ProviderContainer();
      addTearDown(container.dispose);

      // Kept subscribed, the way a screen in the shell's IndexedStack is —
      // an unwatched provider is disposed and would re-read anyway.
      container.listen(counted, (_, __) {});
      expect(await container.read(counted.future), 1);

      container.read(dataRevisionsProvider.notifier).bump(
        const {DataDomain.channels},
      );
      expect(await container.read(counted.future), 2);
    });

    test('a change to another domain is not its business', () async {
      var reads = 0;
      final counted = FutureProvider<int>((ref) async {
        ref.watch(dataRevisionProvider(DataDomain.deals));
        return ++reads;
      });
      final container = ProviderContainer();
      addTearDown(container.dispose);

      container.listen(counted, (_, __) {});
      await container.read(counted.future);

      container.read(dataRevisionsProvider.notifier).bump(
        const {DataDomain.channels},
      );
      // Same value, not a second read: the map behind the counters changed,
      // but this domain's counter did not.
      expect(await container.read(counted.future), 1);
    });
  });

  group('the influencer list', () {
    /// The list debounces its re-read so a run of quick edits is one query.
    Future<void> settle() =>
        Future<void>.delayed(const Duration(milliseconds: 400));

    ProviderContainer harness(MockInfluencerRepository repository) {
      final container = ProviderContainer(
        overrides: [
          influencerRepositoryProvider.overrideWithValue(repository),
        ],
      );
      addTearDown(container.dispose);
      return container;
    }

    test('picks up a tag edited from somewhere else', () async {
      final repository = MockInfluencerRepository();
      final container = harness(repository);
      const query = InfluencerQuery();

      container.listen(influencerPageProvider(query), (_, __) {});
      final before = await container.read(influencerPageProvider(query).future);
      final target = before.items.first;

      // The edit as the profile page makes it: straight at the repository,
      // with no reference to the list at all.
      await repository.updateChannelTags(
        target.id,
        const [ChannelTag.irrelevant],
        base: target.channelTags,
      );
      container.read(dataRevisionsProvider.notifier).bump(
        const {DataDomain.channels},
      );
      await settle();

      final after = container.read(influencerPageProvider(query)).value!;
      expect(
        after.items.firstWhere((i) => i.id == target.id).channelTags,
        contains(ChannelTag.irrelevant),
      );
    });

    test('keeps the pages already scrolled past', () async {
      final container = harness(_ManyChannelsRepository());
      const query = InfluencerQuery();

      container.listen(influencerPageProvider(query), (_, __) {});
      await container.read(influencerPageProvider(query).future);
      await container.read(influencerPageProvider(query).notifier).loadMore();
      final loaded =
          container.read(influencerPageProvider(query)).value!.items.length;
      expect(loaded, influencerPageSize * 2);

      container.read(dataRevisionsProvider.notifier).bump(
        const {DataDomain.channels},
      );
      await settle();

      final after = container.read(influencerPageProvider(query)).value!;
      // Both pages still there, not back to the first — the thing that would
      // otherwise yank the reader to the top of the list every time anyone
      // edited anything.
      expect(after.items, hasLength(loaded));
      expect(after.items.last.id, 'many_${loaded - 1}');
      expect(after.hasMore, isTrue);
    });

    test('a re-read never leaves the list showing a loading spinner', () async {
      final repository = MockInfluencerRepository();
      final container = harness(repository);
      const query = InfluencerQuery();

      container.listen(influencerPageProvider(query), (_, __) {});
      await container.read(influencerPageProvider(query).future);

      final states = <bool>[];
      container.listen(
        influencerPageProvider(query),
        (_, next) => states.add(next.isLoading),
      );

      container.read(dataRevisionsProvider.notifier).bump(
        const {DataDomain.channels},
      );
      await settle();

      expect(states, isNotEmpty);
      expect(states.any((loading) => loading), isFalse);
    });
  });
}

/// A repository with more rows than fit on one page, so there is a second page
/// to load and therefore something a careless refresh could throw away.
///
/// The shared mock holds eight fixtures, which is fine for everything else and
/// useless here: with a page size of 50 it can never page at all, so a test
/// written against it would assert that nothing was lost from a list that never
/// had a second page.
class _ManyChannelsRepository extends MockInfluencerRepository {
  _ManyChannelsRepository()
      : _rows = [
          for (var i = 0; i < 120; i++)
            Influencer(
              id: 'many_$i',
              handle: '@many_$i',
              channelUrl: 'https://youtube.com/@many_$i',
              platform: InfluencerPlatform.youtube,
              subscriberCount: 1000 + i,
              sourceKeywords: const [],
              vettingStatus: VettingStatus.newlyFound,
              discoveredAt: DateTime.utc(2026).add(Duration(days: i)),
            ),
        ];

  final List<Influencer> _rows;

  @override
  Future<InfluencerPage> getPage({
    required int offset,
    required int limit,
    InfluencerQuery query = const InfluencerQuery(),
  }) async {
    final start = offset.clamp(0, _rows.length);
    final end = (offset + limit).clamp(0, _rows.length);
    final items = _rows.sublist(start, end);
    // Same contract as the real thing: a full page means "there may be more".
    return InfluencerPage(items: items, hasMore: items.length == limit);
  }
}
