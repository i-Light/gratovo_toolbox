import 'dart:async';
import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/sync/operation_log.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine_types.dart';
import 'package:gratovo_toolbox/data/models/archived_channel.dart';
import 'package:gratovo_toolbox/data/models/bulk_archive_due.dart';
import 'package:gratovo_toolbox/data/models/bulk_rejection.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';

/// What the Archive page is currently filtered to.
class ArchiveFilterNotifier extends Notifier<ArchiveQuery> {
  @override
  ArchiveQuery build() => const ArchiveQuery();

  void setSearch(String text) => state = state.copyWith(search: text);

  /// Null means both labels.
  void setLabel(ChannelTag? label) => state = label == null
      ? state.copyWith(clearLabel: true)
      : state.copyWith(label: label);

  /// Tapping the current sort flips its direction, which is what a column
  /// header is understood to do everywhere else.
  void setSort(ArchiveSortBy sortBy) => state = state.sortBy == sortBy
      ? state.copyWith(descending: !state.descending)
      : state.copyWith(sortBy: sortBy, descending: true);

  void clear() => state = const ArchiveQuery();
}

final archiveFilterProvider =
    NotifierProvider<ArchiveFilterNotifier, ArchiveQuery>(
  ArchiveFilterNotifier.new,
);

/// The loaded pages, plus what the list is doing.
///
/// Shaped like [ActivityLogListState] and for the same reason: loading the
/// first page and appending the next are different states, and collapsing them
/// into one `AsyncValue` makes an infinite list flash empty every time it
/// fetches more.
class ArchiveListState {
  const ArchiveListState({
    this.items = const [],
    this.hasMore = true,
    this.isLoadingMore = false,
    this.loadMoreError,
  });

  final List<ArchivedChannel> items;
  final bool hasMore;
  final bool isLoadingMore;
  final Object? loadMoreError;

  ArchiveListState copyWith({
    List<ArchivedChannel>? items,
    bool? hasMore,
    bool? isLoadingMore,
    Object? Function()? loadMoreError,
  }) {
    return ArchiveListState(
      items: items ?? this.items,
      hasMore: hasMore ?? this.hasMore,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      loadMoreError:
          loadMoreError != null ? loadMoreError() : this.loadMoreError,
    );
  }
}

const archivePageSize = 50;

class ArchivePageNotifier extends AsyncNotifier<ArchiveListState> {
  ArchivePageNotifier(this.query);

  final ArchiveQuery query;

  /// Collapses a burst of changes into one re-read — a bulk clean announces
  /// once, but a mirror download and a realtime push can land together.
  Timer? _pending;

  @override
  Future<ArchiveListState> build() async {
    // A bulk clean here, the nightly sweep's rows arriving in a sync, a channel
    // un-archived elsewhere: the list re-reads without going back to page one.
    // Same shape as the influencer list's, and for the same reason — see
    // `InfluencerPageNotifier.build`.
    ref.listen(dataRevisionProvider(DataDomain.archive), (_, __) {
      _pending?.cancel();
      _pending = Timer(
        const Duration(milliseconds: 250),
        () => unawaited(_refreshLoaded()),
      );
    });
    ref.onDispose(() => _pending?.cancel());

    final items = await ref
        .watch(archiveRepositoryProvider)
        .getPage(offset: 0, limit: archivePageSize, query: query);
    // "The database returned a full page", not "there are more rows" — the
    // same contract InfluencerPage.hasMore and ActivityLogPage.hasMore both
    // carry. It costs one empty request at an exact page boundary and saves a
    // second count query on every page.
    return ArchiveListState(
      items: items,
      hasMore: items.length == archivePageSize,
    );
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || current.isLoadingMore || !current.hasMore) return;

    state = AsyncData(
      current.copyWith(isLoadingMore: true, loadMoreError: () => null),
    );
    try {
      final items = await ref.read(archiveRepositoryProvider).getPage(
            offset: current.items.length,
            limit: archivePageSize,
            query: query,
          );
      // Re-read rather than closing over `current`: a refresh may have replaced
      // the list while this request was in flight.
      final latest = state.value ?? current;
      state = AsyncData(
        latest.copyWith(
          items: [...latest.items, ...items],
          hasMore: items.length == archivePageSize,
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

  /// Re-reads the rows already loaded, in place and with no loading state.
  Future<void> _refreshLoaded() async {
    final current = state.value;
    if (current == null || current.items.isEmpty) return;
    final limit = math.max(current.items.length, archivePageSize);
    try {
      final items = await ref
          .read(archiveRepositoryProvider)
          .getPage(offset: 0, limit: limit, query: query);
      final latest = state.value;
      if (latest == null) return;
      state = AsyncData(
        latest.copyWith(items: items, hasMore: items.length == limit),
      );
    } catch (_) {
      // Leaves the rows on screen alone; they are the last thing the server
      // actually told us.
    }
  }
}

final archivePageProvider = AsyncNotifierProvider.family<ArchivePageNotifier,
    ArchiveListState, ArchiveQuery>(
  ArchivePageNotifier.new,
);

/// How many channels the archive holds in total, ignoring the filter.
///
/// Its own provider rather than a field on the page state: the header shows it
/// even while a filter is narrowing the list, and it is the one number that
/// answers "is this doing anything?".
final archiveCountProvider = FutureProvider<int>((ref) {
  ref.watch(dataRevisionProvider(DataDomain.archive));
  return ref.watch(archiveRepositoryProvider).count();
});

/// Whether the bulk clean is offered at all.
///
/// The database refuses a caller who is not `full` regardless, which is what
/// actually enforces this — but an action that always errors is worse than an
/// action that is not there, and this is the most destructive control in the
/// app. Hiding it is the honest presentation of a permission the server holds.
final canBulkCleanProvider = Provider<bool>((ref) {
  return ref.watch(accessLevelProvider).seesSensitiveData;
});

/// Runs the bulk clean, in the two steps the operation requires.
///
/// [preview] and [apply] are the same call with `dryRun` flipped, which is the
/// whole safety model: the number a person agrees to is a number the database
/// produced, not one the client estimated, and the second call re-evaluates the
/// range rather than acting on a list of ids the first one captured. That does
/// mean the two can differ if a search run lands rows in between — and the
/// result of the second is what is reported, so the difference is visible
/// rather than papered over.
class BulkCleanController extends Notifier<AsyncValue<BulkRejectionOutcome>?> {
  /// Null before anything has been asked. Distinct from an outcome of zero,
  /// which means the range was checked and matches nothing.
  @override
  AsyncValue<BulkRejectionOutcome>? build() => null;

  /// What the run is doing right now, or null when nothing is running.
  ///
  /// Separate from [state] rather than folded into it: the apply is a single
  /// `AsyncLoading` from the dialog's point of view, and what is happening
  /// underneath it changes twenty times without the request being any less in
  /// flight. A modal with every button disabled and nothing on screen to say
  /// why is the failure this exists to prevent -- it is indistinguishable, to
  /// the person looking at it, from an app that has hung.
  BulkCleanProgress? get progress => _progress;
  BulkCleanProgress? _progress;

  /// Notified on every step, so the dialog can repaint without this notifier
  /// rebuilding everything that watches its [state].
  void Function()? onProgress;

  bool _stopRequested = false;

  /// Ends an immediate clean after the batch that is running.
  ///
  /// Safe by construction, and worth offering: everything already tagged stays
  /// tagged and due, so stopping costs nothing but time -- the nightly sweep
  /// finishes what this did not. A destructive loop somebody cannot stop is one
  /// they kill the whole app to escape.
  void stop() {
    if (state is! AsyncLoading) return;
    _stopRequested = true;
    _emit(_progress?.copyWith(stopping: true));
  }

  void _emit(BulkCleanProgress? progress) {
    _progress = progress;
    onProgress?.call();
  }

  Future<void> preview(BulkRejectionRequest request) =>
      _run(request, dryRun: true);

  Future<BulkRejectionOutcome?> apply(BulkRejectionRequest request) async {
    await _run(request, dryRun: false);
    return state?.value;
  }

  /// Wipes the last answer, so a changed range cannot leave a stale count
  /// sitting under a confirm button that would act on a different set.
  void reset() => state = null;

  Future<void> _run(BulkRejectionRequest request,
      {required bool dryRun}) async {
    if (!request.isValid) return;
    state = const AsyncLoading();
    _stopRequested = false;
    // Set before the request goes out, not when the first answer comes back.
    // The tagging is one statement over thousands of rows and can take the
    // best part of a minute on its own, and that minute used to be a frozen
    // dialog with nothing in it.
    _emit(dryRun
        ? const BulkCleanProgress(phase: BulkCleanPhase.checking)
        : const BulkCleanProgress(phase: BulkCleanPhase.tagging));

    // Logged before it runs, not only after. The failure this exists for is the
    // one that never comes back -- a request cancelled by a statement timeout
    // used to leave no trace of having been made at all, so nobody could tell a
    // clean that failed from a clean nobody ran.
    final started = DateTime.now();
    final asked = _describe(request, dryRun: dryRun);
    ref.logOperation(
      dryRun ? 'bulkClean.preview' : 'bulkClean.apply',
      dryRun ? 'Checking a bulk clean range.' : 'Applying a bulk clean.',
      fields: asked,
    );

    state = await AsyncValue.guard(
      () => ref.read(archiveRepositoryProvider).bulkReject(
            request,
            dryRun: dryRun,
            shouldStop: () => _stopRequested,
            onSweepProgress: (swept, total) {
              _emit(BulkCleanProgress(
                phase: BulkCleanPhase.deleting,
                done: swept,
                total: total,
                stopping: _stopRequested,
              ));
              // Every batch, because "it stopped at 400 of 1,782" is the whole
              // diagnosis when a sweep dies halfway.
              ref.logOperation(
                'bulkClean.sweep',
                'Deleting the channels this clean tagged.',
                fields: {...asked, 'swept': swept, 'total': total},
              );
            },
          ),
    );
    _emit(null);

    final elapsed = DateTime.now().difference(started).inMilliseconds;
    final outcome = state?.value;
    if (outcome != null) {
      ref.logOperation(
        dryRun ? 'bulkClean.preview.done' : 'bulkClean.apply.done',
        dryRun ? 'The range was checked.' : 'The bulk clean finished.',
        fields: {
          ...asked,
          'elapsedMs': elapsed,
          'matched': outcome.matched,
          'tagged': outcome.tagged,
          'archived': outcome.archived,
          'skippedTagged': outcome.skippedAlreadyTagged,
          'skippedProtected': outcome.skippedProtected,
          'skippedUnknown': outcome.skippedUnknownSize,
        },
      );
      // Announced here rather than only by the dialog's caller. A clean of a
      // few thousand channels runs for a minute, and the person is entitled to
      // close the dialog and go and look at the list -- which then has to be
      // the list this run left behind, whether or not anybody was still
      // watching when it finished.
      if (!dryRun) {
        ref.bumpData(const {DataDomain.archive, DataDomain.channels});
      }
    } else {
      ref.logOperation(
        dryRun ? 'bulkClean.preview.failed' : 'bulkClean.apply.failed',
        dryRun
            ? 'The range could not be checked.'
            : 'The bulk clean did not finish.',
        level: SyncLogLevel.error,
        fields: {...asked, 'elapsedMs': elapsed},
        error: state?.error,
        stackTrace: state?.stackTrace,
      );
    }
  }

  /// What was asked for, in fields — repeated on every line about this run so
  /// one grep of the log answers "what range was that?".
  static Map<String, Object?> _describe(
    BulkRejectionRequest request, {
    required bool dryRun,
  }) {
    return {
      'dryRun': dryRun,
      'immediate': request.immediate,
      'label': request.label.wire,
      'minSubs': request.minSubscribers,
      'maxSubs': request.maxSubscribers,
      'minMedianViews': request.minMedianViews,
      'maxMedianViews': request.maxMedianViews,
      'minVideos30': request.minVideosLast30,
      'firstSeenAfter': request.firstSeenAfter?.toUtc().toIso8601String(),
    };
  }
}

final bulkCleanProvider =
    NotifierProvider<BulkCleanController, AsyncValue<BulkRejectionOutcome>?>(
  BulkCleanController.new,
);

/// Runs the "scheduled for archive" bulk action -- see [BulkArchiveDueRequest]
/// for what it acts on and why it is not [BulkCleanController] with an extra
/// flag: it reads a different population (already due, not freshly matched)
/// and its apply step picks one of two actions rather than one fixed one.
///
/// Same two-step shape as [BulkCleanController]: [preview] and [apply] are the
/// same call with `dryRun` flipped, and what a person confirms is always the
/// database's own count, re-checked on apply rather than carried over from the
/// preview.
class ArchiveDueCleanController
    extends Notifier<AsyncValue<BulkArchiveDueOutcome>?> {
  /// Null before anything has been asked. Distinct from an outcome of zero.
  @override
  AsyncValue<BulkArchiveDueOutcome>? build() => null;

  /// What the run is doing right now, or null when nothing is running. See
  /// [BulkCleanController.progress] for why this lives outside [state].
  BulkCleanProgress? get progress => _progress;
  BulkCleanProgress? _progress;

  void Function()? onProgress;

  bool _stopRequested = false;

  /// Ends an [ArchiveDueAction.archiveNow] sweep after the batch that is
  /// running. See [BulkCleanController.stop] -- same guarantee, same reason:
  /// everything already moved to due-now stays due, so the nightly sweep
  /// finishes what this did not.
  void stop() {
    if (state is! AsyncLoading) return;
    _stopRequested = true;
    _emit(_progress?.copyWith(stopping: true));
  }

  void _emit(BulkCleanProgress? progress) {
    _progress = progress;
    onProgress?.call();
  }

  Future<void> preview(BulkArchiveDueRequest request) =>
      _run(request, dryRun: true);

  Future<BulkArchiveDueOutcome?> apply(BulkArchiveDueRequest request) async {
    await _run(request, dryRun: false);
    return state?.value;
  }

  /// Wipes the last answer, so a changed range or a switched action cannot
  /// leave a stale count sitting under a button that would act on something
  /// else.
  void reset() => state = null;

  Future<void> _run(
    BulkArchiveDueRequest request, {
    required bool dryRun,
  }) async {
    state = const AsyncLoading();
    _stopRequested = false;
    _emit(dryRun
        ? const BulkCleanProgress(phase: BulkCleanPhase.checking)
        : const BulkCleanProgress(phase: BulkCleanPhase.tagging));

    final started = DateTime.now();
    final asked = _describe(request, dryRun: dryRun);
    ref.logOperation(
      dryRun ? 'archiveDueClean.preview' : 'archiveDueClean.apply',
      dryRun
          ? 'Checking the channels currently due.'
          : 'Acting on the channels currently due.',
      fields: asked,
    );

    state = await AsyncValue.guard(
      () => ref.read(archiveRepositoryProvider).bulkManageArchiveDue(
            request,
            dryRun: dryRun,
            shouldStop: () => _stopRequested,
            onSweepProgress: (swept, total) {
              _emit(BulkCleanProgress(
                phase: BulkCleanPhase.deleting,
                done: swept,
                total: total,
                stopping: _stopRequested,
              ));
              ref.logOperation(
                'archiveDueClean.sweep',
                'Deleting the channels this run moved to due-now.',
                fields: {...asked, 'swept': swept, 'total': total},
              );
            },
          ),
    );
    _emit(null);

    final elapsed = DateTime.now().difference(started).inMilliseconds;
    final outcome = state?.value;
    if (outcome != null) {
      ref.logOperation(
        dryRun ? 'archiveDueClean.preview.done' : 'archiveDueClean.apply.done',
        dryRun
            ? 'The due channels were checked.'
            : 'The due-channels action finished.',
        fields: {
          ...asked,
          'elapsedMs': elapsed,
          'matched': outcome.matched,
          'updated': outcome.updated,
          'archived': outcome.archived,
          'skippedProtected': outcome.skippedProtected,
          'skippedUnknown': outcome.skippedUnknown,
        },
      );
      if (!dryRun) {
        ref.bumpData(const {DataDomain.archive, DataDomain.channels});
      }
    } else {
      ref.logOperation(
        dryRun
            ? 'archiveDueClean.preview.failed'
            : 'archiveDueClean.apply.failed',
        dryRun
            ? 'The due channels could not be checked.'
            : 'The due-channels action did not finish.',
        level: SyncLogLevel.error,
        fields: {...asked, 'elapsedMs': elapsed},
        error: state?.error,
        stackTrace: state?.stackTrace,
      );
    }
  }

  static Map<String, Object?> _describe(
    BulkArchiveDueRequest request, {
    required bool dryRun,
  }) {
    return {
      'dryRun': dryRun,
      'action': request.action.wire,
      'minSubs': request.minSubscribers,
      'maxSubs': request.maxSubscribers,
      'minMedianViews': request.minMedianViews,
      'maxMedianViews': request.maxMedianViews,
      'minVideos30': request.minVideosLast30,
      'label': request.label?.wire,
    };
  }
}

final archiveDueCleanProvider = NotifierProvider<ArchiveDueCleanController,
    AsyncValue<BulkArchiveDueOutcome>?>(
  ArchiveDueCleanController.new,
);

/// Which half of a bulk clean is running.
///
/// The two are genuinely different waits: [tagging] is one statement whose
/// length nobody can predict from the outside, and [deleting] is a known number
/// of batches that can be counted off. Telling them apart is the difference
/// between "it is working" and "it is stuck".
enum BulkCleanPhase { checking, tagging, deleting }

/// What a bulk clean is doing, for the dialog to show.
class BulkCleanProgress {
  const BulkCleanProgress({
    required this.phase,
    this.done = 0,
    this.total = 0,
    this.stopping = false,
  });

  final BulkCleanPhase phase;

  /// Channels deleted so far, and how many there are. Both zero until the
  /// deletions start.
  final int done;
  final int total;

  /// A stop was asked for and the batch in flight is being waited out.
  final bool stopping;

  BulkCleanProgress copyWith({bool? stopping}) => BulkCleanProgress(
        phase: phase,
        done: done,
        total: total,
        stopping: stopping ?? this.stopping,
      );
}
