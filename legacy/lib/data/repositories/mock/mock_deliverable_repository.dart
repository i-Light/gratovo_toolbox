import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/data/repositories/deliverable_repository.dart';

/// In-memory [DeliverableRepository], seeded against `MockDealRepository`'s
/// deals.
class MockDeliverableRepository implements DeliverableRepository {
  final List<Deliverable> _deliverables = [
    Deliverable(
      id: 'deliverable_001',
      dealId: 'deal_001',
      type: DeliverableType.integration,
      status: DeliverableStatus.approved,
      sortOrder: 0,
      createdAt: DateTime.now().subtract(const Duration(days: 10)),
      updatedAt: DateTime.now().subtract(const Duration(days: 2)),
    ),
    Deliverable(
      id: 'deliverable_002',
      dealId: 'deal_001',
      type: DeliverableType.communityPost,
      status: DeliverableStatus.pending,
      sortOrder: 1,
      createdAt: DateTime.now().subtract(const Duration(days: 10)),
      updatedAt: DateTime.now().subtract(const Duration(days: 10)),
    ),
  ];

  @override
  Future<List<Deliverable>> getForDeal(String dealId) async {
    final matches = _deliverables.where((d) => d.dealId == dealId).toList()
      ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
    return matches;
  }

  @override
  Future<Deliverable> create(Deliverable deliverable) async {
    final withId = deliverable.id.isEmpty
        ? Deliverable(
            id: 'deliverable_${_deliverables.length + 1}',
            dealId: deliverable.dealId,
            type: deliverable.type,
            agreedDate: deliverable.agreedDate,
            draftReceivedDate: deliverable.draftReceivedDate,
            approvedDate: deliverable.approvedDate,
            publishedUrl: deliverable.publishedUrl,
            status: deliverable.status,
            notes: deliverable.notes,
            sortOrder: deliverable.sortOrder,
            publishedAt: deliverable.publishedAt,
            reportViews: deliverable.reportViews,
            reportViewsAt: deliverable.reportViewsAt,
            reportClicks: deliverable.reportClicks,
            createdAt: deliverable.createdAt,
            updatedAt: deliverable.updatedAt,
          )
        : deliverable;
    _deliverables.add(withId);
    return withId;
  }

  @override
  Future<void> update(Deliverable deliverable) async {
    final index = _deliverables.indexWhere((d) => d.id == deliverable.id);
    if (index == -1) return;
    _deliverables[index] = deliverable;
  }

  @override
  Future<void> delete(String id) async {
    _deliverables.removeWhere((d) => d.id == id);
  }
}
