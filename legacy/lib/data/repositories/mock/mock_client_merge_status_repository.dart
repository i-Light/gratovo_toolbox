import 'package:gratovo_toolbox/data/models/client_merge_status.dart';
import 'package:gratovo_toolbox/data/repositories/client_merge_status_repository.dart';

/// In-memory [ClientMergeStatusRepository] for the signed-out / backend-
/// unreachable state and for widget tests. Empty by default — the common case
/// is a team with nothing pending — but a test can seed [_rows].
class MockClientMergeStatusRepository implements ClientMergeStatusRepository {
  MockClientMergeStatusRepository({this.myUserId = 'me'});

  /// Which row [saveMine] writes, so a test can line it up with its fake
  /// session.
  final String myUserId;

  final Map<String, ClientMergeStatus> _rows = {};

  @override
  Future<List<ClientMergeStatus>> fetchAll() async {
    final list = _rows.values.toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return list;
  }

  @override
  Future<void> saveMine({
    required int pendingCount,
    required List<MergeStatusEntry> entries,
  }) async {
    _rows[myUserId] = ClientMergeStatus(
      userId: myUserId,
      pendingCount: pendingCount,
      entries: entries,
      updatedAt: DateTime.now().toUtc(),
    );
  }
}
