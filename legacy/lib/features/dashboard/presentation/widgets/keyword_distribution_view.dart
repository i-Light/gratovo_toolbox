import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

// ---------------------------------------------------------------------------
// DATA MODEL
// ---------------------------------------------------------------------------

/// One keyword and the trailing-30-day median view count of every channel the
/// pipeline found under it, an unmeasured one counting as zero. Built by
/// `keywordDistributionProvider`.
///
/// [channelViews] is the truly-live population — channels still on the
/// roster and not counting down to archival. [archiveDueChannelViews] is the
/// same measure for channels this keyword found that ARE counting down
/// (`archive_due_at` set, still on the roster). [archivedChannelViews] is the
/// same again for channels that have since been rejected and archived (from
/// the archive row's `found_via`); it enriches the picture with what a search
/// term brought in that did *not* survive vetting. Which of the three the card
/// counts is decided at render time by the shared Live / Archive due /
/// Archived toggles — see [applySeries].
class KeywordViewData {
  const KeywordViewData({
    required this.keyword,
    required this.channelViews,
    this.archiveDueChannelViews = const [],
    this.archivedChannelViews = const [],
  });

  final String keyword;
  final List<int> channelViews;
  final List<int> archiveDueChannelViews;
  final List<int> archivedChannelViews;

  /// This keyword as it should be counted under the three series toggles: the
  /// live views when "Live" is on, the archive-due views when "Archive due" is
  /// on, the archived views when "Archived" is on, any mix when more than one
  /// is. Returns a plain [KeywordViewData] so every derived figure below
  /// (tiers, score, median) reads off the selected population with no other
  /// change. Nothing is re-fetched — this is a filter over data already in
  /// hand.
  KeywordViewData applySeries({
    required bool live,
    required bool archiveDue,
    required bool archived,
  }) {
    if (live &&
        archiveDue &&
        archived &&
        archiveDueChannelViews.isEmpty &&
        archivedChannelViews.isEmpty) {
      return this;
    }
    return KeywordViewData(
      keyword: keyword,
      channelViews: [
        if (live) ...channelViews,
        if (archiveDue) ...archiveDueChannelViews,
        if (archived) ...archivedChannelViews,
      ],
      archiveDueChannelViews: archiveDueChannelViews,
      archivedChannelViews: archivedChannelViews,
    );
  }

  /// Whether archive-due channels contributed anything to this keyword — the
  /// card shows the "Archive due" toggle only when at least one row can
  /// answer to it.
  bool get hasArchiveDueChannels => archiveDueChannelViews.isNotEmpty;

  /// Whether the archive contributed anything to this keyword — the card shows
  /// the "Archived" toggle only when at least one row can answer to it.
  bool get hasArchivedChannels => archivedChannelViews.isNotEmpty;

  int get tierUnder50k => channelViews.where((v) => v < 50000).length;
  int get tier50kTo250k =>
      channelViews.where((v) => v >= 50000 && v < 250000).length;
  int get tier250kTo1M =>
      channelViews.where((v) => v >= 250000 && v < 1000000).length;
  int get tierOver1M => channelViews.where((v) => v >= 1000000).length;

  int get totalChannels => channelViews.length;

  /// Tier-weighted score. The three tiers above 50K count linearly —
  /// `(1M+ ×8) + (250K–1M ×4) + (50K–250K ×2)` — because a channel that big is a
  /// real find. The `<50K` tier instead contributes on a log curve
  /// (`ln(n + 1) ×0.5`, so ~50 of them are worth one 50K–250K channel and the
  /// contribution flattens fast after that): a keyword that turns up nothing but
  /// sub-50K channels stays near the bottom of the sort however many hundreds of
  /// thousands it drags in, while a keyword with even a handful of genuinely
  /// large channels ranks above it.
  double get weightedScore =>
      (tierOver1M * 8.0) +
      (tier250kTo1M * 4.0) +
      (tier50kTo250k * 2.0) +
      (tierUnder50k == 0 ? 0.0 : math.log(tierUnder50k + 1) * 0.5);

  int get medianViews {
    if (channelViews.isEmpty) return 0;
    final sorted = List<int>.from(channelViews)..sort();
    final mid = sorted.length ~/ 2;
    return sorted.length.isOdd
        ? sorted[mid]
        : ((sorted[mid - 1] + sorted[mid]) ~/ 2);
  }
}

// ---------------------------------------------------------------------------
// SORT
// ---------------------------------------------------------------------------

/// How the keyword rows are ordered. The default — [tierWeightedScore] — is the
/// one the card exists to surface: keywords whose channels land in the higher
/// view tiers, counted 2/4/8 by tier, with the `<50K` tier compressed onto a
/// log curve so a pile of tiny channels can't float a keyword to the top.
enum KeywordSortBy {
  tierWeightedScore,
  channelCount,
  medianViews;

  String label(AppLocalizations l10n) => switch (this) {
        KeywordSortBy.tierWeightedScore => l10n.dashboardKeywordsSortWeighted,
        KeywordSortBy.channelCount => l10n.dashboardKeywordsSortChannels,
        KeywordSortBy.medianViews => l10n.dashboardKeywordsSortMedian,
      };

  /// A [Comparator] that orders the list descending on this measure, with a
  /// stable secondary key so equal rows keep their place across rebuilds.
  int compare(KeywordViewData a, KeywordViewData b) {
    final primary = switch (this) {
      KeywordSortBy.tierWeightedScore =>
        b.weightedScore.compareTo(a.weightedScore),
      KeywordSortBy.channelCount => b.totalChannels.compareTo(a.totalChannels),
      KeywordSortBy.medianViews => b.medianViews.compareTo(a.medianViews),
    };
    if (primary != 0) return primary;
    final byTop = b.tierOver1M.compareTo(a.tierOver1M);
    if (byTop != 0) return byTop;
    return a.keyword.toLowerCase().compareTo(b.keyword.toLowerCase());
  }
}

// ---------------------------------------------------------------------------
// TIER PALETTE — one ramp, derived from the theme
// ---------------------------------------------------------------------------

/// The four tier colors and the bar track, all pulled from the active
/// [ColorScheme] so the card follows the app theme (and any future light mode)
/// instead of carrying its own hex constants. The ramp runs from a neutral
/// outline for `<50K` up to full `primary` for `1M+`, so "more saturated" reads
/// as "more watched".
class _TierPalette {
  const _TierPalette({
    required this.track,
    required this.tiers,
    required this.under50kPeak,
  });

  final Color track;

  /// Index 0 = `<50K` … index 3 = `1M+`.
  final List<Color> tiers;

  /// color the fixed-width `<50K` segment runs toward as that tier comes to
  /// dominate a keyword — see [under50k].
  final Color under50kPeak;

  factory _TierPalette.of(ColorScheme scheme) {
    final base = scheme.outlineVariant;
    final peak = scheme.primary;
    return _TierPalette(
      track: scheme.surfaceContainerHighest,
      // The bottom tier flags "this keyword only pulled in junk", so it runs
      // toward the theme error red rather than a hardcoded brown — it tracks
      // the palette instead of fighting it. The [under50k] lerp keeps
      // partial-share bars muted; only a keyword that is ~80%+ sub-50K
      // channels reaches full saturation, which is the intended loud flag.
      under50kPeak: const Color.fromARGB(255, 143, 47, 111),
      tiers: [
        base,
        Color.lerp(base, peak, 0.45)!,
        Color.lerp(base, peak, 0.72)!,
        peak,
      ],
    );
  }

  /// Background for the fixed `<50K` segment given [share] — the fraction of the
  /// keyword's channels that land in that bottom tier. Runs from the neutral
  /// tier-0 grey up to [under50kPeak], reaching full saturation once four in
  /// five of the keyword's channels sit under 50K.
  Color under50k(double share) => Color.lerp(
        tiers[0],
        under50kPeak,
        (share / 0.8).clamp(0.0, 1.0),
      )!;

  /// Readable text over tier [index], picked by the tier color's own
  /// brightness rather than a fixed guess.
  Color onTier(int index) =>
      ThemeData.estimateBrightnessForColor(tiers[index]) == Brightness.dark
          ? Colors.white
          : Colors.black;

  /// Readable text over the `<50K` segment at the given [share].
  Color onUnder50k(double share) =>
      ThemeData.estimateBrightnessForColor(under50k(share)) == Brightness.dark
          ? Colors.white
          : Colors.black;
}

// ---------------------------------------------------------------------------
// EMBEDDABLE WIDGET
// ---------------------------------------------------------------------------

/// The ranked keyword list. Presentational: it is handed the rows, the current
/// [sort], and a callback to change it — `KeywordDistributionSection` is what
/// supplies those from Riverpod.
///
/// Rows are revealed a page at a time as the list is scrolled ([_pageSize]),
/// so a roster with hundreds of keywords costs one page of layout at startup
/// rather than all of them.
class KeywordDistributionView extends StatefulWidget {
  const KeywordDistributionView({
    super.key,
    required this.keywords,
    required this.sort,
    required this.onSortChanged,
    this.showSearchBar = true,
    this.showLegend = true,
    this.onKeywordTap,
  });

  final List<KeywordViewData> keywords;
  final KeywordSortBy sort;
  final ValueChanged<KeywordSortBy> onSortChanged;
  final bool showSearchBar;
  final bool showLegend;
  final ValueChanged<KeywordViewData>? onKeywordTap;

  @override
  State<KeywordDistributionView> createState() =>
      _KeywordDistributionViewState();
}

class _KeywordDistributionViewState extends State<KeywordDistributionView> {
  /// How many rows to add each time the list nears its end.
  static const _pageSize = 25;

  /// Start revealing the next page this far (px) before the current end.
  static const _revealThreshold = 480.0;

  final _scrollController = ScrollController();
  final _searchController = TextEditingController();

  String _query = '';
  int _visibleCount = _pageSize;

  /// Sort direction for the active [KeywordSortBy]. The list exists to surface
  /// the strongest keywords, so it opens highest-first; the arrow by the sort
  /// dropdown flips it to lowest-first and back.
  bool _ascending = false;

  /// Filtered + sorted, recomputed only when the inputs actually change — not
  /// on every scroll frame.
  late List<KeywordViewData> _rows;

  @override
  void initState() {
    super.initState();
    _rows = _computeRows();
    _scrollController.addListener(_onScroll);
  }

  @override
  void didUpdateWidget(KeywordDistributionView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.keywords, widget.keywords) ||
        oldWidget.sort != widget.sort) {
      // A rebuild is already in flight (the parent handed us a new widget), so
      // just refresh the derived fields — no setState from didUpdateWidget.
      _rows = _computeRows();
      _visibleCount = _pageSize;
    }
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  List<KeywordViewData> _computeRows() {
    final query = _query.trim().toLowerCase();
    return [
      for (final k in widget.keywords)
        // A keyword can be left with no channels once the series toggles have
        // excluded them all (a live-only term with "Live" unticked) — drop it
        // rather than draw an empty bar.
        if (k.channelViews.isNotEmpty &&
            (query.isEmpty || k.keyword.toLowerCase().contains(query)))
          k,
    ]..sort((a, b) {
        // `compare` orders descending; negate it for the lowest-first view.
        final ordered = widget.sort.compare(a, b);
        return _ascending ? -ordered : ordered;
      });
  }

  void _toggleDirection() {
    setState(() {
      _ascending = !_ascending;
      _rows = _computeRows();
      _visibleCount = _pageSize;
    });
  }

  void _onQueryChanged(String value) {
    setState(() {
      _query = value;
      _rows = _computeRows();
      _visibleCount = _pageSize;
    });
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final position = _scrollController.position;
    if (_visibleCount < _rows.length &&
        position.pixels >= position.maxScrollExtent - _revealThreshold) {
      setState(() {
        _visibleCount =
            (_visibleCount + _pageSize).clamp(0, _rows.length).toInt();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final palette = _TierPalette.of(theme.colorScheme);
    final shown = _visibleCount.clamp(0, _rows.length).toInt();
    final hasMore = shown < _rows.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.showSearchBar)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: TextField(
              controller: _searchController,
              onChanged: _onQueryChanged,
              style: theme.textTheme.bodyMedium,
              decoration: InputDecoration(
                isDense: true,
                hintText: l10n.dashboardKeywordsFilterHint,
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _query.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.close),
                        tooltip:
                            MaterialLocalizations.of(context).cancelButtonLabel,
                        onPressed: () {
                          _searchController.clear();
                          _onQueryChanged('');
                        },
                      ),
              ),
            ),
          ),
        if (widget.showLegend)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _LegendBar(
              sort: widget.sort,
              onSortChanged: widget.onSortChanged,
              ascending: _ascending,
              onToggleDirection: _toggleDirection,
              palette: palette,
            ),
          ),
        Expanded(
          child: _rows.isEmpty
              ? Center(
                  child: Text(
                    l10n.dashboardKeywordsEmpty,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                )
              : ListView.separated(
                  controller: _scrollController,
                  padding: EdgeInsets.zero,
                  itemCount: shown + (hasMore ? 1 : 0),
                  separatorBuilder: (_, __) => Divider(
                    height: 1,
                    color: theme.colorScheme.outlineVariant,
                  ),
                  itemBuilder: (context, i) {
                    if (i >= shown) {
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Center(
                          child: Text(
                            l10n.dashboardKeywordsShowingCount(
                                shown, _rows.length),
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                      );
                    }
                    final item = _rows[i];
                    return _KeywordRow(
                      data: item,
                      rank: i + 1,
                      palette: palette,
                      onTap: () {
                        final onTap = widget.onKeywordTap;
                        if (onTap != null) {
                          onTap(item);
                        } else {
                          _showDetailSheet(context, item, palette);
                        }
                      },
                    );
                  },
                ),
        ),
      ],
    );
  }

  void _showDetailSheet(
    BuildContext context,
    KeywordViewData item,
    _TierPalette palette,
  ) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) {
        final theme = Theme.of(ctx);
        final l10n = AppLocalizations.of(ctx);
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(item.keyword, style: theme.textTheme.titleLarge),
              const SizedBox(height: 4),
              Text(
                l10n.dashboardKeywordsSheetSummary(
                  formatCount(item.weightedScore.toInt()),
                  item.totalChannels,
                ),
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 16),
              _SheetTierRow(
                label: l10n.dashboardKeywordsTierOver1m,
                count: item.tierOver1M,
                color: palette.tiers[3],
              ),
              _SheetTierRow(
                label: l10n.dashboardKeywordsTier250kTo1m,
                count: item.tier250kTo1M,
                color: palette.tiers[2],
              ),
              _SheetTierRow(
                label: l10n.dashboardKeywordsTier50kTo250k,
                count: item.tier50kTo250k,
                color: palette.tiers[1],
              ),
              _SheetTierRow(
                label: l10n.dashboardKeywordsTierUnder50k,
                count: item.tierUnder50k,
                color: palette.tiers[0],
              ),
            ],
          ),
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// INTERNAL HELPER WIDGETS
// ---------------------------------------------------------------------------

class _KeywordRow extends StatelessWidget {
  const _KeywordRow({
    required this.data,
    required this.rank,
    required this.palette,
    required this.onTap,
  });

  final KeywordViewData data;
  final int rank;
  final _TierPalette palette;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            SizedBox(
              width: 28,
              child: Text(
                '$rank',
                style: theme.textTheme.labelMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
            Expanded(
              flex: 6,
              child: Text(
                data.keyword,
                style: theme.textTheme.titleSmall,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              flex: 1,
              child: Text(
                formatCompact(data.totalChannels),
                style: theme.textTheme.titleSmall?.copyWith(
                  color: theme.colorScheme.primary,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            const SizedBox(width: 20),
            Expanded(
              flex: 14,
              child: _StackedSegmentedBar(data: data, palette: palette),
            ),
            const SizedBox(width: 20),
            // Expanded(
            //   flex: 1,
            //   child: Text(
            //     formatCompact(data.medianViews),
            //     style: theme.textTheme.titleSmall?.copyWith(
            //       color: theme.colorScheme.primary,
            //       fontWeight: FontWeight.w500,
            //     ),
            //   ),
            // ),
            // const SizedBox(width: 8),
            Expanded(
              flex: 1,
              child: Text(
                formatCount(data.weightedScore.toInt()),
                style: theme.textTheme.titleSmall?.copyWith(
                  color: theme.colorScheme.primary,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The proportional stacked bar for one keyword — a segment per non-empty tier,
/// each as wide as its share of the keyword's channels.
class _StackedSegmentedBar extends StatelessWidget {
  const _StackedSegmentedBar({required this.data, required this.palette});

  final KeywordViewData data;
  final _TierPalette palette;

  @override
  Widget build(BuildContext context) {
    if (data.totalChannels == 0) {
      return Container(
        height: 27,
        decoration: BoxDecoration(
          color: palette.track,
          borderRadius: BorderRadius.circular(4),
        ),
      );
    }

    final counts = [
      data.tierUnder50k,
      data.tier50kTo250k,
      data.tier250kTo1M,
      data.tierOver1M,
    ];

    // Visible tiers, in ramp order, paired with their palette index.
    final visible = [
      for (var tier = 0; tier < counts.length; tier++)
        if (counts[tier] > 0) (tier: tier, count: counts[tier]),
    ];

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;

        // The `<50K` tier, when present, always sits first in `visible`. Pull it
        // out of the proportional split and draw it at a fixed width, colored
        // by how much of the keyword it accounts for. Everything above 50K then
        // shares what's left exactly as before, down to the same minimum-width
        // floor.
        final hasUnder50k = visible.first.tier == 0;
        final under50kShare =
            hasUnder50k ? visible.first.count / data.totalChannels : 0.0;
        final flex = hasUnder50k ? visible.sublist(1) : visible;

        // The fixed segment keeps its width even when it is the only tier — the
        // leftover space is simply left empty rather than stretched to fill.
        final under50kWidth = !hasUnder50k
            ? 0.0
            : flex.isEmpty
                ? _kUnder50kSegmentWidth * 2
                : (width > _kUnder50kSegmentWidth
                    ? _kUnder50kSegmentWidth
                    : width);

        // Every remaining segment gets at least enough room for its number; the
        // rest of the bar is handed out in proportion to each tier's count.
        final flexAvail =
            width - under50kWidth - _kSegmentGap * (visible.length - 1);
        final flexTotal = flex.fold(0, (sum, s) => sum + s.count);
        final minEach =
            flex.isNotEmpty && flexAvail >= _kMinSegmentWidth * flex.length
                ? _kMinSegmentWidth
                : 0.0;
        final free = flexAvail - minEach * flex.length;

        final flexWidth = {
          for (final s in flex)
            s.tier: minEach +
                (free > 0 && flexTotal > 0 ? free * s.count / flexTotal : 0.0),
        };

        return ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: SizedBox(
            height: 27,
            child: Row(
              children: [
                for (var i = 0; i < visible.length; i++) ...[
                  if (i > 0) const SizedBox(width: _kSegmentGap),
                  if (visible[i].tier == 0)
                    _Segment(
                      count: visible[i].count,
                      width: under50kWidth,
                      showLabel: true,
                      background: palette.under50k(under50kShare),
                      foreground: palette.onUnder50k(under50kShare),
                    )
                  else
                    _Segment(
                      count: visible[i].count,
                      width: flexWidth[visible[i].tier]!,
                      showLabel: minEach > 0,
                      background: palette.tiers[visible[i].tier],
                      foreground: palette.onTier(visible[i].tier),
                    ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Reserved so the smallest tier still fits a 3–4 digit count, plus the hairline
/// separator between adjacent segments.
const double _kMinSegmentWidth = 65;
const double _kSegmentGap = 2;

/// The `<50K` tier is taken out of the proportional split and always drawn at
/// this width, so its count stays readable however few channels the keyword has
/// there. Sized like [_kMinSegmentWidth] to fit a 3–4 digit count.
const double _kUnder50kSegmentWidth = 65;

class _Segment extends StatelessWidget {
  const _Segment({
    required this.count,
    required this.width,
    required this.showLabel,
    required this.background,
    required this.foreground,
  });

  final int count;
  final double width;
  final bool showLabel;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      color: background,
      alignment: Alignment.center,
      child: showLabel
          ? Text(
              formatCompact(count),
              maxLines: 1,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: foreground,
                    fontWeight: FontWeight.bold,
                  ),
            )
          : null,
    );
  }
}

/// The sort dropdown and the tier key, on one line.
class _LegendBar extends StatelessWidget {
  const _LegendBar({
    required this.sort,
    required this.onSortChanged,
    required this.ascending,
    required this.onToggleDirection,
    required this.palette,
  });

  final KeywordSortBy sort;
  final ValueChanged<KeywordSortBy> onSortChanged;

  /// Current sort direction, and the callback that flips it — the arrow button
  /// next to the dropdown, driven from [_KeywordDistributionViewState].
  final bool ascending;
  final VoidCallback onToggleDirection;

  final _TierPalette palette;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        SizedBox(
          width: 28,
          child: IconButton(
            alignment: AlignmentGeometry.centerStart,
            visualDensity: VisualDensity.compact,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
            iconSize: 18,
            tooltip: ascending
                ? l10n.dashboardKeywordsSortLowestFirst
                : l10n.dashboardKeywordsSortHighestFirst,
            icon: Icon(
              ascending ? Icons.arrow_upward : Icons.arrow_downward,
              color: theme.colorScheme.primary,
            ),
            onPressed: onToggleDirection,
          ),
        ),
        Flexible(
          flex: 6,
          child: DropdownButton<KeywordSortBy>(
            value: sort,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            isDense: true,
            isExpanded: true,
            underline: const SizedBox.shrink(),
            borderRadius: BorderRadius.circular(5),
            style: theme.textTheme.labelLarge,
            items: [
              for (final option in KeywordSortBy.values)
                DropdownMenuItem(
                  value: option,
                  child: Text(
                    option.label(l10n),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            onChanged: (value) {
              if (value != null) onSortChanged(value);
            },
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          flex: 1,
          child: Text(
            'Channels',
            textAlign: TextAlign.start,
            style: theme.textTheme.titleSmall?.copyWith(
              color: theme.colorScheme.primary,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(width: 20),
        Expanded(
          flex: 14,
          child: Row(mainAxisSize: MainAxisSize.max, children: [
            Text(
              'Channels / Median views:',
              style: theme.textTheme.titleSmall?.copyWith(),
            ),
            const SizedBox(width: 20),
            Expanded(
              flex: 1,
              child: Wrap(
                alignment: WrapAlignment.spaceBetween,
                spacing: 12,
                runSpacing: 4,
                children: [
                  _LegendChip(label: '<50K', color: palette.under50kPeak),
                  _LegendChip(label: '50K–250K', color: palette.tiers[1]),
                  _LegendChip(label: '250K–1M', color: palette.tiers[2]),
                  _LegendChip(label: '1M+', color: palette.tiers[3]),
                ],
              ),
            )
          ]),
        ),
        const SizedBox(width: 20),
        // Expanded(
        //   flex: 1,
        //   child: SizedBox(
        //     width: 12,
        //     child: Text(
        //       "Views",
        //       textAlign: TextAlign.start,
        //       style: theme.textTheme.titleSmall?.copyWith(
        //         color: theme.colorScheme.primary,
        //         fontWeight: FontWeight.w700,
        //       ),
        //     ),
        //   ),
        // ),
        // const SizedBox(width: 8),
        Expanded(
          flex: 1,
          child: SizedBox(
            width: 12,
            child: Text(
              'Score',
              textAlign: TextAlign.start,
              style: theme.textTheme.titleSmall?.copyWith(
                color: theme.colorScheme.primary,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _LegendChip extends StatelessWidget {
  const _LegendChip({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: theme.textTheme.labelSmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

class _SheetTierRow extends StatelessWidget {
  const _SheetTierRow({
    required this.label,
    required this.count,
    required this.color,
  });

  final String label;
  final int count;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 8),
          Expanded(child: Text(label, style: theme.textTheme.bodyMedium)),
          Text(
            formatCount(count),
            style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}
