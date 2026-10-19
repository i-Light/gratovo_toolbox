import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';

/// Filtering and sorting moved into the database, so there is no longer a
/// pure `applyInfluencerFilter` to test directly. What these cover instead is
/// [MockInfluencerRepository.getPage], which is the in-memory implementation
/// of exactly the same contract — including the parts that are easy to get
/// subtly wrong and expensive to notice in production: paging boundaries,
/// `hasMore`, and how nulls sort and match.
///
/// Keeping the mock honest matters beyond the mock: it is what the app falls
/// back to when there is no session, so a divergence here is a divergence
/// users can actually see.
Influencer _influencer({
  required String id,
  VettingStatus status = VettingStatus.newlyFound,
  int subscriberCount = 1000,
  int? medianViewsLast30,
  int videosLast30 = 0,
  int? daysSinceLastDeal,
  String? country,
  String? name,
  String? description,
  List<ChannelTag> channelTags = const [],
  PipelineStage pipelineStage = PipelineStage.isNew,
  DateTime? lastVideoAt,
}) {
  return Influencer(
    id: id,
    handle: '@$id',
    name: name,
    description: description,
    channelUrl: 'https://youtube.com/@$id',
    platform: InfluencerPlatform.youtube,
    subscriberCount: subscriberCount,
    sourceKeywords: const [],
    vettingStatus: status,
    discoveredAt: DateTime(2026, 1, 1),
    medianViewsLast30: medianViewsLast30,
    videosLast30: videosLast30,
    daysSinceLastDeal: daysSinceLastDeal,
    country: country,
    channelTags: channelTags,
    pipelineStage: pipelineStage,
    lastVideoAt: lastVideoAt,
  );
}

/// A repository seeded with a known set rather than the demo data, so a change
/// to the seed list cannot quietly change what these assert.
class _SeededRepository extends MockInfluencerRepository {
  _SeededRepository(List<Influencer> seed) {
    replaceAllForTesting(seed);
  }
}

void main() {
  group('Influencer.statusTag precedence', () {
    test('a channel with a closed deal shows days since it, above all else',
        () {
      final influencer = _influencer(
        id: 'a',
        daysSinceLastDeal: 112,
        // Both of these would produce a tag on their own, and both lose.
        pipelineStage: PipelineStage.roster,
      );
      final tag = influencer.statusTag;
      expect(tag.kind, InfluencerStatusTagKind.daysSinceDeal);
      expect(tag.count, 112);
    });

    test('with no deal but contact attempts, the attempt count wins', () {
      final tag = _influencer(id: 'a', pipelineStage: PipelineStage.contacted)
          .copyWith(contactAttempts: 3)
          .statusTag;
      expect(tag.kind, InfluencerStatusTagKind.attempts);
      expect(tag.count, 3);
    });

    test('with neither, it falls back to the pipeline stage', () {
      final tag = _influencer(id: 'a', pipelineStage: PipelineStage.interested)
          .statusTag;
      expect(tag.kind, InfluencerStatusTagKind.stage);
      expect(tag.stage, PipelineStage.interested);
    });
  });

  group('PipelineStage wire values', () {
    test('every value round-trips through the wire form', () {
      for (final stage in PipelineStage.values) {
        expect(PipelineStage.fromWire(stage.wire), stage);
      }
    });

    test("isNew is 'new' on the wire, matching the schema's check constraint",
        () {
      expect(PipelineStage.isNew.wire, 'new');
      expect(PipelineStage.isNew.name, isNot('new'));
    });

    test('an unknown or absent value falls back to new rather than throwing',
        () {
      expect(PipelineStage.fromWire(null), PipelineStage.isNew);
      expect(PipelineStage.fromWire('somethingElse'), PipelineStage.isNew);
    });
  });

  group('getPage filtering', () {
    late _SeededRepository repository;

    setUp(() {
      repository = _SeededRepository([
        _influencer(
          id: 'a',
          name: 'Alpha Reviews',
          description: 'Honest fitness gear reviews',
          status: VettingStatus.newlyFound,
          subscriberCount: 500,
          medianViewsLast30: 100,
          videosLast30: 2,
          country: 'EG',
          channelTags: const [ChannelTag.undecided],
        ),
        _influencer(
          id: 'b',
          name: 'Beta Fitness',
          status: VettingStatus.shortlisted,
          subscriberCount: 2000,
          medianViewsLast30: 900,
          videosLast30: 9,
          country: 'US',
          channelTags: const [ChannelTag.irrelevant],
          daysSinceLastDeal: 30,
        ),
        _influencer(
          id: 'c',
          name: 'Gamma Cooking',
          status: VettingStatus.rejected,
          subscriberCount: 1000,
          medianViewsLast30: 300,
          videosLast30: 5,
          country: 'EG',
          channelTags: const [ChannelTag.haramStuff],
          daysSinceLastDeal: 200,
        ),
      ]);
    });

    Future<List<String>> ids(InfluencerQuery query) async {
      final page = await repository.getPage(offset: 0, limit: 50, query: query);
      return page.items.map((i) => i.id).toList();
    }

    test('an unconstrained query returns everything', () async {
      expect(await ids(const InfluencerQuery()), hasLength(3));
    });

    test('filters by country', () async {
      expect(
        await ids(const InfluencerQuery(includeCountries: {'EG'})),
        ['c', 'a'],
      );
    });

    test('filters by channel tag', () async {
      expect(
        await ids(const InfluencerQuery(
          includeChannelTags: {ChannelTag.irrelevant},
        )),
        ['b'],
      );
    });

    test(
        'excluding a channel tag hides the channels that carry it, not '
        'the other way around', () async {
      expect(
        await ids(const InfluencerQuery(
          excludeChannelTags: {ChannelTag.irrelevant},
        )),
        ['c', 'a'],
      );
    });

    test('filters by a subscriber range, inclusive at both ends', () async {
      expect(
        await ids(
            const InfluencerQuery(minSubscribers: 1000, maxSubscribers: 2000)),
        ['b', 'c'],
      );
    });

    test('filters by minimum average views this month', () async {
      expect(await ids(const InfluencerQuery(minMedianViews: 300)), ['b', 'c']);
    });

    test('searches name and handle case-insensitively', () async {
      expect(await ids(const InfluencerQuery(search: 'fitness')), ['b']);
      expect(await ids(const InfluencerQuery(search: '@c')), ['c']);
    });

    test('searches the channel description only when asked', () async {
      expect(
        await ids(const InfluencerQuery(
          search: 'FITNESS',
          searchIn: {InfluencerSearchScope.channelDescriptions},
        )),
        ['a'],
      );
      expect(
        await ids(const InfluencerQuery(
          search: 'fitness',
          searchIn: {
            InfluencerSearchScope.names,
            InfluencerSearchScope.channelDescriptions,
          },
        )),
        unorderedEquals(['a', 'b']),
      );
    });

    test(
        'a days-since-deal bound excludes channels that never had one, '
        'rather than treating them as zero days', () async {
      // 'a' has no deal at all. Under a naive `?? 0` it would match "at most
      // 100 days" and look like the most recently worked-with channel here,
      // which is the opposite of the truth.
      expect(
          await ids(const InfluencerQuery(maxDaysSinceLastDeal: 100)), ['b']);
      expect(
          await ids(const InfluencerQuery(minDaysSinceLastDeal: 100)), ['c']);
    });
  });

  group('getPage sorting and paging', () {
    late _SeededRepository repository;

    setUp(() {
      repository = _SeededRepository([
        _influencer(
          id: 'a',
          subscriberCount: 500,
          medianViewsLast30: 100,
          videosLast30: 2,
          lastVideoAt: DateTime(2026, 1, 1),
        ),
        _influencer(
          id: 'b',
          subscriberCount: 2000,
          medianViewsLast30: 900,
          videosLast30: 9,
          lastVideoAt: DateTime(2026, 1, 10),
        ),
        _influencer(
          id: 'c',
          subscriberCount: 1000,
          medianViewsLast30: 300,
          videosLast30: 5,
          lastVideoAt: DateTime(2026, 1, 5),
        ),
      ]);
    });

    Future<List<String>> sorted(InfluencerSortBy by,
        {bool descending = true}) async {
      final page = await repository.getPage(
        offset: 0,
        limit: 50,
        query: InfluencerQuery(sortBy: by, descending: descending),
      );
      return page.items.map((i) => i.id).toList();
    }

    test('sorts by subscribers', () async {
      expect(await sorted(InfluencerSortBy.subscribers), ['b', 'c', 'a']);
      expect(
        await sorted(InfluencerSortBy.subscribers, descending: false),
        ['a', 'c', 'b'],
      );
    });

    test('sorts by average views', () async {
      expect(await sorted(InfluencerSortBy.medianViews), ['b', 'c', 'a']);
    });

    test('sorts by most recent upload first', () async {
      expect(await sorted(InfluencerSortBy.recentActivity), ['b', 'c', 'a']);
    });

    test('sorts by uploads this month', () async {
      expect(await sorted(InfluencerSortBy.videosThisMonth), ['b', 'c', 'a']);
    });

    test('pages without dropping or repeating a row', () async {
      final first = await repository.getPage(offset: 0, limit: 2);
      final second = await repository.getPage(offset: 2, limit: 2);

      expect(first.items.map((i) => i.id).toList(), ['b', 'c']);
      expect(first.hasMore, isTrue);
      expect(second.items.map((i) => i.id).toList(), ['a']);
      // A short page proves the end, so hasMore must be false here even
      // though the caller never asked for a count.
      expect(second.hasMore, isFalse);
    });

    test('an offset past the end returns an empty final page, not an error',
        () async {
      final page = await repository.getPage(offset: 99, limit: 10);
      expect(page.items, isEmpty);
      expect(page.hasMore, isFalse);
    });

    test('an exactly-full last page reports hasMore, and the next is empty',
        () async {
      // The one boundary that a `hasMore = items.length == limit` rule gets
      // "wrong": three rows read two at a time ends on a full page only if the
      // total is even. Seeded with four to hit it deliberately.
      final four = _SeededRepository([
        for (final id in ['a', 'b', 'c', 'd'])
          _influencer(id: id, subscriberCount: 100),
      ]);
      final second = await four.getPage(offset: 2, limit: 2);
      expect(second.items, hasLength(2));
      expect(second.hasMore, isTrue);

      final third = await four.getPage(offset: 4, limit: 2);
      expect(third.items, isEmpty);
      expect(third.hasMore, isFalse);
    });
  });

  group('create', () {
    test('normalises the handle and derives an id when none is given',
        () async {
      final repository = _SeededRepository([]);
      final id =
          await repository.create(const NewInfluencer(handle: 'someone'));

      expect(id, 'manual:@someone');
      final created = await repository.getById(id);
      expect(created!.handle, '@someone');
      // Nothing was typed for subscribers, so it must not read as a measured
      // zero later. The model's own default is what carries that.
      expect(created.subscriberCount, 0);
      // No tags at all, where this used to be ['new']. Being newly found is a
      // position in the funnel, which the status badge already shows from
      // pipelineStage — it is not a topic, and putting it in the topic tags
      // printed the same fact twice while taking one of the two tag slots a
      // card has room for.
      expect(created.channelTags, isEmpty);
    });

    test('drops duplicate tags, keeping the first occurrence', () async {
      final repository = _SeededRepository([]);
      final id = await repository.create(
        const NewInfluencer(
          handle: 'someone',
          channelTags: [
            ChannelTag.undecided,
            ChannelTag.undecided,
            ChannelTag.haramStuff,
          ],
        ),
      );
      expect(
        (await repository.getById(id))!.channelTags,
        [ChannelTag.undecided, ChannelTag.haramStuff],
      );

      await repository.updateChannelTags(
        id,
        [ChannelTag.irrelevant, ChannelTag.irrelevant],
        base: const [ChannelTag.undecided, ChannelTag.haramStuff],
      );
      expect(
        (await repository.getById(id))!.channelTags,
        [ChannelTag.irrelevant],
      );
    });

    test('uses the YouTube channel id when one is supplied', () async {
      final repository = _SeededRepository([]);
      final id = await repository.create(
        const NewInfluencer(handle: '@someone', channelId: 'UC12345'),
      );
      expect(id, 'UC12345');
    });
  });
}
