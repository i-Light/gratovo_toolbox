import 'package:gratovo_toolbox/data/models/deliverable.dart';

/// How the UI reads and edits a deal's deliverables. See
/// `influencer_repository.dart`'s doc comment for the mock/Supabase swap
/// pattern this follows.
abstract class DeliverableRepository {
  /// A deal's deliverables, in [Deliverable.sortOrder] order.
  Future<List<Deliverable>> getForDeal(String dealId);

  /// Creates a deliverable and returns the stored record with its id. The
  /// repository owns id generation; pass [Deliverable.id] as `''`.
  Future<Deliverable> create(Deliverable deliverable);

  Future<void> update(Deliverable deliverable);

  Future<void> delete(String id);
}
