import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/events/refresh_when_visible.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/theme/app_theme.dart';
import 'package:gratovo_toolbox/core/theme/gradient_text.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/data/models/channel_run.dart';
import 'package:gratovo_toolbox/data/models/channel_stats.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/features/dashboard/application/channel_analytics_controller.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/widgets/channel_series_toggle.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/widgets/glow_border.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/widgets/mini_charts.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/widgets/stepped_number_field.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/backfill_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/video_catchup_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// What the pipeline has actually found, as numbers rather than as a list.
///
/// The Dashboard's four tiles answer "what should I do next". This answers the
/// other question the same page is asked — "what have we got" — which the
/// Influencers list can only answer by being scrolled. Seven breakdowns over one
/// filtered population, from one call: see `ChannelStatsRepository.load` for why
/// it is one call and not seven.
///
/// **Full authority only**, and the section is absent rather than disabled for
/// anyone else — see [canSeeChannelAnalyticsProvider]. The gate is drawn here,
/// at the top of the widget, so there is exactly one place to read for whether
/// this is shown.
///
/// **The one thing in the app that refreshes on visibility rather than on
/// change.** Everything else re-reads the moment its data moves, because
/// everything else is an indexed count or a page of rows. This is an aggregate
/// over every channel the agency has ever found, and the dashboard tab stays
/// alive in the shell's `IndexedStack` whether or not anyone is looking at it —
/// so recomputing it the instant somebody tags a channel two tabs away would
/// spend real frames on a page nobody can see. [RefreshWhenVisible] holds the
/// change until this tab is on screen; the refresh button beside the title is
/// still there for anyone who wants it sooner.
class ChannelAnalyticsSection extends ConsumerStatefulWidget {
  const ChannelAnalyticsSection({
    super.key,
    this.filtersKey,
    this.initiallyExpanded = false,
  });

  /// Placed on the section's own inline filter row so the Dashboard can tell
  /// when it has scrolled out of view and reveal the pinned copy that sits
  /// under the app bar. See [DashboardScreen].
  final Key? filtersKey;

  /// Whether the charts are shown on first build. Off by default: the section is
  /// the heaviest thing on the Dashboard — eight aggregates over every channel
  /// the agency has found — and a landing page should not pay for it until
  /// somebody asks. The header row is always there; tapping it (or its chevron)
  /// expands the rest, and nothing behind it is fetched until then.
  final bool initiallyExpanded;

  @override
  ConsumerState<ChannelAnalyticsSection> createState() =>
      _ChannelAnalyticsSectionState();
}

class _ChannelAnalyticsSectionState
    extends ConsumerState<ChannelAnalyticsSection> {
  late bool _expanded = widget.initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    if (!ref.watch(canSeeChannelAnalyticsProvider)) {
      return const SizedBox.shrink();
    }

    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    // Collapsed: just the header, in a plain card, and nothing behind it read.
    if (!_expanded) {
      return Card(
        child: InkWell(
          onTap: () => setState(() => _expanded = true),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.dashboardAnalyticsTitle,
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                IconButton(
                  tooltip: l10n.commonExpand,
                  icon: const Icon(Icons.unfold_more, size: 20),
                  onPressed: () => setState(() => _expanded = true),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final query = ref.watch(channelStatsFilterProvider);
    final stats = ref.watch(channelStatsProvider(query));
    final series = ref.watch(channelStatsSeriesProvider);

    // The highlight travels while the pipeline is doing the work this section
    // reports on — a keyword search, a one-channel backfill, or the background
    // video catch-up — so the numbers being watched are visibly in motion.
    final pipelineBusy = ref.watch(activeSearchRunControllerProvider)?.status ==
            SearchRunStatus.running ||
        ref.watch(backfillRunControllerProvider)?.status ==
            ChannelRunStatus.running ||
        ref.watch(videoCatchUpControllerProvider).status ==
            VideoCatchUpStatus.running;

    return RefreshWhenVisible(
      domains: const {DataDomain.channels},
      onRefresh: (ref) {
        ref.invalidate(channelStatsProvider);
        ref.invalidate(channelStatsFacetsProvider);
      },
      child:
          _card(context, ref, l10n, theme, query, stats, series, pipelineBusy),
    );
  }

  /// The section itself, split out only so the visibility wrapper above reads
  /// as one thing rather than as a frame around ninety lines.
  Widget _card(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
    ThemeData theme,
    ChannelStatsQuery query,
    AsyncValue<ChannelStats> stats,
    ({bool live, bool archiveDue, bool archived}) series,
    bool pipelineBusy,
  ) {
    // The outline is always drawn. Warning tone when the view is scoped by a
    // real filter; primary while a search or backfill is running; a dim neutral
    // outline the rest of the time. The highlight only travels while busy.
    final filtered = query.hasEffectiveFilter;
    final glowColor = filtered
        ? Theme.of(context).extension<GratovoStatusColors>()?.warning ??
            theme.colorScheme.error
        : pipelineBusy
            ? theme.colorScheme.primary
            : theme.colorScheme.outline;
    // How solid the static outline sits: prominent when it means something,
    // dim when it is just framing the card.
    final baseAlpha = filtered ? 0.9 : (pipelineBusy ? 0.25 : 0.35);

    final card = Card(
      color: AppColors.darkCardBright.withAlpha(100),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                // The title flexes and the actions keep their natural width,
                // not the other way round. With the title sized to its text
                // and the action row Expanded, a phone-width card left the two
                // icon buttons 43 logical pixels to fit 96 into — a 53px
                // overflow stripe across the header. A heading that
                // ellipsises is the right thing to give up first; a refresh
                // button that has been clipped off the edge is not.
                Expanded(
                  child: GradientText(
                    l10n.dashboardAnalyticsTitle,
                    style: theme.textTheme.titleMedium,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Row(mainAxisSize: MainAxisSize.min, children: [
                  if (!query.isUnfiltered)
                    TextButton.icon(
                      icon: const Icon(Icons.filter_alt_off_outlined, size: 18),
                      label: Text(l10n.dashboardAnalyticsClearFilters),
                      // Same warning tone as the animated outline, so the "you
                      // are looking at a filtered view" cue is one color.
                      style: filtered
                          ? TextButton.styleFrom(foregroundColor: glowColor)
                          : null,
                      onPressed: () =>
                          ref.read(channelStatsFilterProvider.notifier).clear(),
                    ),
                  IconButton(
                    tooltip: l10n.commonRefresh,
                    icon: const Icon(Icons.refresh),
                    onPressed: () {
                      ref.invalidate(channelStatsProvider);
                      ref.invalidate(channelStatsFacetsProvider);
                    },
                  ),
                  IconButton(
                    tooltip: l10n.commonCollapse,
                    icon: const Icon(Icons.unfold_less, size: 20),
                    onPressed: () => setState(() => _expanded = false),
                  ),
                ])
              ],
            ),
            const SizedBox(height: 4),
            Text(
              l10n.dashboardAnalyticsBody,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 16),
            _Filters(key: widget.filtersKey, query: query),
            const SizedBox(height: 16),
            const Divider(height: 1),
            const SizedBox(height: 16),
            stats.when(
              // The charts stay up while the numbers behind them are re-read.
              // This section costs a couple of hundred milliseconds over a
              // hundred thousand channels, and blanking it to a spinner on
              // every visit after a change would make the page feel slower than
              // it is.
              skipLoadingOnReload: true,
              // A fixed height while loading, so the page below does not jump
              // up and then back down every time a dropdown changes. The
              // charts settle into roughly this much space — three stacked
              // full-width histograms and a pair of ranked lists beneath.
              loading: () => const SizedBox(
                height: 720,
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (error, _) => _Failed(
                message: l10n.dashboardAnalyticsFailed,
                onRetry: () => ref.invalidate(channelStatsProvider(query)),
                retryLabel: l10n.commonRetry,
              ),
              data: (data) => data.channels == 0
                  ? Padding(
                      padding: const EdgeInsets.symmetric(vertical: 32),
                      child: Center(
                        child: Text(l10n.dashboardAnalyticsNoChannels),
                      ),
                    )
                  : _Body(
                      stats: data,
                      l10n: l10n,
                      showLive: series.live,
                      showArchiveDue: series.archiveDue,
                      showArchived: series.archived,
                    ),
            ),
          ],
        ),
      ),
    );

    // A zero min-subs / min-avg-views bound is not a filter — see
    // [ChannelStatsQuery.hasEffectiveFilter].
    return GlowBorder(
      color: glowColor,
      baseAlpha: baseAlpha,
      animate: pipelineBusy,
      child: card,
    );
  }
}

/// The filter bar, lifted out of [ChannelAnalyticsSection]'s card so it can be
/// mounted once, always visible, directly under the app bar — see
/// [DashboardScreen]. Full authority only, the same gate the section draws, and
/// nothing at all for anyone else. It reads and writes the same app-scoped
/// [channelStatsFilterProvider], so it and the section's own inline copy stay
/// in lock-step with no wiring between them.
class ChannelAnalyticsFilterBar extends ConsumerWidget {
  const ChannelAnalyticsFilterBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(canSeeChannelAnalyticsProvider)) {
      return const SizedBox.shrink();
    }
    final query = ref.watch(channelStatsFilterProvider);
    return Material(
      color: Theme.of(context).colorScheme.surface,
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 10),
        child: _Filters(query: query),
      ),
    );
  }
}

/// A Wrap of bounded, ellipsized controls, for the two reasons the Archive
/// page's controls are: a Row cannot shrink a TextField below its intrinsic
/// width and overflows instead, and a dropdown sizes itself to its widest item
/// — which for the country list is however long the longest code happens to be
/// today.
///
/// Committing a filter is deliberate rather than live. A typed number applies
/// on submit or on focus loss, not per keystroke: "1000" typed into a min-subs
/// box would otherwise fire four aggregates over the whole table, three of them
/// for a bound nobody meant. The wheel and the arrows on [SteppedNumberField]
/// are discrete actions, so those commit at once — one aggregate each, the same
/// as changing a dropdown.
class _Filters extends ConsumerWidget {
  const _Filters({super.key, required this.query});

  final ChannelStatsQuery query;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final facets =
        ref.watch(channelStatsFacetsProvider).value ?? ChannelStatsFacets.empty;
    final notifier = ref.read(channelStatsFilterProvider.notifier);

    // The tint a control wears when its value is actually narrowing the
    // population — same warning tone as the section border. A cleared field, or
    // a zero on a lower bound (which excludes nothing), counts as no effect.
    final warn = Theme.of(context).extension<GratovoStatusColors>()?.warning ??
        Theme.of(context).colorScheme.error;
    Color? tintIf(bool active) => active ? warn : null;

    return Wrap(
      spacing: 12,
      runSpacing: 12,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        _Dropdown<String>(
          label: l10n.dashboardAnalyticsFilterCountry,
          value: query.country,
          values: facets.countries,
          display: (code) => code,
          activeColor: tintIf(query.country != null),
          onChanged: (value) =>
              notifier.setQuery(query.copyWith(country: () => value)),
        ),
        _Dropdown<PipelineStage>(
          label: l10n.dashboardAnalyticsFilterStage,
          value: query.stage,
          values: facets.stages,
          display: (stage) => stage.label(l10n),
          activeColor: tintIf(query.stage != null),
          onChanged: (value) =>
              notifier.setQuery(query.copyWith(stage: () => value)),
        ),
        _Dropdown<VettingStatus>(
          label: l10n.dashboardAnalyticsFilterVetting,
          value: query.vetting,
          values: facets.vetting,
          display: (status) => status.label(l10n),
          activeColor: tintIf(query.vetting != null),
          onChanged: (value) =>
              notifier.setQuery(query.copyWith(vetting: () => value)),
        ),
        _Dropdown<ChannelTag>(
          label: l10n.dashboardAnalyticsFilterTag,
          value: query.tag,
          values: facets.tags,
          display: (tag) => tag.label(l10n),
          activeColor: tintIf(query.tag != null),
          onChanged: (value) =>
              notifier.setQuery(query.copyWith(tag: () => value)),
        ),
        SteppedNumberField(
          label: l10n.dashboardAnalyticsFilterMinSubs,
          value: query.minSubscribers,
          step: 10000,
          activeColor: tintIf((query.minSubscribers ?? 0) != 0),
          onCommitted: (value) =>
              notifier.setQuery(query.copyWith(minSubscribers: () => value)),
        ),
        SteppedNumberField(
          label: l10n.dashboardAnalyticsFilterMaxSubs,
          value: query.maxSubscribers,
          step: 10000,
          clearBelowZero: true,
          activeColor: tintIf(query.maxSubscribers != null),
          onCommitted: (value) =>
              notifier.setQuery(query.copyWith(maxSubscribers: () => value)),
        ),
        SteppedNumberField(
          label: l10n.dashboardAnalyticsFilterMinAvgViews,
          value: query.minMedianViews,
          step: 10000,
          activeColor: tintIf((query.minMedianViews ?? 0) != 0),
          onCommitted: (value) =>
              notifier.setQuery(query.copyWith(minMedianViews: () => value)),
        ),
        SteppedNumberField(
          label: l10n.dashboardAnalyticsFilterMaxAvgViews,
          value: query.maxMedianViews,
          step: 10000,
          clearBelowZero: true,
          activeColor: tintIf(query.maxMedianViews != null),
          onCommitted: (value) =>
              notifier.setQuery(query.copyWith(maxMedianViews: () => value)),
        ),
        SteppedNumberField(
          label: l10n.dashboardAnalyticsFilterMinVideos,
          value: query.minVideosLast30,
          width: 220,
          clearBelowZero: true,
          activeColor: tintIf((query.minVideosLast30 ?? 0) != 0),
          onCommitted: (value) =>
              notifier.setQuery(query.copyWith(minVideosLast30: () => value)),
        ),
        // The Live / Archived series toggles ride along with the filters rather
        // than sitting down among the charts, so they stay on screen in the
        // pinned filter bar once the section has scrolled away — and so the
        // keyword card, which reads the same provider, can be steered from here
        // too. Shown whether or not the archive has anything in the current
        // view: it is a control, and a control that vanishes is one people stop
        // trusting is there.
        const ChannelSeriesToggle(),
      ],
    );
  }
}

/// One filter dropdown, with an "Any" entry that clears it.
///
/// Renders nothing at all when the facet list is empty. An enabled dropdown
/// whose only option is "Any" invites a click that does nothing, and an empty
/// facet list means the data genuinely has no values to filter on — a fresh
/// database has no countries yet.
class _Dropdown<T> extends StatelessWidget {
  const _Dropdown({
    required this.label,
    required this.value,
    required this.values,
    required this.display,
    required this.onChanged,
    this.activeColor,
  });

  final String label;
  final T? value;
  final List<T> values;
  final String Function(T value) display;
  final ValueChanged<T?> onChanged;

  /// Non-null when this filter is actually constraining the population — the
  /// field's outline and label take this color so a scoped filter is visible
  /// on the control itself, not just on the section border.
  final Color? activeColor;

  @override
  Widget build(BuildContext context) {
    if (values.isEmpty) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final tint = activeColor;

    return SizedBox(
      width: 168,
      child: DropdownButtonFormField<T?>(
        initialValue: value,
        isExpanded: true,
        decoration: InputDecoration(
          labelText: label,
          isDense: true,
          border: const OutlineInputBorder(),
          enabledBorder: tint == null
              ? null
              : OutlineInputBorder(borderSide: BorderSide(color: tint)),
          focusedBorder: tint == null
              ? null
              : OutlineInputBorder(
                  borderSide: BorderSide(color: tint, width: 2)),
          labelStyle: tint == null ? null : TextStyle(color: tint),
          floatingLabelStyle: tint == null ? null : TextStyle(color: tint),
        ),
        items: [
          DropdownMenuItem(
            value: null,
            child: Text(
              l10n.dashboardAnalyticsFilterAny,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          for (final item in values)
            DropdownMenuItem(
              value: item,
              child: Text(display(item), overflow: TextOverflow.ellipsis),
            ),
        ],
        onChanged: onChanged,
      ),
    );
  }
}

/// The headline figures and the six charts.
class _Body extends ConsumerWidget {
  const _Body({
    required this.stats,
    required this.l10n,
    required this.showLive,
    required this.showArchiveDue,
    required this.showArchived,
  });

  final ChannelStats stats;
  final AppLocalizations l10n;

  /// The three [ChannelSeriesToggle] checkboxes, now living up in the filter
  /// row. When one is off, that series is dropped from every chart and from
  /// the figures' second lines — the numbers behind them are untouched, so
  /// re-checking brings it straight back with no re-fetch.
  final bool showLive;
  final bool showArchiveDue;
  final bool showArchived;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    // Only the figures the archive can actually answer carry a second line —
    // subscriber count, combined reach, a (lifetime) average-views mean, and
    // now the current month's finds. See [ChannelStats.archivedChannels]. The
    // "Archived" checkbox hides that line too, so it tracks the charts.
    final hasArchive = stats.archivedChannels > 0;
    final showArchivedFigures = hasArchive && showArchived;
    // Archive-due is a subset of every filtered population, so unlike the
    // archive there is no breakdown it cannot answer — only whether the
    // filter happens to have caught any.
    final hasArchiveDue = stats.archiveDueChannels > 0;
    final showArchiveDueFigures = hasArchiveDue && showArchiveDue;

    // The last of the twelve month buckets is the current calendar month, on
    // both the server and the mirror (the series is generated in order, ending
    // at `date_trunc('month', now())`). Its live count is "Found channels this
    // month"; its archived count is the sub-line under it.
    final thisMonth = stats.byMonth.isEmpty ? null : stats.byMonth.last;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 24,
          runSpacing: 16,
          children: [
            _Figure(
              label: l10n.dashboardAnalyticsStatChannels,
              value: formatCount(stats.channels),
              archiveDueValue: showArchiveDueFigures
                  ? l10n.dashboardAnalyticsArchiveDueCount(
                      formatCompact(stats.archiveDueChannels))
                  : null,
              archivedValue: showArchivedFigures
                  ? l10n.dashboardAnalyticsArchivedCount(
                      formatCompact(stats.archivedChannels))
                  : null,
            ),
            _Figure(
              label: l10n.dashboardAnalyticsStatMedianSubs,
              value: formatCompact(stats.medianSubscribers),
              hint: l10n.dashboardAnalyticsMeanVsMedian,
            ),
            _Figure(
              label: l10n.dashboardAnalyticsStatMeanSubs,
              value: formatCompact(stats.meanSubscribers),
              hint: l10n.dashboardAnalyticsSubsCoverage(
                stats.withSubscribers,
                stats.channels,
              ),
            ),
            _Figure(
              label: l10n.dashboardAnalyticsStatTotalSubs,
              value: formatCompact(stats.totalSubscribers),
              archiveDueValue:
                  showArchiveDueFigures && stats.archiveDueTotalSubscribers > 0
                      ? l10n.dashboardAnalyticsArchiveDueValue(
                          formatCompact(stats.archiveDueTotalSubscribers))
                      : null,
              archivedValue:
                  showArchivedFigures && stats.archivedTotalSubscribers > 0
                      ? l10n.dashboardAnalyticsArchivedValue(
                          formatCompact(stats.archivedTotalSubscribers))
                      : null,
            ),
            _Figure(
              label: l10n.dashboardAnalyticsStatFound,
              value: formatCount(thisMonth?.count ?? 0),
              archiveDueValue:
                  showArchiveDueFigures && (thisMonth?.archiveDue ?? 0) > 0
                      ? l10n.dashboardAnalyticsArchiveDueCount(
                          formatCompact(thisMonth!.archiveDue))
                      : null,
              archivedValue:
                  showArchivedFigures && (thisMonth?.archived ?? 0) > 0
                      ? l10n.dashboardAnalyticsArchivedCount(
                          formatCompact(thisMonth!.archived))
                      : null,
            ),
            _Figure(
              label: l10n.dashboardAnalyticsStatUploads,
              value: formatCount(stats.videosLast30),
            ),
            _Figure(
              label: l10n.dashboardAnalyticsStatAvgViews,
              value: formatCompact(stats.medianViews),
              archiveDueValue:
                  showArchiveDueFigures && stats.archiveDueMedianViews != null
                      ? l10n.dashboardAnalyticsArchiveDueValue(
                          formatCompact(stats.archiveDueMedianViews))
                      : null,
              archivedValue:
                  showArchivedFigures && stats.archivedMedianViews != null
                      ? l10n.dashboardAnalyticsArchivedValue(
                          formatCompact(stats.archivedMedianViews))
                      : null,
              hint: showArchivedFigures && stats.archivedMedianViews != null
                  ? l10n.dashboardAnalyticsArchivedViewsNote
                  : null,
            ),
            _Figure(
              label: l10n.dashboardAnalyticsStatWithDeal,
              value: formatCount(stats.withADeal),
            ),
          ],
        ),
        const SizedBox(height: 24),
        // The three distributions get the whole width, one under the other.
        // They are histograms: what you read off them is the SHAPE of the
        // curve, and a shape drawn across half a window is the same shape at
        // half the resolution — the 50K-100K dip either side of which the
        // sourcing changes is a bar you either can or cannot see. The columns
        // spend the width rather than centring in it; see [ColumnChart].
        //
        // Stacking them full-width also puts the subscriber tiers directly
        // above the view tiers at the same cut points and the same pixel
        // width, which is the comparison the two charts exist to support.
        for (final panel in _distributions(ref)) ...[
          panel,
          const SizedBox(height: 40),
        ],
        // The ranked lists pair up instead: two columns above 900px, one
        // below. Not a grid — the lists are different heights, and a grid
        // would pad every cell to the tallest. A BarList gains nothing from
        // extra width (its bars are already relative to the longest one), so
        // giving it the full span would only stretch the whitespace.
        // CHANGED: made it only countries in one side and the rest on the other.
        LayoutBuilder(
          builder: (context, constraints) {
            final panels = _rankings();
            if (constraints.maxWidth < 900) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final panel in panels) ...[
                    panel,
                    const SizedBox(height: 20),
                  ],
                ],
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (var i = 0; i < panels.length; i += 4) ...[
                        panels[i],
                        const SizedBox(height: 20),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 32),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (var i = 1; i < panels.length; i += 1) ...[
                        panels[i],
                        const SizedBox(height: 20),
                      ],
                    ],
                  ),
                ),
              ],
            );
          },
        ),
        Text(
          l10n.dashboardAnalyticsTagsNote,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }

  /// The buckets a chart should draw given the three [ChannelSeriesToggle]
  /// boxes: each of [StatBucket.count], [StatBucket.archiveDue] and
  /// [StatBucket.archived] zeroed when its own checkbox is off. The three are
  /// disjoint populations, so this is independent per field — no re-deriving
  /// one from another. The list is handed straight back — the common case —
  /// when all three are on.
  List<StatBucket> _visible(List<StatBucket> buckets) {
    if (showLive && showArchiveDue && showArchived) return buckets;
    return [
      for (final b in buckets)
        StatBucket(
          key: b.key,
          count: showLive ? b.count : 0,
          archiveDue: showArchiveDue ? b.archiveDue : 0,
          archived: showArchived ? b.archived : 0,
        ),
    ];
  }

  /// The full-width histograms, in reading order: how big the channels are,
  /// how watched they are, and when we found them.
  ///
  /// Subscribers and views are adjacent and cut at the same boundaries on
  /// purpose — the pair is what answers "are the channels we are finding
  /// actually watched in proportion to their size", which neither chart
  /// answers alone.
  List<Widget> _distributions(WidgetRef ref) {
    return [
      _Panel(
        title: l10n.dashboardAnalyticsChartTiers,
        child: ColumnChart(
          buckets: _visible(stats.byTier),
          // The tier keys ARE the labels ("<10K", "1M+") — the same six
          // buckets whatever the filter, so they are comparable between two
          // views of this page. See the SQL for why they are fixed.
          label: (key) => key,
          emptyMessage: l10n.dashboardAnalyticsNothingHere,
          independentKeys: ref.watch(tiersIndependentKeysProvider),
          onIndependentKeysChanged: (keys) =>
              ref.read(tiersIndependentKeysProvider.notifier).set(keys),
          independentToggleTooltip: l10n.dashboardAnalyticsToggleIndependent,
        ),
      ),
      _Panel(
        title: l10n.dashboardAnalyticsChartViewTiers,
        // Says how many of the bars' channels were actually measured: the
        // rest count as zero and sit in <10K (see `ChannelStats.byViewTier`),
        // and without the line a tall bottom bar reads as thousands of
        // measured-and-dead channels rather than as the auto-clean's
        // never-fetched ones. The archived segment's lifetime-vs-30-day
        // caveat is carried on the "Average views" figure's tooltip rather
        // than piled on here.
        subtitle: l10n.dashboardAnalyticsViewsNote(
          stats.withMedianViews,
          stats.channels,
        ),
        child: ColumnChart(
          buckets: _visible(stats.byViewTier),
          label: (key) => key,
          emptyMessage: l10n.dashboardAnalyticsNothingHere,
          independentKeys: ref.watch(viewTiersIndependentKeysProvider),
          onIndependentKeysChanged: (keys) =>
              ref.read(viewTiersIndependentKeysProvider.notifier).set(keys),
          independentToggleTooltip: l10n.dashboardAnalyticsToggleIndependent,
        ),
      ),
      _Panel(
        title: l10n.dashboardAnalyticsChartDiscovered,
        child: ColumnChart(
          buckets: _visible(_monthsWithFinds()),
          label: _monthLabel,
          columnWidth: 40,
          emptyMessage: l10n.dashboardAnalyticsNothingHere,
        ),
      ),
    ];
  }

  /// The discovered-per-month series trimmed to the span that actually holds
  /// finds: empty months at each end are dropped, gaps in the middle are kept.
  /// The source is twelve months, so the result is never longer than that.
  List<StatBucket> _monthsWithFinds() {
    final months = stats.byMonth;
    final first = months.indexWhere((b) => b.total > 0);
    if (first < 0) return months; // no finds in any month — leave it as-is
    final last = months.lastIndexWhere((b) => b.total > 0);
    return months.sublist(first, last + 1);
  }

  /// The ranked breakdowns, laid out two to a row. Ordered so countries — the
  /// one people scan first — lands in the left column, where the eye starts.
  List<Widget> _rankings() {
    return [
      _Panel(
        title: l10n.dashboardAnalyticsChartCountries,
        subtitle: l10n.dashboardAnalyticsCountriesNote(stats.withoutCountry),
        child: BarList(
          buckets: _visible(stats.byCountry),
          label: (key) => key,
          emptyMessage: l10n.dashboardAnalyticsNothingHere,
        ),
      ),
      _Panel(
        title: l10n.dashboardAnalyticsChartStages,
        child: BarList(
          buckets: _visible(stats.byStage),
          label: (key) => PipelineStage.fromWire(key).label(l10n),
          // The colors the rest of the app already gives these values. A
          // second palette here would make one stage two colors on two
          // screens.
          color: (key, context) => PipelineStage.fromWire(key).color(context),
          emptyMessage: l10n.dashboardAnalyticsNothingHere,
        ),
      ),
      _Panel(
        title: l10n.dashboardAnalyticsChartTags,
        child: BarList(
          buckets: _visible(stats.byTag),
          label: (key) =>
              ChannelTag.fromWire(key)?.label(l10n) ??
              l10n.dashboardAnalyticsUntagged,
          // No per-tag palette here. Unlike stage and vetting, this chart
          // carries an archived series, so a per-key color would fight the
          // one distinction that matters on it — still live vs. already
          // archived. Left to [BarList]'s default: primary for the live
          // segment, tertiary for the archived one, the same two colors the
          // rest of the section's archived breakdowns use.
          emptyMessage: l10n.dashboardAnalyticsNothingHere,
        ),
      ),
      _Panel(
        title: l10n.dashboardAnalyticsChartVetting,
        child: BarList(
          buckets: _visible(stats.byVetting),
          label: (key) => _vetting(key).label(l10n),
          color: (key, context) => _vetting(key).color(context),
          emptyMessage: l10n.dashboardAnalyticsNothingHere,
        ),
      ),
    ];
  }

  /// `2026-08` -> `08/2026`. The full year rather than `08/26`: a two-digit
  /// year reads as a day-of-month, so `08/26` was being taken for the 26th of
  /// August rather than August 2026. The four-digit form can only be a year,
  /// and still fits the 40px column across two lines.
  static String _monthLabel(String key) {
    final parts = key.split('-');
    if (parts.length != 2) return key;
    return '${parts[1]}/${parts[0]}';
  }

  /// Not [VettingStatus.values.byName]: that throws on an unrecognized value,
  /// and one row somebody edited by hand should not take down the chart.
  static VettingStatus _vetting(String wire) {
    for (final status in VettingStatus.values) {
      if (status.name == wire) return status;
    }
    return VettingStatus.newlyFound;
  }
}

/// One headline number, optionally with the archive-due and archived counts
/// under it, each in its own color.
class _Figure extends StatelessWidget {
  const _Figure({
    required this.label,
    required this.value,
    this.hint,
    this.archiveDueValue,
    this.archivedValue,
  });

  final String label;
  final String value;
  final String? hint;

  /// The already-formatted archive-due figure ("+3 archive due"), drawn in
  /// [AppColors.archiveDueSeries] beneath [value] and above [archivedValue].
  /// Null on every figure archive-due channels are not broken out for.
  final String? archiveDueValue;

  /// The already-formatted archived figure ("+120 archived"), drawn as a small
  /// [ColorScheme.tertiary] line beneath [value]. Null on every figure the
  /// archive cannot answer, which is most of them.
  final String? archivedValue;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(value, style: theme.textTheme.headlineSmall),
        if (archiveDueValue != null)
          Text(
            archiveDueValue!,
            style: theme.textTheme.labelSmall?.copyWith(
              color: AppColors.archiveDueSeries,
            ),
          ),
        if (archivedValue != null)
          Text(
            archivedValue!,
            style: theme.textTheme.labelSmall?.copyWith(
              color: AppColors.archivedSeries,
            ),
          ),
        const SizedBox(height: 2),
        Text(
          label,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
    return hint == null ? content : Tooltip(message: hint, child: content);
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.title, required this.child, this.subtitle});

  final String title;
  final String? subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: theme.textTheme.titleSmall),
        if (subtitle != null) ...[
          const SizedBox(height: 2),
          Text(
            subtitle!,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
        const SizedBox(height: 20),
        child,
      ],
    );
  }
}

class _Failed extends StatelessWidget {
  const _Failed({
    required this.message,
    required this.onRetry,
    required this.retryLabel,
  });

  final String message;
  final VoidCallback onRetry;
  final String retryLabel;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Row(
        children: [
          Expanded(child: Text(message)),
          TextButton(onPressed: onRetry, child: Text(retryLabel)),
        ],
      ),
    );
  }
}
