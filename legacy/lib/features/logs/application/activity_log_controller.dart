import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/models/activity_log_query.dart';
import 'package:gratovo_toolbox/data/repositories/activity_log_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';

/// What the Logs page is currently filtered to.
class ActivityLogFilterNotifier extends Notifier<ActivityLogQuery> {
  @override
  ActivityLogQuery build() => const ActivityLogQuery();

  void setSearch(String? text) {
    final trimmed = text?.trim();
    state = state.copyWith(
      search: () => (trimmed == null || trimmed.isEmpty) ? null : trimmed,
    );
  }

  /// Filters to one person, by id where they still have an account and by
  /// name where they do not.
  ///
  /// Both are cleared together, so switching from a live colleague to a
  /// deleted one cannot leave the previous constraint behind — a bug that
  /// would show an empty list and look like "this person did nothing".
  void setActor(ActivityActor? actor) {
    state = state.copyWith(
      actorId: () => actor?.id,
      actorName: () => actor != null && actor.id == null ? actor.name : null,
    );
  }

  void setAction(ActivityAction? action) =>
      state = state.copyWith(action: () => action);

  void setEntityType(String? type) =>
      state = state.copyWith(entityType: () => type);

  /// The date filter is set as a pair because the two bounds are one question
  /// to the user ("when?") even though they are two columns to the database.
  void setRange({DateTime? from, DateTime? to}) =>
      state = state.copyWith(from: () => from, to: () => to);

  /// The three ranges worth a one-tap shortcut. Each is anchored to local
  /// midnight rather than to "now minus N days", so "last 7 days" means seven
  /// whole days and does not quietly slide forward while the page is open.
  void setLastDays(int days) {
    final now = DateTime.now();
    final startOfToday = DateTime(now.year, now.month, now.day);
    state = state.copyWith(
      from: () => startOfToday.subtract(Duration(days: days - 1)),
      // Half-open upper bound: tomorrow's midnight, so everything recorded
      // today is included without depending on the last millisecond.
      to: () => startOfToday.add(const Duration(days: 1)),
    );
  }

  void clear() => state = const ActivityLogQuery();
}

final activityLogFilterProvider =
    NotifierProvider<ActivityLogFilterNotifier, ActivityLogQuery>(
  ActivityLogFilterNotifier.new,
);

/// The loaded pages, plus what the list is doing.
///
/// Shaped exactly like [InfluencerListState] and for the same reason: loading
/// the first page and appending the next are different states, and collapsing
/// them into one `AsyncValue` is what makes an infinite list flash empty every
/// time it fetches more.
class ActivityLogListState {
  const ActivityLogListState({
    this.items = const [],
    this.hasMore = true,
    this.isLoadingMore = false,
    this.loadMoreError,
  });

  final List<ActivityLogEntry> items;
  final bool hasMore;
  final bool isLoadingMore;
  final Object? loadMoreError;

  ActivityLogListState copyWith({
    List<ActivityLogEntry>? items,
    bool? hasMore,
    bool? isLoadingMore,
    Object? Function()? loadMoreError,
  }) {
    return ActivityLogListState(
      items: items ?? this.items,
      hasMore: hasMore ?? this.hasMore,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      loadMoreError:
          loadMoreError != null ? loadMoreError() : this.loadMoreError,
    );
  }
}

/// Smaller than the influencer list's 50: a log row is taller (it carries a
/// from/to line) and this list is read rather than scanned, so fewer rows fill
/// the same window.
const activityLogPageSize = 40;

/// Pages the log for one filter.
///
/// Keyed on the query, like [InfluencerPageNotifier], so changing a filter
/// creates a different instance with its own empty page list instead of one
/// instance that has to remember to throw away the rows it gathered under the
/// old filter.
class ActivityLogPageNotifier extends AsyncNotifier<ActivityLogListState> {
  ActivityLogPageNotifier(this.query);

  final ActivityLogQuery query;

  @override
  Future<ActivityLogListState> build() async {
    final page = await ref
        .watch(activityLogRepositoryProvider)
        .getPage(offset: 0, limit: activityLogPageSize, query: query);
    return ActivityLogListState(items: page.items, hasMore: page.hasMore);
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || current.isLoadingMore || !current.hasMore) return;

    state = AsyncData(
      current.copyWith(isLoadingMore: true, loadMoreError: () => null),
    );
    try {
      final page = await ref.read(activityLogRepositoryProvider).getPage(
            offset: current.items.length,
            limit: activityLogPageSize,
            query: query,
          );
      // Re-read rather than closing over `current`: a refresh may have
      // replaced the list while this request was in flight.
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

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(build);
  }
}

final activityLogPageProvider = AsyncNotifierProvider.family<
    ActivityLogPageNotifier, ActivityLogListState, ActivityLogQuery>(
  ActivityLogPageNotifier.new,
);
