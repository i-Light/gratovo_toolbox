import 'dart:async';
import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/data/repositories/influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/application/channel_arrivals_controller.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_filter_controller.dart';

/// Everything the list needs to render itself, including what it is doing.
///
/// Loading the first page and loading the *next* page are deliberately two
/// different states. They look the same to a naive `AsyncValue`, which is what
/// makes an infinite list flash empty every time it fetches more: the provider
/// goes back to `loading`, the screen shows a spinner where the list was, and
/// the rows the user was reading disappear. Here [isLoadingMore] is separate
/// from the top-level async state, so the rows stay on screen and the spinner
/// goes at the bottom where it belongs.
class InfluencerListState {
  const InfluencerListState({
    this.items = const [],
    this.hasMore = true,
    this.isLoadingMore = false,
    this.loadMoreError,
  });

  final List<Influencer> items;
  final bool hasMore;
  final bool isLoadingMore;

  /// A failure that hit *while appending*, which must not throw away the pages
  /// already on screen. A first-page failure is the provider's own error state
  /// instead, because there is nothing to preserve.
  final Object? loadMoreError;

  InfluencerListState copyWith({
    List<Influencer>? items,
    bool? hasMore,
    bool? isLoadingMore,
    Object? Function()? loadMoreError,
  }) {
    return InfluencerListState(
      items: items ?? this.items,
      hasMore: hasMore ?? this.hasMore,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      loadMoreError:
          loadMoreError != null ? loadMoreError() : this.loadMoreError,
    );
  }
}

/// How many rows one request asks for.
///
/// Large enough that a full-height desktop window is filled by the first page
/// (otherwise the list cannot be scrolled, so the "near the bottom" trigger
/// never fires and the second page never loads), small enough that the first
/// paint is not waiting on hundreds of rows.
const influencerPageSize = 50;

/// How long a change waits before the loaded rows are re-read.
///
/// Long enough that a run of quick edits is one query, short enough that
/// stepping back from a profile to the list never shows the old value.
const _refreshDelay = Duration(milliseconds: 250);

/// Loads channels a page at a time for the current filter.
///
/// Keyed on the query rather than reading it internally so that changing a
/// filter creates a *different* provider instance with its own empty page
/// list, instead of one instance that has to remember to discard the rows it
/// had gathered under the old filter. Riverpod disposing the old instance is
/// what resets the paging, with nothing to get wrong.
class InfluencerPageNotifier extends AsyncNotifier<InfluencerListState> {
  InfluencerPageNotifier(this.query);

  /// The filter this instance pages through. Riverpod 3 hands a family's
  /// argument to the notifier's constructor rather than to `build`, so it is
  /// held as a field and `loadMore` reads it from here.
  final InfluencerQuery query;

  /// Guards [_refreshLoaded] against overlapping itself.
  bool _refreshing = false;

  /// Collapses a burst of changes into one re-read.
  ///
  /// Tagging five channels in a row from the context menu, or a search run
  /// importing a page of finds, is five or fifty announcements in a second. Each
  /// one is already reflected on screen instantly by [patchItem]; the re-read
  /// behind them only needs to happen once, after the burst.
  Timer? _pending;

  @override
  Future<InfluencerListState> build() async {
    // Anything that changes a channel anywhere in the app — a tag edited on a
    // profile, a search run importing finds, a teammate's edit arriving — gets
    // reflected in the rows already on screen.
    //
    // `listen` rather than `watch`, deliberately: watching would re-run this
    // build, which throws away every page after the first and drops the reader
    // back to the top of the list. [_refreshLoaded] re-reads exactly what is
    // loaded and swaps it in with no loading state at all.
    ref.listen(dataRevisionProvider(DataDomain.channels), (_, __) {
      _pending?.cancel();
      _pending = Timer(_refreshDelay, () => unawaited(_refreshLoaded()));
    });
    ref.onDispose(() => _pending?.cancel());
    // Watched, not read: switching backends (a first sync finishing, a sign
    // out) has to rebuild the list against the new repository.
    return _loadFirstPage(ref.watch(influencerRepositoryProvider));
  }

  Future<InfluencerListState> _loadFirstPage(
    InfluencerRepository repository,
  ) async {
    final page = await repository.getPage(
      offset: 0,
      limit: influencerPageSize,
      query: query,
    );
    return InfluencerListState(items: page.items, hasMore: page.hasMore);
  }

  /// Re-reads however many rows are currently loaded, and swaps them in.
  ///
  /// One request for the whole loaded range rather than one per page, and no
  /// `AsyncLoading` on the way — the list must not blink or lose its scroll
  /// position because somebody two screens away changed a tag.
  ///
  /// Re-querying rather than patching row-by-row is what makes this correct
  /// under a filter: a channel that no longer matches leaves the list, and one
  /// that now does appears, neither of which a local patch could work out.
  /// [patchItem] still exists for the caller's own edit, where the answer is
  /// known immediately and waiting for a round trip would feel slow.
  Future<void> _refreshLoaded() async {
    if (_refreshing) return;
    final current = state.value;
    // Nothing on screen yet: the first page is still in flight and will arrive
    // with current data anyway.
    if (current == null || current.items.isEmpty) return;

    _refreshing = true;
    try {
      final page = await ref.read(influencerRepositoryProvider).getPage(
            offset: 0,
            limit: math.max(current.items.length, influencerPageSize),
            query: query,
          );
      final latest = state.value;
      if (latest == null) return;
      // Rows that were not on screen a moment ago, counted before the swap.
      // This is the only place in the app that can tell a channel *arriving*
      // from a channel *changing* — everything downstream sees one
      // announcement for both — and an arrival is the one that needs
      // explaining: see `ChannelArrivalsNotifier`.
      final before = {for (final item in latest.items) item.id};
      final arrived =
          page.items.where((item) => !before.contains(item.id)).length;
      state = AsyncData(
        latest.copyWith(items: page.items, hasMore: page.hasMore),
      );
      if (arrived > 0) {
        ref.read(channelArrivalsProvider.notifier).report(arrived);
      }
    } catch (_) {
      // A failed background re-read leaves the rows that are on screen alone.
      // They are the last thing the server actually told us, which beats an
      // error page over a list the reader was using.
    } finally {
      _refreshing = false;
    }
  }

  /// Appends the next page. Safe to call from a scroll listener, which fires
  /// far more often than a page boundary is crossed — every call that would
  /// duplicate an in-flight request, or run past the end, returns immediately.
  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || current.isLoadingMore || !current.hasMore) return;

    state = AsyncData(
      current.copyWith(isLoadingMore: true, loadMoreError: () => null),
    );
    try {
      final page = await ref.read(influencerRepositoryProvider).getPage(
            offset: current.items.length,
            limit: influencerPageSize,
            query: query,
          );
      // Re-read rather than closing over `current`: a refresh may have
      // replaced the whole list while this request was in flight, and
      // appending to the stale copy would resurrect the rows it discarded.
      final latest = state.value ?? current;
      state = AsyncData(
        latest.copyWith(
          items: [...latest.items, ...page.items],
          hasMore: page.hasMore,
          isLoadingMore: false,
        ),
      );
    } catch (error) {
      final latest = state.value ?? current;
      state = AsyncData(
        latest.copyWith(isLoadingMore: false, loadMoreError: () => error),
      );
    }
  }

  /// Discards every loaded page and re-reads the first one — after adding a
  /// channel by hand, or on pull-to-refresh.
  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(
      () => _loadFirstPage(ref.read(influencerRepositoryProvider)),
    );
  }

  /// Replaces one row in place, for a change the caller already knows the
  /// result of (a stage or tag edit) — no request, no loading flash, and the
  /// scroll position and every other loaded row are left untouched. A no-op
  /// if the row isn't part of this page (already scrolled past, or filtered
  /// out under a different query instance).
  void patchItem(String id, Influencer Function(Influencer current) update) {
    final current = state.value;
    if (current == null) return;
    state = AsyncData(
      current.copyWith(
        items: [
          for (final item in current.items)
            if (item.id == id) update(item) else item,
        ],
      ),
    );
  }
}

final influencerPageProvider = AsyncNotifierProvider.family<
    InfluencerPageNotifier, InfluencerListState, InfluencerQuery>(
  InfluencerPageNotifier.new,
);

/// The list for whatever filter is currently set — what the screen watches.
final currentInfluencerPageProvider = Provider<AsyncValue<InfluencerListState>>(
  (ref) =>
      ref.watch(influencerPageProvider(ref.watch(influencerFilterProvider))),
);

/// The country filter's options, which grow as a search run finds channels in
/// somewhere new.
final influencerCountriesProvider = FutureProvider<List<String>>((ref) {
  ref.watch(dataRevisionProvider(DataDomain.channels));
  return ref.watch(influencerRepositoryProvider).getCountries();
});
