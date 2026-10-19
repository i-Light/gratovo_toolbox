import 'package:gratovo_toolbox/data/models/comms_proposal.dart';
import 'package:gratovo_toolbox/data/repositories/comms_proposal_repository.dart';

/// In-memory [CommsProposalRepository]; starts empty.
class MockCommsProposalRepository implements CommsProposalRepository {
  final List<CommsProposal> _items = [];
  int _next = 0;

  @override
  Future<List<CommsProposal>> getOpen() async => [
        for (final item in _items)
          if (item.status.isOpen) item,
      ]..sort((a, b) => b.createdAt.compareTo(a.createdAt));

  @override
  Future<CommsProposal?> getById(String id) async {
    for (final item in _items) {
      if (item.id == id) return item;
    }
    return null;
  }

  @override
  Future<int> countCreatedSince(DateTime since) async =>
      _items.where((item) => !item.createdAt.isBefore(since)).length;

  @override
  Future<CommsProposal> save(CommsProposal proposal) async {
    final saved = proposal.id.isEmpty
        ? proposal.copyWith(id: 'proposal_${_next++}')
        : proposal;
    _items
      ..removeWhere((item) => item.id == saved.id)
      ..add(saved);
    return saved;
  }

  @override
  Future<void> decide(
    String id,
    CommsQueueStatus status, {
    String? decidedBy,
    String? subject,
    String? body,
    String? error,
  }) async {
    final index = _items.indexWhere((item) => item.id == id);
    if (index == -1) return;
    final item = _items[index];
    _items[index] = CommsProposal(
      id: item.id,
      kind: item.kind,
      status: status,
      threadId: item.threadId,
      channelId: item.channelId,
      brandId: item.brandId,
      engineStatus: item.engineStatus,
      situation: item.situation,
      steer: item.steer,
      action: item.action,
      why: item.why,
      rules: item.rules,
      needsHuman: item.needsHuman,
      subject: subject ?? item.subject,
      body: body ?? item.body,
      followUpDays: item.followUpDays,
      variant: item.variant,
      model: item.model,
      error: error ?? item.error,
      decidedBy: decidedBy,
      decidedAt: DateTime.now().toUtc(),
      createdAt: item.createdAt,
      updatedAt: DateTime.now().toUtc(),
    );
  }
}
