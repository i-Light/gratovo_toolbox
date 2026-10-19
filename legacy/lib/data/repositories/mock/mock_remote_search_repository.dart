import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/data/models/remote_search_request.dart';
import 'package:gratovo_toolbox/data/repositories/remote_search_repository.dart';

/// In-memory [RemoteSearchRepository] for the backend-unreachable / signed-out
/// state and for widget tests.
class MockRemoteSearchRepository implements RemoteSearchRepository {
  MockRemoteSearchRepository({this.myUserId = 'me'});

  final String myUserId;

  final Map<String, RemoteSearchRequest> _requests = {};

  @override
  Future<List<RemoteSearchRequest>> fetchAll() async {
    final list = _requests.values
        .where((r) => r.fromUserId == myUserId || r.toUserId == myUserId)
        .toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return list;
  }

  @override
  Future<List<RemoteSearchRequest>> incomingPending() async {
    return _requests.values
        .where((r) =>
            r.toUserId == myUserId &&
            r.status == RemoteSearchRequestStatus.pending)
        .toList()
      ..sort((a, b) => a.createdAt.compareTo(b.createdAt));
  }

  @override
  Future<void> send(
      {required String toUserId, required String keywords}) async {
    final id = localUuid();
    _requests[id] = RemoteSearchRequest(
      id: id,
      fromUserId: myUserId,
      toUserId: toUserId,
      keywords: keywords,
      status: RemoteSearchRequestStatus.pending,
      createdAt: DateTime.now().toUtc(),
    );
  }

  @override
  Future<void> markApplied(String id) =>
      _setStatus(id, RemoteSearchRequestStatus.applied);

  @override
  Future<void> markDismissed(String id) =>
      _setStatus(id, RemoteSearchRequestStatus.dismissed);

  Future<void> _setStatus(String id, RemoteSearchRequestStatus status) async {
    final existing = _requests[id];
    if (existing == null) return;
    _requests[id] = RemoteSearchRequest(
      id: existing.id,
      fromUserId: existing.fromUserId,
      toUserId: existing.toUserId,
      keywords: existing.keywords,
      status: status,
      createdAt: existing.createdAt,
      appliedAt: status == RemoteSearchRequestStatus.applied
          ? DateTime.now().toUtc()
          : existing.appliedAt,
    );
  }
}
