import 'package:gratovo_toolbox/data/models/client_merge_status.dart';

/// The team's merge board: one row per person listing the local databases a
/// shipped reset moved aside on their machine and has not been reconciled yet.
///
/// [fetchAll] returns every row the caller may see (any authorized user sees
/// all of them — the RLS `client_merge_status_read` policy). [saveMine] writes
/// the signed-in person's own row and nothing else; the database refuses a
/// write to anyone else's row, so — as with [ScratchpadRepository] — there is
/// no "set someone's status" method to get wrong.
abstract interface class ClientMergeStatusRepository {
  Future<List<ClientMergeStatus>> fetchAll();

  /// Upsert the current user's row. Creates it on the first call. Passing an
  /// empty [entries] with [pendingCount] 0 is how "this machine is now clear"
  /// is recorded — the row stays, showing a resolved history via `updated_at`.
  Future<void> saveMine({
    required int pendingCount,
    required List<MergeStatusEntry> entries,
  });
}
