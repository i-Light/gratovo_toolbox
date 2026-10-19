import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/video.dart';
import 'package:gratovo_toolbox/features/influencers/application/crm_calculator.dart';

Video _video(String id, {int? views, DateTime? at}) => Video(
      id: id,
      title: 'Video $id',
      url: 'https://youtube.com/watch?v=$id',
      viewCount: views,
      publishedAt: at,
    );

void main() {
  group('the niche CPM table (HC-05, from the owner)', () {
    test('holds the ranges the owner gave, in USD CPM', () {
      expect({
        for (final niche in kNicheCpmRanges) niche.key: (niche.low, niche.high)
      }, {
        'tech': (20, 50),
        'finance': (15, 80),
        'fitness': (10, 35),
        'entertainment': (5, 20),
        'gaming': (10, 20),
        'beauty': (10, 25),
        'travel': (12, 20),
        'education': (25, 40),
        'food': (10, 20),
        'luxury': (30, 50),
      });
    });

    test('tech is the default, the agency niche being AI', () {
      expect(kDefaultCpmNiche.key, 'tech');
    });
  });

  group('computeCrmEstimate', () {
    test('averages only the videos that were selected', () {
      final videos = [
        _video('a', views: 100),
        _video('b', views: 200),
        _video('c', views: 90000),
      ];
      final estimate = computeCrmEstimate(
        all: videos,
        includedIds: {'a', 'b'},
      );

      expect(estimate.includedCount, 2);
      expect(estimate.excludedCount, 1);
      expect(estimate.averageViews, 150);
      expect(estimate.totalViews, 300);
    });

    test(
        'a video with no view count is excluded from the basis, never counted '
        'as zero views', () {
      // This is the rule that matters most: most of the videos in this
      // project's data have no view count, and averaging zeros in understates
      // every channel — quietly, and in the direction that loses money.
      final videos = [
        _video('a', views: 1000),
        _video('b', views: null),
        _video('c', views: 3000),
      ];
      final estimate = computeCrmEstimate(
        all: videos,
        includedIds: {'a', 'b', 'c'},
      );

      expect(estimate.includedCount, 2);
      expect(estimate.unusableCount, 1);
      // 2000, not 1333.3 — which is what averaging the null as a zero gives.
      expect(estimate.averageViews, 2000);
    });

    test('reports the median alongside the mean', () {
      final videos = [
        _video('a', views: 100),
        _video('b', views: 200),
        _video('c', views: 300),
      ];
      final estimate =
          computeCrmEstimate(all: videos, includedIds: {'a', 'b', 'c'});
      expect(estimate.medianViews, 200);
      expect(estimate.averageViews, 200);
      expect(estimate.minViews, 100);
      expect(estimate.maxViews, 300);
    });

    test('takes the midpoint of the two middle values for an even count', () {
      final videos = [
        _video('a', views: 100),
        _video('b', views: 200),
        _video('c', views: 300),
        _video('d', views: 500),
      ];
      final estimate = computeCrmEstimate(
        all: videos,
        includedIds: {'a', 'b', 'c', 'd'},
      );
      expect(estimate.medianViews, 250);
    });

    test('skew exposes a mean carried by one outlier', () {
      final normal = computeCrmEstimate(
        all: [
          _video('a', views: 1000),
          _video('b', views: 1100),
          _video('c', views: 1200),
        ],
        includedIds: {'a', 'b', 'c'},
      );
      final skewed = computeCrmEstimate(
        all: [
          _video('a', views: 1000),
          _video('b', views: 1100),
          _video('c', views: 100000),
        ],
        includedIds: {'a', 'b', 'c'},
      );

      expect(normal.skew, lessThan(0.25));
      expect(skewed.skew, greaterThan(0.25));
      // And the median is unmoved by the outlier, which is why it is what
      // cpmAt quotes.
      expect(skewed.medianViews, 1100);
    });

    test('computes CPM and price from the median, not the mean', () {
      final estimate = computeCrmEstimate(
        all: [
          _video('a', views: 1000),
          _video('b', views: 2000),
          _video('c', views: 300000),
        ],
        includedIds: {'a', 'b', 'c'},
      );
      // Median is 2000 -> 2 thousand-view units.
      expect(estimate.cpmAt(50), 25);
      expect(estimate.priceAtCpm(25), 50);
    });

    test('measures the upload span and rate from dated videos only', () {
      final estimate = computeCrmEstimate(
        all: [
          _video('a', views: 100, at: DateTime(2026, 1, 1)),
          _video('b', views: 100, at: DateTime(2026, 1, 31)),
          // No date: a failed fetch. Counted in the basis (it has views) but
          // must not stretch the span back to the epoch.
          _video('c', views: 100),
        ],
        includedIds: {'a', 'b', 'c'},
      );

      expect(estimate.includedCount, 3);
      expect(estimate.spanDays, 30);
      expect(estimate.uploadsPerMonth, closeTo(3, 0.001));
    });

    test('reports no span when fewer than two included videos have a date', () {
      final estimate = computeCrmEstimate(
        all: [_video('a', views: 100, at: DateTime(2026, 1, 1))],
        includedIds: {'a'},
      );
      expect(estimate.spanDays, isNull);
      expect(estimate.uploadsPerMonth, isNull);
    });

    test('several uploads on the same day do not divide by a zero span', () {
      final estimate = computeCrmEstimate(
        all: [
          _video('a', views: 100, at: DateTime(2026, 1, 1)),
          _video('b', views: 100, at: DateTime(2026, 1, 1)),
        ],
        includedIds: {'a', 'b'},
      );
      expect(estimate.spanDays, 0);
      expect(estimate.uploadsPerMonth, isNotNull);
      expect(estimate.uploadsPerMonth!.isFinite, isTrue);
      // Two uploads treated as one day apart: 60 per 30 days.
      expect(estimate.uploadsPerMonth, 60);
    });

    test('an empty basis reports zero rather than NaN', () {
      final estimate = computeCrmEstimate(
        all: [_video('a', views: null)],
        includedIds: {'a'},
      );
      expect(estimate.isEmpty, isTrue);
      expect(estimate.averageViews, 0);
      expect(estimate.unusableCount, 1);
      // Dividing by a zero median would give infinity, which would render as
      // a confident-looking price.
      expect(estimate.cpmAt(100), isNull);
      expect(estimate.priceAtCpm(25), isNull);
    });
  });

  group('computeCommissionSplit', () {
    test('splits the price at the given percentage', () {
      final split = computeCommissionSplit(price: 10000, percent: 20)!;
      expect(split.yours, 2000);
      expect(split.theirs, 8000);
    });

    test('the two halves always add back up to the price', () {
      // A third of a price that does not divide evenly: the creator's share is
      // derived by subtraction rather than computed independently, so the two
      // figures cannot drift apart from the total that was quoted.
      final split = computeCommissionSplit(price: 1000, percent: 33.33)!;
      expect(split.yours + split.theirs, closeTo(1000, 1e-9));
    });

    test('0% and 100% are both valid ends of the range', () {
      expect(computeCommissionSplit(price: 500, percent: 0)!.yours, 0);
      expect(computeCommissionSplit(price: 500, percent: 100)!.theirs, 0);
    });

    test('a missing price or cut has no split rather than a zero one', () {
      expect(computeCommissionSplit(price: null, percent: 20), isNull);
      expect(computeCommissionSplit(price: 1000, percent: null), isNull);
    });

    test('a nonsensical percentage produces nothing, not a confident figure',
        () {
      // 150% would otherwise render as "you earn 1.5x the deal", which reads
      // like an answer instead of the typo it is.
      expect(computeCommissionSplit(price: 1000, percent: 150), isNull);
      expect(computeCommissionSplit(price: 1000, percent: -5), isNull);
      expect(computeCommissionSplit(price: -1000, percent: 20), isNull);
    });
  });

  group('defaultCrmSelection', () {
    test('starts with every video that has a view count, and no others', () {
      final videos = [
        _video('a', views: 100),
        _video('b', views: null),
        _video('c', views: 300),
      ];
      expect(defaultCrmSelection(videos), {'a', 'c'});
    });
  });
}
