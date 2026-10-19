import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/data/models/channel_stats.dart';

/// Two chart shapes, built out of plain widgets.
///
/// No charting package, and that is a decision rather than an omission. Both
/// shapes here are a rectangle whose length is a ratio — `Row`, `Expanded` and
/// `FractionallySizedBox` express that natively, they inherit the theme and the
/// text direction for free, and they lay out under the same constraints as
/// everything around them. A charting dependency would bring a second layout
/// system, a second color vocabulary and a second answer to what happens in
/// Arabic, to draw bars.
///
/// The two shapes are not interchangeable:
///
///  * [BarList] is for a **ranked** breakdown — countries, stages, tags. Reading
///    it is comparing lengths against each other, and horizontal bars with the
///    label on the left do that at any number of categories, because the labels
///    have room to be words.
///  * [ColumnChart] is for an **ordered** one — subscriber tiers, view tiers,
///    months. The order is the meaning (small to large, oldest to newest), and
///    a vertical run is the only arrangement where the shape of the
///    distribution is the thing you see first. It spends whatever width it is
///    given, which is why the distributions get full-width panels and the
///    ranked lists share a row.
///
/// Both scale to the largest bar rather than to the total. A category holding
/// 3% of the rows is still legible next to one holding 60%, which is the case
/// this data is always in.

/// A ranked breakdown: label, bar, count, one row each.
class BarList extends StatelessWidget {
  const BarList({
    super.key,
    required this.buckets,
    required this.label,
    this.color,
    this.emptyMessage,
    this.maxRows = 12,
  });

  final List<StatBucket> buckets;

  /// Turns a bucket's raw key into something a person reads. Kept as a callback
  /// rather than pre-translated into the model so the same [ChannelStats] can be
  /// rendered in either language without going back to the database.
  final String Function(String key) label;

  /// One color for every bar, or null to use the theme's primary. Per-bar
  /// color is passed where the vocabulary already HAS colors — pipeline
  /// stages and vetting statuses are colored identically everywhere else in
  /// the app, and inventing a second palette for them here would make the same
  /// value two different colors on two screens.
  final Color Function(String key, BuildContext context)? color;

  final String? emptyMessage;
  final int maxRows;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (buckets.isEmpty) {
      return _Empty(message: emptyMessage);
    }

    final rows = buckets.take(maxRows).toList();
    // The largest BAR, not the total — and the bar is now live + archive-due +
    // archived, so the peak is measured over the total. See the library
    // comment.
    final peak = rows.fold<int>(1, (max, b) => b.total > max ? b.total : max);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final bucket in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                SizedBox(
                  width: 150,
                  child: Text(
                    label(bucket.key),
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _Bar(
                    liveFraction: bucket.count / peak,
                    archiveDueFraction: bucket.archiveDue / peak,
                    archivedFraction: bucket.archived / peak,
                    liveColor: color?.call(bucket.key, context) ??
                        theme.colorScheme.primary,
                    archiveDueColor: AppColors.archiveDueSeries,
                    archivedColor: AppColors.archivedSeries,
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: 56,
                  child: Text(
                    // The whole bar's worth — what the length is proportional
                    // to. Equal to the live count on every breakdown the
                    // archive does not touch.
                    formatCompact(bucket.total),
                    textAlign: TextAlign.end,
                    style: theme.textTheme.bodySmall,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// One horizontal bar, over a track: a live segment, then an archive-due one,
/// then an archived one, stacked in that order in three colors.
///
/// The track is drawn even where the bar is nearly zero, so a category with two
/// channels in it still occupies a visible row — otherwise the smallest
/// categories read as absent rather than as small, which is the opposite of
/// what a breakdown is for.
class _Bar extends StatelessWidget {
  const _Bar({
    required this.liveFraction,
    required this.archiveDueFraction,
    required this.archivedFraction,
    required this.liveColor,
    required this.archiveDueColor,
    required this.archivedColor,
  });

  final double liveFraction;
  final double archiveDueFraction;
  final double archivedFraction;
  final Color liveColor;
  final Color archiveDueColor;
  final Color archivedColor;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // Integer flex weights out of 1000. A floor of 20 (2%) on a segment that is
    // present at all, for the same reason the old single bar had one: a segment
    // rounded to zero pixels is indistinguishable from no segment, and "one
    // channel" is not "none".
    int weight(double fraction) {
      if (fraction <= 0) return 0;
      return (fraction.clamp(0.0, 1.0) * 1000).round().clamp(20, 1000);
    }

    final live = weight(liveFraction);
    final archiveDue = weight(archiveDueFraction);
    final archived = weight(archivedFraction);
    final rest = (1000 - live - archiveDue - archived).clamp(0, 1000);

    return Container(
      height: 10,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(5),
      ),
      child: Row(
        // Stretch, so each segment is handed a tight 10px height. A
        // childless `ColoredBox` takes `constraints.smallest` for its size,
        // and under the loose cross-axis constraints a default (centre-aligned)
        // Row hands out that is a height of zero — which `_RenderColoredBox`
        // then skips painting entirely, leaving only the track visible.
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (live > 0)
            Expanded(flex: live, child: ColoredBox(color: liveColor)),
          if (archiveDue > 0)
            Expanded(
                flex: archiveDue, child: ColoredBox(color: archiveDueColor)),
          if (archived > 0)
            Expanded(flex: archived, child: ColoredBox(color: archivedColor)),
          if (rest > 0) Expanded(flex: rest, child: const SizedBox()),
        ],
      ),
    );
  }
}

/// An ordered distribution, as columns left to right.
///
/// Fills whatever width it is given: [columnWidth] is a **minimum**, and where
/// there is more room than the buckets need, the surplus is divided between
/// them rather than left as blank space to the right. Seven subscriber tiers at
/// 44px in a full-width panel would otherwise be a small chart floating in an
/// empty rectangle, which reads as a rendering fault rather than as a
/// distribution.
///
/// Below that minimum it scrolls horizontally rather than compressing. Twelve
/// months at a readable column width does not fit a narrow window, and the
/// alternative — columns three pixels wide — is a chart nobody can read that
/// still takes the space of one they could.
class ColumnChart extends StatelessWidget {
  const ColumnChart({
    super.key,
    required this.buckets,
    required this.label,
    this.height = 120,
    this.columnWidth = 44,
    this.emptyMessage,
    this.independentKeys = const {},
    this.onIndependentKeysChanged,
    this.independentToggleTooltip,
  });

  final List<StatBucket> buckets;
  final String Function(String key) label;

  /// The bucket keys (`{'<10K'}`, on the tier distributions) scaled against
  /// their OWN total rather than the chart's peak, so they always stand full
  /// height and show the live/archive-due/archived split within themselves —
  /// that tier is usually most of the channels, and its size otherwise sets
  /// the peak and squashes every other tier down to a sliver. Also left out
  /// when finding the peak for the rest, so those keep scaling against each
  /// other unaffected by how large an independent bucket is.
  final Set<String> independentKeys;

  /// Shows a checkbox next to every label that toggles that bucket in and out
  /// of [independentKeys], handing back the new set. This chart holds no
  /// state of its own for it — the caller owns [independentKeys], which is
  /// what lets it persist a choice across a restart. Null hides the
  /// checkboxes.
  final ValueChanged<Set<String>>? onIndependentKeysChanged;

  /// The checkbox's tooltip. Only read when [onIndependentKeysChanged] is set.
  final String? independentToggleTooltip;

  /// The height of the tallest BAR, not of the chart. See [_chrome].
  final double height;

  /// The MINIMUM width of one column, not a fixed one: columns grow past it to
  /// consume the available width, and the chart scrolls below it.
  final double columnWidth;

  final String? emptyMessage;

  static const _valueHeight = 28.0;
  static const _valueGap = 2.0;
  static const _labelGap = 5.0;
  static const _labelHeight = 35.0;
  static const _chrome =
      _valueHeight + _valueGap + (_labelGap + _labelHeight) * 2;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (buckets.isEmpty) return _Empty(message: emptyMessage);

    // Over the total (live + archived), so a stacked column is scaled by its
    // full height the same way [BarList]'s peak is. Independent buckets are
    // excluded here so their size cannot set the peak for the rest.
    final peak = buckets
        .where((b) => !independentKeys.contains(b.key))
        .fold<int>(1, (max, b) => b.total > max ? b.total : max);

    return SizedBox(
      // [height] is the BAR area; the value above and the label below are
      // fixed boxes on top of it. Adding them up here rather than letting the
      // column size itself is what stops a longer label, or a larger text
      // scale, overflowing a chart whose outer height is already committed.
      height: height + _chrome,
      child: LayoutBuilder(
        builder: (context, constraints) {
          // An unbounded width — nested in a horizontally scrolling parent,
          // say — has no surplus to divide, so fall back to the minimum.
          final available = constraints.maxWidth;
          final fills =
              available.isFinite && available > buckets.length * columnWidth;
          final width = fills ? available / buckets.length : columnWidth;

          return SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            // Nothing left to scroll once the columns have absorbed the width,
            // and a chart that still drags under the finger when it visibly
            // fits reads as broken.
            physics: fills ? const NeverScrollableScrollPhysics() : null,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                for (final bucket in buckets)
                  SizedBox(
                    width: width,
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        SizedBox(
                          height: _valueHeight,
                          child: Text(
                            // Compact: a five-digit count over a 44px column
                            // ellipsizes to nothing useful, and the exact
                            // figure is one tooltip away. The total, so it
                            // matches the column's full height.
                            formatCompact(bucket.count),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.labelSmall
                                ?.copyWith(color: theme.colorScheme.primary),
                          ),
                        ),
                        const SizedBox(height: _valueGap),
                        _StackedColumn(
                          live: bucket.count,
                          archiveDue: bucket.archiveDue,
                          archived: bucket.archived,
                          peak: independentKeys.contains(bucket.key)
                              ? bucket.total
                              : peak,
                          height: height,
                          gutter: (width * 0.12).clamp(_labelGap, _valueHeight),
                          liveColor: theme.colorScheme.primary,
                          archiveDueColor: AppColors.archiveDueSeries,
                          archivedColor: AppColors.archivedSeries,
                          emptyColor: theme.colorScheme.surfaceContainerHighest,
                        ),
                        SizedBox(
                          height: _labelHeight,
                          // One sub-label row shared by both non-live series:
                          // each half is its own color when both are
                          // present, so a bucket with both a due and an
                          // archived count still reads as two numbers rather
                          // than one ambiguous one.
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (bucket.archiveDue > 0)
                                Flexible(
                                  child: Text(
                                    formatCompact(bucket.archiveDue),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: theme.textTheme.labelSmall?.copyWith(
                                        color: AppColors.archiveDueSeries),
                                  ),
                                ),
                              if (bucket.archiveDue > 0 && bucket.archived > 0)
                                Text(
                                  ' / ',
                                  style: theme.textTheme.labelSmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                ),
                              if (bucket.archived > 0)
                                Flexible(
                                  child: Text(
                                    formatCompact(bucket.archived),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: theme.textTheme.labelSmall?.copyWith(
                                        color: AppColors.archivedSeries),
                                  ),
                                ),
                            ],
                          ),
                        ),
                        const SizedBox(height: _labelGap),
                        SizedBox(
                          height: _labelHeight,
                          child: Row(
                            spacing: 8,
                            mainAxisAlignment: MainAxisAlignment.center,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (onIndependentKeysChanged
                                  case final onChanged?)
                                Tooltip(
                                  message: independentToggleTooltip ?? '',
                                  child: SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: Checkbox(
                                      value:
                                          independentKeys.contains(bucket.key),
                                      visualDensity: const VisualDensity(
                                          horizontal: -4, vertical: -4),
                                      materialTapTargetSize:
                                          MaterialTapTargetSize.shrinkWrap,
                                      onChanged: (checked) {
                                        final next = {...independentKeys};
                                        if (checked ?? false) {
                                          next.add(bucket.key);
                                        } else {
                                          next.remove(bucket.key);
                                        }
                                        onChanged(next);
                                      },
                                    ),
                                  ),
                                ),
                              Flexible(
                                child: Text(
                                  label(bucket.key),
                                  textAlign: TextAlign.center,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.labelSmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// One column: up to three segments stacked bottom to top — live, then
/// archive-due, then archived — each in its own color. Collapses to a single
/// 2px track when the bucket is empty on all three sides — an empty bucket is
/// a real answer, not a column the chart forgot.
class _StackedColumn extends StatelessWidget {
  const _StackedColumn({
    required this.live,
    required this.archiveDue,
    required this.archived,
    required this.peak,
    required this.height,
    required this.gutter,
    required this.liveColor,
    required this.archiveDueColor,
    required this.archivedColor,
    required this.emptyColor,
  });

  final int live;
  final int archiveDue;
  final int archived;
  final int peak;
  final double height;
  final double gutter;
  final Color liveColor;
  final Color archiveDueColor;
  final Color archivedColor;
  final Color emptyColor;

  @override
  Widget build(BuildContext context) {
    final values = [live, archiveDue, archived];
    final total = live + archiveDue + archived;
    final margin = EdgeInsets.symmetric(horizontal: gutter);
    const radius = BorderRadius.vertical(top: Radius.circular(12));

    if (total == 0) {
      return Container(
        height: 5,
        margin: margin,
        decoration: BoxDecoration(color: emptyColor, borderRadius: radius),
      );
    }

    final barHeight = (total / peak * height).clamp(4.0, height);

    // Split the drawn height across the up-to-three present segments. Each
    // one present at all gets a floor share of the bar height — smaller as
    // more segments are present, so three tiny slivers cannot together eat
    // the whole column — and whatever remains is handed out in proportion to
    // each segment's share of [total]. The two-segment case (archive-due
    // absent, as on every breakdown before this one existed) reduces to the
    // original 20%/80% floor-and-remainder split.
    final present = values.where((v) => v > 0).length;
    final minShare = switch (present) {
      0 || 1 => 0.0,
      2 => 0.2,
      _ => 0.15,
    };
    final floors = [
      for (final v in values) v > 0 ? barHeight * minShare : 0.0,
    ];
    final free =
        (barHeight - floors.fold(0.0, (a, b) => a + b)).clamp(0.0, barHeight);
    final heights = [
      for (var i = 0; i < values.length; i++)
        floors[i] + (values[i] > 0 ? free * values[i] / total : 0.0),
    ];

    final colors = [liveColor, archiveDueColor, archivedColor];
    // The topmost present segment carries the column's rounded top corner;
    // the rest stay square so the stack reads as one continuous bar.
    final firstPresent = values.indexWhere((v) => v > 0);

    return Container(
      margin: margin,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          for (var i = 0; i < values.length; i++)
            if (heights[i] > 0)
              Container(
                height: heights[i],
                decoration: BoxDecoration(
                  color: colors[i],
                  borderRadius: i == firstPresent ? radius : null,
                ),
              ),
        ],
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({this.message});

  final String? message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Text(
        message ?? '',
        style: theme.textTheme.bodySmall?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}
