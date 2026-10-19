import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';

/// Which of [Deliverable]'s three optional dates [DealDeliverablesController.
/// setDate] is writing to.
enum DeliverableDateField { agreed, draftReceived, approved }

/// One deal's deliverables, and every edit the Deliverables section on the
/// deal detail screen can make to them.
///
/// Scoped to this one screen rather than routed through the app-wide
/// `DataDomain` bus (`core/events/data_change_bus.dart`): nothing else in the
/// app currently reads a deal's deliverables, so there is nothing else to
/// invalidate, and this refreshes its own state straight from the repository
/// after every write instead.
///
/// Every mutation reconstructs the [Deliverable] explicitly rather than going
/// through [Deliverable.copyWith] — `copyWith`'s "null means keep the current
/// value" convention (the same one `Deal.copyWith` uses) can't express
/// *clearing* a nullable field, and clearing a date or the published URL is
/// something this screen needs to do.
class DealDeliverablesController extends AsyncNotifier<List<Deliverable>> {
  DealDeliverablesController(this.dealId);

  /// Held as a field because Riverpod 3 hands a family's argument to the
  /// constructor rather than to [build].
  final String dealId;

  @override
  Future<List<Deliverable>> build() {
    return ref.watch(deliverableRepositoryProvider).getForDeal(dealId);
  }

  /// Creates a new deliverable of [type], appended after whatever is
  /// currently loaded (or at position 0 if the list hasn't loaded yet).
  Future<void> addDeliverable(DeliverableType type) async {
    final now = DateTime.now();
    final sortOrder = state.value?.length ?? 0;
    await ref.read(deliverableRepositoryProvider).create(
          Deliverable(
            id: '',
            dealId: dealId,
            type: type,
            sortOrder: sortOrder,
            createdAt: now,
            updatedAt: now,
          ),
        );
    await _refresh();
  }

  Future<void> updateType(String id, DeliverableType type) =>
      _patch(id, (d) => _rebuild(d, type: type));

  /// Marking a row published records when (the 30-day report counts from
  /// it); walking it back off published clears the date.
  Future<void> updateStatus(String id, DeliverableStatus status) => _patch(
        id,
        (d) => _rebuild(
          d,
          status: status,
          publishedAt: status != DeliverableStatus.published
              ? () => null
              : () => d.publishedAt ?? DateTime.now(),
        ),
      );

  /// Stores the 30-day report's numbers. The views are a snapshot: once
  /// taken they stay as they were; [clicks] can be added or corrected.
  Future<void> recordReport(
    String id, {
    int? views,
    DateTime? at,
    int? clicks,
  }) {
    return _patch(id, (d) {
      final snapshot = !d.hasReport && views != null && at != null;
      return _rebuild(
        d,
        reportViews: snapshot ? () => views : null,
        reportViewsAt: snapshot ? () => at : null,
        reportClicks: clicks == null ? null : () => clicks,
      );
    });
  }

  Future<void> setDate(
    String id,
    DeliverableDateField field,
    DateTime? value,
  ) =>
      _patch(
        id,
        (d) => _rebuild(
          d,
          agreedDate: field == DeliverableDateField.agreed ? () => value : null,
          draftReceivedDate:
              field == DeliverableDateField.draftReceived ? () => value : null,
          approvedDate:
              field == DeliverableDateField.approved ? () => value : null,
        ),
      );

  /// [url] empty or null clears the link — e.g. a status walked back off
  /// `published` by mistake shouldn't leave a stale link behind.
  Future<void> updatePublishedUrl(String id, String? url) => _patch(
        id,
        (d) => _rebuild(
          d,
          publishedUrl: () => (url == null || url.isEmpty) ? null : url,
        ),
      );

  Future<void> updateNotes(String id, String? notes) => _patch(
        id,
        (d) => _rebuild(
          d,
          notes: () => (notes == null || notes.isEmpty) ? null : notes,
        ),
      );

  Future<void> delete(String id) async {
    await ref.read(deliverableRepositoryProvider).delete(id);
    await _refresh();
  }

  /// Swaps [id]'s `sortOrder` with the row directly above it. A no-op if
  /// [id] is already first or isn't found.
  Future<void> moveUp(String id) => _swap(id, -1);

  /// Swaps [id]'s `sortOrder` with the row directly below it. A no-op if
  /// [id] is already last or isn't found.
  Future<void> moveDown(String id) => _swap(id, 1);

  Future<void> _swap(String id, int delta) async {
    final list = state.value;
    if (list == null) return;
    final index = list.indexWhere((d) => d.id == id);
    final targetIndex = index + delta;
    if (index == -1 || targetIndex < 0 || targetIndex >= list.length) return;

    final repository = ref.read(deliverableRepositoryProvider);
    final current = list[index];
    final target = list[targetIndex];
    await repository.update(_rebuild(current, sortOrder: target.sortOrder));
    await repository.update(_rebuild(target, sortOrder: current.sortOrder));
    await _refresh();
  }

  Future<void> _patch(
    String id,
    Deliverable Function(Deliverable current) build,
  ) async {
    final list = state.value;
    if (list == null) return;
    final index = list.indexWhere((d) => d.id == id);
    if (index == -1) return;
    await ref.read(deliverableRepositoryProvider).update(build(list[index]));
    await _refresh();
  }

  Future<void> _refresh() async {
    state = await AsyncValue.guard(
      () => ref.read(deliverableRepositoryProvider).getForDeal(dealId),
    );
  }

  /// Rebuilds [current] field-by-field. A plain value (`type`, `status`,
  /// `sortOrder`) keeps the current one when omitted, same as `copyWith`. A
  /// nullable field instead takes a zero-arg getter (`() => value`) so
  /// "omitted" (keep current) and "passed as null" (clear it) are two
  /// different callers, which `copyWith`'s `value ?? current` can't tell
  /// apart.
  static Deliverable _rebuild(
    Deliverable current, {
    DeliverableType? type,
    DeliverableStatus? status,
    int? sortOrder,
    DateTime? Function()? agreedDate,
    DateTime? Function()? draftReceivedDate,
    DateTime? Function()? approvedDate,
    String? Function()? publishedUrl,
    String? Function()? notes,
    DateTime? Function()? publishedAt,
    int? Function()? reportViews,
    DateTime? Function()? reportViewsAt,
    int? Function()? reportClicks,
  }) {
    return Deliverable(
      id: current.id,
      dealId: current.dealId,
      type: type ?? current.type,
      status: status ?? current.status,
      sortOrder: sortOrder ?? current.sortOrder,
      agreedDate: agreedDate != null ? agreedDate() : current.agreedDate,
      draftReceivedDate: draftReceivedDate != null
          ? draftReceivedDate()
          : current.draftReceivedDate,
      approvedDate:
          approvedDate != null ? approvedDate() : current.approvedDate,
      publishedUrl:
          publishedUrl != null ? publishedUrl() : current.publishedUrl,
      notes: notes != null ? notes() : current.notes,
      publishedAt: publishedAt != null ? publishedAt() : current.publishedAt,
      reportViews: reportViews != null ? reportViews() : current.reportViews,
      reportViewsAt:
          reportViewsAt != null ? reportViewsAt() : current.reportViewsAt,
      reportClicks:
          reportClicks != null ? reportClicks() : current.reportClicks,
      createdAt: current.createdAt,
      updatedAt: DateTime.now(),
    );
  }
}

final dealDeliverablesProvider = AsyncNotifierProvider.family<
    DealDeliverablesController, List<Deliverable>, String>(
  DealDeliverablesController.new,
);
