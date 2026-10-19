import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/channel_stats.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/widgets/mini_charts.dart';

/// Regression: the bars in [BarList] draw a track but no fill.
///
/// The fill segments are childless `ColoredBox`es inside a `Row`. A childless
/// `ColoredBox` sizes to `constraints.smallest`, and a default (centre-aligned)
/// `Row` hands its children a loose cross-axis constraint — so the fill
/// collapsed to zero height and `_RenderColoredBox` skipped painting it,
/// leaving only the rounded track visible. The `Row` now stretches its
/// children, which hands each segment a tight full height.
void main() {
  Future<void> pumpBar(WidgetTester tester, List<StatBucket> buckets) {
    return tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 400,
            child: BarList(buckets: buckets, label: (key) => key),
          ),
        ),
      ),
    );
  }

  testWidgets('a bar with a count actually fills, not just its track',
      (tester) async {
    await pumpBar(tester, const [
      StatBucket(key: 'US', count: 400),
      StatBucket(key: 'IN', count: 100),
    ]);

    // Every ColoredBox the list drew (the fills — the track is a DecoratedBox).
    final fills = tester.widgetList<ColoredBox>(find.byType(ColoredBox));
    expect(fills, isNotEmpty, reason: 'the bars should draw fill segments');

    for (final fill in fills) {
      final size = tester.getSize(find.byWidget(fill));
      expect(
        size.height,
        greaterThan(0),
        reason: 'a fill segment collapsed to zero height and would not paint',
      );
    }
  });

  testWidgets('the longest bar fills most of the track width', (tester) async {
    await pumpBar(tester, const [
      StatBucket(key: 'US', count: 400),
      StatBucket(key: 'IN', count: 40),
    ]);

    final sizes = tester
        .widgetList<ColoredBox>(find.byType(ColoredBox))
        .map((w) => tester.getSize(find.byWidget(w)).width)
        .toList();

    // The peak bar (US) is drawn at full width; the 10%-of-peak bar (IN) far
    // narrower. Both are non-zero.
    expect(sizes.every((w) => w > 0), isTrue);
    expect(sizes.reduce((a, b) => a > b ? a : b),
        greaterThan(sizes.reduce((a, b) => a < b ? a : b) * 3));
  });
}
