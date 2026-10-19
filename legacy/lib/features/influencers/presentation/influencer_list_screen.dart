import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/images/image_preferences.dart';
import 'package:gratovo_toolbox/core/presence/presence_widgets.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/utils/responsive.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/data/models/video.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_filter_controller.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_page_controller.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_pin_controller.dart';
import 'package:gratovo_toolbox/features/influencers/application/latest_videos_controller.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/add_influencer_dialog.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/channel_arrivals_notice.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/influencer_card.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/influencer_filter_sheet.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/influencer_list_tile.dart';
import 'package:gratovo_toolbox/features/roster/presentation/widgets/roster_section_switcher.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Every discovered channel, filtered and sorted by the database and loaded a
/// page at a time. Tapping a row routes to `/influencers/:id`; right-clicking
/// one offers its tag editor without leaving the page.
///
/// The list no longer fetches everything and narrows it in Dart. That is the
/// substantive change here: filtering used to happen after the fetch, so a
/// "min subscribers" filter could not make the request smaller, and showing
/// fifty channels meant transferring all of them.
class InfluencerListScreen extends ConsumerStatefulWidget {
  const InfluencerListScreen({super.key});

  @override
  ConsumerState<InfluencerListScreen> createState() =>
      _InfluencerListScreenState();
}

class _InfluencerListScreenState extends ConsumerState<InfluencerListScreen> {
  final _scrollController = ScrollController();
  bool _showScrollToBottom = false;

  /// Guards against a second [_returnToPin] pass stacking on the first while it
  /// is still walking pages in from the database.
  bool _returningToPin = false;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  /// Loads the next page once the viewport is within [_loadMoreThreshold] of
  /// the end. A threshold rather than waiting for the actual bottom, so the
  /// rows are usually already there by the time the user scrolls to them.
  /// [InfluencerPageNotifier.loadMore] ignores the calls this fires while a
  /// request is already in flight, so no debounce is needed here.
  static const _loadMoreThreshold = 600.0;

  /// How far from the bottom before the jump-to-bottom button appears — far
  /// enough that it doesn't flicker in and out right as the list settles.
  static const _scrollToBottomThreshold = 400.0;

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final position = _scrollController.position;
    if (position.pixels >= position.maxScrollExtent - _loadMoreThreshold) {
      ref
          .read(influencerPageProvider(ref.read(influencerFilterProvider))
              .notifier)
          .loadMore();
    }

    final showButton = position.maxScrollExtent > 0 &&
        position.pixels < position.maxScrollExtent - _scrollToBottomThreshold;
    if (showButton != _showScrollToBottom) {
      setState(() => _showScrollToBottom = showButton);
    }
  }

  void _scrollToBottom() {
    if (!_scrollController.hasClients) return;
    _scrollController.animateTo(
      _scrollController.position.maxScrollExtent,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOut,
    );
  }

  void _pinPosition() {
    if (!_scrollController.hasClients) return;
    ref
        .read(influencerPinProvider.notifier)
        .set(_scrollController.position.pixels);
  }

  /// Scrolls back to the pinned offset, pulling more pages in first when the
  /// pin sits deeper than the rows loaded so far reach.
  ///
  /// That gap is the normal case right after a cold start: the pin is restored
  /// from disk but only the first page is in, so `maxScrollExtent` is a
  /// fraction of the saved offset. Each pass scrolls as far as the list
  /// currently allows, loads the next page when that fell short, and waits a
  /// frame for the new rows to lay out before measuring again.
  Future<void> _returnToPin() async {
    if (_returningToPin) return;
    final target = ref.read(influencerPinProvider);
    if (target == null || !_scrollController.hasClients) return;

    _returningToPin = true;
    try {
      for (var pass = 0; pass < 20; pass++) {
        if (!mounted || !_scrollController.hasClients) return;
        final max = _scrollController.position.maxScrollExtent;
        await _scrollController.animateTo(
          target.clamp(0.0, max),
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
        if (target <= max) return;

        final query = ref.read(influencerFilterProvider);
        final page = ref.read(influencerPageProvider(query)).value;
        if (page == null || !page.hasMore || page.loadMoreError != null) return;
        await ref.read(influencerPageProvider(query).notifier).loadMore();
        if (!mounted) return;
        await WidgetsBinding.instance.endOfFrame;
      }
    } finally {
      _returningToPin = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final query = ref.watch(influencerFilterProvider);
    final viewMode = ref.watch(influencerViewModeProvider);
    final showLatest = ref.watch(influencerListLatestVideoProvider);
    final pageAsync = ref.watch(influencerPageProvider(query));
    final pinnedPosition = ref.watch(influencerPinProvider);

    // Search, sort, and filters all live on this one query object, so a
    // pinned position stops meaning anything the moment it changes. Row
    // updates (status paint, quick tags) go through `patchItem` instead and
    // never touch this provider, so the pin survives those. `clear` is a
    // no-op when nothing is pinned.
    ref.listen<InfluencerQuery>(influencerFilterProvider, (previous, next) {
      ref.read(influencerPinProvider.notifier).clear();
    });

    return Scaffold(
      appBar: GradientAppBar(
        title: const RosterSectionSwitcher(),
        actions: [
          IconButton(
            tooltip: l10n.influencerListPinPosition,
            isSelected: pinnedPosition != null,
            icon: const Icon(Icons.push_pin_outlined),
            selectedIcon: const Icon(Icons.push_pin),
            onPressed: _pinPosition,
          ),
          IconButton(
            tooltip: l10n.influencerListReturnToPin,
            icon: const Icon(Icons.replay),
            onPressed: pinnedPosition == null ? null : _returnToPin,
          ),
          const Padding(
              padding: EdgeInsets.only(right: 12), child: PresenceBar()),
        ],
      ),
      floatingActionButton: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_showScrollToBottom)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: FloatingActionButton.small(
                heroTag: 'influencerScrollToBottom',
                tooltip: l10n.influencerListScrollToBottom,
                onPressed: _scrollToBottom,
                child: const Icon(Icons.arrow_downward),
              ),
            ),
          FloatingActionButton.extended(
            heroTag: 'influencerAddChannel',
            onPressed: () => AddInfluencerDialog.show(context),
            icon: const Icon(Icons.add),
            label: Text(l10n.influencerAddTitle),
          ),
        ],
      ),
      body: Column(
        children: [
          _ControlBar(query: query, viewMode: viewMode, l10n: l10n),
          // Directly above the rows it is about, and only while there is
          // something to say. Rows arriving on their own is the one change to
          // this list that nothing else in the app accounts for — see
          // `ChannelArrivalsNotice`.
          const ChannelArrivalsNotice(),
          Expanded(
            child: pageAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, stackTrace) => _ErrorState(
                l10n: l10n,
                onRetry: () => ref.invalidate(influencerPageProvider(query)),
              ),
              data: (state) {
                if (state.items.isEmpty) {
                  return Center(
                    child: Text(
                      // Two genuinely different situations: nothing has ever
                      // been found, versus these filters match nothing. The
                      // first calls for running a search, the second for
                      // loosening a filter, and one message cannot say both.
                      query.isUnfiltered
                          ? l10n.influencerListEmpty
                          : l10n.influencerListNoMatches,
                      textAlign: TextAlign.center,
                    ),
                  );
                }

                // ONE query for the whole page's newest uploads, not one per
                // row. Watched here rather than inside each tile precisely so
                // that turning this on costs one extra request per page rather
                // than fifty. It resolves to an empty map while in flight, so
                // the rows render immediately and the strips appear underneath
                // them a moment later instead of holding up the list.
                //
                // Keyed on the query, not on the ids: the provider follows the
                // page provider itself and asks only about channels it has not
                // already answered for. See `LatestVideosNotifier` for what
                // the id-based key was costing.
                final latest = showLatest
                    ? ref.watch(latestVideosProvider(query)).maybeWhen(
                          data: (videos) => videos,
                          orElse: () => const <String, Video>{},
                        )
                    : const <String, Video>{};

                return RefreshIndicator(
                  onRefresh: () => ref
                      .read(influencerPageProvider(query).notifier)
                      .refresh(),
                  child: viewMode == InfluencerViewMode.cards
                      ? _CardGrid(
                          state: state,
                          controller: _scrollController,
                          latest: latest,
                          showLatest: showLatest,
                          l10n: l10n,
                        )
                      : _RowList(
                          state: state,
                          controller: _scrollController,
                          latest: latest,
                          l10n: l10n,
                        ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// Search, sort, direction, view mode, the two picture switches and the filter
/// button — the controls that change constantly. Everything set rarely is
/// behind [InfluencerFilterSheet].
class _ControlBar extends ConsumerWidget {
  const _ControlBar({
    required this.query,
    required this.viewMode,
    required this.l10n,
  });

  final InfluencerQuery query;
  final InfluencerViewMode viewMode;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifier = ref.read(influencerFilterProvider.notifier);
    final activeFilters = query.activeFilterCount;
    final showImages = ref.watch(influencerListImagesProvider);
    final showLatest = ref.watch(influencerListLatestVideoProvider);

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          SizedBox(
            width: 260,
            child: _SearchField(
              initial: query.search,
              hint: l10n.influencerListSearchHint,
              onChanged: notifier.setSearch,
            ),
          ),
          _SearchScopeButton(scopes: query.searchIn, l10n: l10n),
          // A DropdownButton takes the width of its widest item, and the
          // longest sort label at a 1.6 font scale is wider than a narrow
          // window — the Wrap can move it to its own line but cannot make it
          // narrower, so it ran 151px over. Capped and ellipsised below the
          // mobile breakpoint; left at its natural width above it, where it
          // has always fitted.
          ConstrainedBox(
            constraints: BoxConstraints(
              maxWidth: context.isMobile ? 220 : double.infinity,
            ),
            child: DropdownButton<InfluencerSortBy>(
              isExpanded: context.isMobile,
              value: query.sortBy,
              underline: const SizedBox.shrink(),
              items: [
                DropdownMenuItem(
                  value: InfluencerSortBy.subscribers,
                  child: Text(l10n.influencerListSortSubscribers),
                ),
                DropdownMenuItem(
                  value: InfluencerSortBy.recentActivity,
                  child: Text(l10n.influencerListSortRecentActivity),
                ),
                DropdownMenuItem(
                  value: InfluencerSortBy.medianViews,
                  child: Text(l10n.influencerListSortAverageViews),
                ),
                DropdownMenuItem(
                  value: InfluencerSortBy.videosThisMonth,
                  child: Text(l10n.influencerListSortVideosThisMonth),
                ),
                DropdownMenuItem(
                  value: InfluencerSortBy.daysSinceLastDeal,
                  child: Text(l10n.influencerListSortDaysSinceDeal),
                ),
                DropdownMenuItem(
                  value: InfluencerSortBy.discovered,
                  child: Text(l10n.influencerListSortDiscovered),
                ),
              ],
              onChanged: (value) {
                if (value != null) notifier.setSortBy(value);
              },
            ),
          ),
          IconButton(
            tooltip: l10n.influencerListSortLabel,
            icon: Icon(
              query.descending ? Icons.arrow_downward : Icons.arrow_upward,
            ),
            onPressed: notifier.toggleDirection,
          ),
          Badge(
            isLabelVisible: activeFilters > 0,
            label: Text('$activeFilters'),
            child: OutlinedButton.icon(
              onPressed: () => InfluencerFilterSheet.show(context),
              icon: const Icon(Icons.filter_list),
              label: Text(l10n.influencerListFilters),
            ),
          ),
          SegmentedButton<InfluencerViewMode>(
            showSelectedIcon: false,
            segments: [
              ButtonSegment(
                value: InfluencerViewMode.list,
                icon: const Icon(Icons.view_list),
                tooltip: l10n.influencerListViewAsList,
              ),
              ButtonSegment(
                value: InfluencerViewMode.cards,
                icon: const Icon(Icons.grid_view),
                tooltip: l10n.influencerListViewAsCards,
              ),
            ],
            selected: {viewMode},
            onSelectionChanged: (selection) => ref
                .read(influencerViewModeProvider.notifier)
                .set(selection.first),
          ),
          // Pictures off for this page. A filled icon when they are on, an
          // outlined slashed one when they are off, so the current state is
          // readable without hovering for the tooltip.
          IconButton(
            tooltip: showImages
                ? l10n.influencerListHideImages
                : l10n.influencerListShowImages,
            isSelected: showImages,
            icon: const Icon(Icons.image_not_supported_outlined),
            selectedIcon: const Icon(Icons.image_outlined),
            onPressed: ref.read(influencerListImagesProvider.notifier).toggle,
          ),
          IconButton(
            tooltip: showLatest
                ? l10n.influencerListHideLatestVideo
                : l10n.influencerListShowLatestVideo,
            isSelected: showLatest,
            icon: const Icon(Icons.subscriptions_outlined),
            selectedIcon: const Icon(Icons.subscriptions),
            onPressed:
                ref.read(influencerListLatestVideoProvider.notifier).toggle,
          ),
          const _QuickTagPresetButton(),
          // Said once, quietly, rather than as a badge on every row: the tag
          // editor is genuinely useful and genuinely invisible otherwise.
          Text(
            l10n.influencerListRightClickHint,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
        ],
      ),
    );
  }
}

/// Opens the picker for [influencerQuickTagPresetProvider]: the set of tags a
/// Ctrl + right-click applies to a channel instantly, without opening the
/// context menu. A brush icon, filled once a preset is set, so the row of
/// controls itself shows whether the shortcut is currently armed.
class _QuickTagPresetButton extends ConsumerWidget {
  const _QuickTagPresetButton();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final preset = ref.watch(influencerQuickTagPresetProvider);

    return IconButton(
      tooltip: l10n.influencerQuickTagPresetTooltip,
      isSelected: preset.isNotEmpty,
      icon: const Icon(Icons.brush_outlined),
      selectedIcon: const Icon(Icons.brush),
      onPressed: () => _showDialog(context, ref, preset),
    );
  }

  Future<void> _showDialog(
    BuildContext context,
    WidgetRef ref,
    List<ChannelTag> current,
  ) async {
    final l10n = AppLocalizations.of(context);
    final selected = current.toSet();

    final result = await showDialog<Set<ChannelTag>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setState) => AlertDialog(
          title: Text(l10n.influencerQuickTagPresetDialogTitle),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.influencerQuickTagPresetDialogDescription,
                style: Theme.of(dialogContext).textTheme.bodySmall,
              ),
              const SizedBox(height: 8),
              for (final tag in ChannelTag.values)
                CheckboxListTile(
                  dense: true,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: selected.contains(tag),
                  title: Text(tag.label(l10n)),
                  onChanged: (checked) => setState(() {
                    if (checked ?? false) {
                      selected.add(tag);
                    } else {
                      selected.remove(tag);
                    }
                  }),
                ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: Text(l10n.commonCancel),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(selected),
              child: Text(l10n.commonSave),
            ),
          ],
        ),
      ),
    );

    if (result == null) return;
    ref.read(influencerQuickTagPresetProvider.notifier).set(result.toList());
  }
}

/// Where the search box looks: names, channel descriptions, video
/// descriptions -- any mix, at least one. Marked with a dot while it looks
/// anywhere besides names, so a search that finds "too much" explains itself.
class _SearchScopeButton extends ConsumerWidget {
  const _SearchScopeButton({required this.scopes, required this.l10n});

  final Set<InfluencerSearchScope> scopes;
  final AppLocalizations l10n;

  String _label(InfluencerSearchScope scope) => switch (scope) {
        InfluencerSearchScope.names => l10n.influencerSearchScopeNames,
        InfluencerSearchScope.channelDescriptions =>
          l10n.influencerSearchScopeChannelDescriptions,
        InfluencerSearchScope.videoDescriptions =>
          l10n.influencerSearchScopeVideoDescriptions,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifier = ref.read(influencerFilterProvider.notifier);
    final widened = scopes.any((s) => s != InfluencerSearchScope.names);
    final summary = [
      for (final scope in InfluencerSearchScope.values)
        if (scopes.contains(scope)) _label(scope),
    ].join(', ');

    return MenuAnchor(
      menuChildren: [
        for (final scope in InfluencerSearchScope.values)
          CheckboxMenuButton(
            key: Key('search-scope-${scope.name}'),
            value: scopes.contains(scope),
            // Menu stays open, so several can be ticked in one go.
            closeOnActivate: false,
            onChanged: (on) => notifier.setSearchScope(scope, on: on ?? false),
            child: Text(_label(scope)),
          ),
      ],
      builder: (context, controller, _) => IconButton(
        key: const Key('influencer-search-scope'),
        tooltip: l10n.influencerSearchScopeTooltip(summary),
        onPressed: () =>
            controller.isOpen ? controller.close() : controller.open(),
        icon: Badge(
          isLabelVisible: widened,
          smallSize: 8,
          child: const Icon(Icons.manage_search),
        ),
      ),
    );
  }
}

/// The search box.
///
/// Its own widget with its own controller, so typing does not rebuild from the
/// provider on every keystroke — which is what would move the cursor to the
/// end of the field mid-word.
class _SearchField extends StatefulWidget {
  const _SearchField({
    required this.initial,
    required this.hint,
    required this.onChanged,
  });

  final String? initial;
  final String hint;
  final ValueChanged<String?> onChanged;

  @override
  State<_SearchField> createState() => _SearchFieldState();
}

class _SearchFieldState extends State<_SearchField> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.initial ?? '');

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: widget.hint,
        isDense: true,
        prefixIcon: const Icon(Icons.search),
        border: const OutlineInputBorder(),
        suffixIcon: _controller.text.isEmpty
            ? null
            : IconButton(
                icon: const Icon(Icons.clear),
                onPressed: () {
                  _controller.clear();
                  setState(() {});
                  widget.onChanged(null);
                },
              ),
      ),
      // Submitted, not per-keystroke: every change is a new database query
      // against a `%text%` match, and firing one per letter would queue a
      // request the user has already invalidated by typing the next letter.
      onSubmitted: widget.onChanged,
      onChanged: (_) => setState(() {}),
    );
  }
}

class _RowList extends StatelessWidget {
  const _RowList({
    required this.state,
    required this.controller,
    required this.latest,
    required this.l10n,
  });

  final InfluencerListState state;
  final ScrollController controller;
  final Map<String, Video> latest;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      controller: controller,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 88),
      // One past the rows: the last slot is the footer (spinner, error, or
      // end-of-list note) rather than a widget outside the scroll view, so it
      // scrolls with the content instead of pinning to the bottom of the screen.
      itemCount: state.items.length + 1,
      itemBuilder: (context, index) {
        if (index == state.items.length) {
          return _ListFooter(state: state, l10n: l10n);
        }
        final influencer = state.items[index];
        return InfluencerListTile(
          influencer: influencer,
          latestVideo: latest[influencer.id],
        );
      },
    );
  }
}

class _CardGrid extends StatelessWidget {
  const _CardGrid({
    required this.state,
    required this.controller,
    required this.latest,
    required this.showLatest,
    required this.l10n,
  });

  final InfluencerListState state;
  final ScrollController controller;
  final Map<String, Video> latest;

  /// The SWITCH, not whether this page happens to have any videos.
  ///
  /// The tile height has to be decided for the whole grid, and deciding it from
  /// the data would make every tile taller the moment one channel had an upload
  /// and shorter again when the filter changed. Reserving the space whenever
  /// the feature is on keeps the grid stable while the batched query is still
  /// in flight, which is exactly when a resize would be most visible.
  final bool showLatest;

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final textScaler = MediaQuery.textScalerOf(context);
    return CustomScrollView(
      controller: controller,
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          sliver: SliverGrid(
            // maxCrossAxisExtent rather than a fixed column count: the same
            // grid then works on a phone (one column), a split window (two)
            // and a wide monitor (five) without a breakpoint table.
            gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
              maxCrossAxisExtent: 520,
              // Scaled by the reader's text size, not a fixed number. This app
              // has a font-scale slider in Settings, so a hardcoded tile
              // height is not merely tight — it is guaranteed to clip for
              // anyone who turns the scale up. Only the text-bearing part of
              // the card grows; the banner does not. The upload strip's height
              // comes from the same function the card uses to size it, so the
              // two cannot drift apart.
              mainAxisExtent: InfluencerCard.bannerHeight +
                  textScaler.scale(160) +
                  (showLatest ? latestVideoStripHeight(context) + 8 : 0),
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
            ),
            delegate: SliverChildBuilderDelegate(
              (context, index) {
                final influencer = state.items[index];
                return InfluencerCard(
                  influencer: influencer,
                  showLatestVideo: showLatest,
                  latestVideo: showLatest ? latest[influencer.id] : null,
                );
              },
              childCount: state.items.length,
            ),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.only(bottom: 18),
          sliver: SliverToBoxAdapter(
            child: _ListFooter(state: state, l10n: l10n),
          ),
        ),
      ],
    );
  }
}

/// What sits below the last row: a spinner while more is loading, a retry when
/// appending failed, or a quiet confirmation that this is the whole list.
class _ListFooter extends ConsumerWidget {
  const _ListFooter({required this.state, required this.l10n});

  final InfluencerListState state;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (state.loadMoreError != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Center(
          child: Column(
            children: [
              Text(l10n.commonError),
              TextButton(
                onPressed: () => ref
                    .read(influencerPageProvider(
                            ref.read(influencerFilterProvider))
                        .notifier)
                    .loadMore(),
                child: Text(l10n.commonRetry),
              ),
            ],
          ),
        ),
      );
    }
    if (state.isLoadingMore) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 20),
        child: Center(
          child: Column(
            children: [
              const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(height: 8),
              Text(
                l10n.influencerListLoadingMore,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 20),
      child: Center(
        child: Text(
          state.hasMore
              ? l10n.influencerListShowingCount(state.items.length)
              : l10n.influencerListEndOfList,
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.l10n, required this.onRetry});

  final AppLocalizations l10n;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(l10n.commonError),
          TextButton(onPressed: onRetry, child: Text(l10n.commonRetry)),
        ],
      ),
    );
  }
}
