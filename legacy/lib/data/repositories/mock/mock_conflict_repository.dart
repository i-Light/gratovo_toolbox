import 'package:gratovo_toolbox/data/models/edit_conflict.dart';
import 'package:gratovo_toolbox/data/repositories/conflict_repository.dart';

/// In-memory conflicts, used when there is no client or nobody is signed in.
///
/// Seeded with one open conflict, unlike most of the other mocks' fuller
/// fixtures. One is enough to make the page and the profile banner explorable,
/// and an app that opens showing a pile of unresolved disagreements it invented
/// would read as a real problem rather than as demo data.
///
/// The seeded case is deliberately the hard one: two people who each added a
/// paragraph to the same note. Neither value is right, which is what makes
/// "merge" the useful answer and worth having on screen.
class MockConflictRepository implements ConflictRepository {
  MockConflictRepository();

  final List<EditConflict> _conflicts = [
    EditConflict(
      id: 'conflict_001',
      channelId: 'inf_001',
      channelLabel: 'Tech With Taha',
      field: 'notes',
      baseValue: 'Replies fast, prefers WhatsApp over email for quick '
          'check-ins.',
      mineValue: 'Replies fast, prefers WhatsApp over email for quick '
          'check-ins. Asked for a two-week lead time on scripts.',
      theirsValue: 'Replies fast, prefers WhatsApp over email for quick '
          'check-ins. Quoted 2x his usual rate for Q4.',
      mineActorName: 'Omar',
      theirsActorName: 'Sara',
      detectedAt: DateTime.now().subtract(const Duration(hours: 3)),
    ),
  ];

  @override
  Future<List<EditConflict>> getOpen() async => [
        for (final c in _conflicts)
          if (c.isOpen) c,
      ]..sort((a, b) => b.detectedAt.compareTo(a.detectedAt));

  @override
  Future<List<EditConflict>> getOpenForChannel(String channelId) async => [
        for (final c in _conflicts)
          if (c.isOpen && c.channelId == channelId) c,
      ];

  @override
  Future<List<EditConflict>> getResolved({int limit = 50}) async {
    final resolved = [
      for (final c in _conflicts)
        if (!c.isOpen) c,
    ]..sort((a, b) => b.resolvedAt!.compareTo(a.resolvedAt!));
    return resolved.take(limit).toList();
  }

  @override
  Future<void> resolve(
    String conflictId,
    ConflictResolution resolution,
    Object? value,
  ) async {
    final index = _conflicts.indexWhere((c) => c.id == conflictId);
    if (index < 0) return;
    final current = _conflicts[index];
    // Already settled is not an error. Two people opening the same conflict and
    // both pressing a button is ordinary, and the second one should not see a
    // failure — matching what `resolve_edit_conflict` returns.
    if (!current.isOpen) return;
    _conflicts[index] = EditConflict(
      id: current.id,
      channelId: current.channelId,
      channelLabel: current.channelLabel,
      field: current.field,
      baseValue: current.baseValue,
      mineValue: current.mineValue,
      theirsValue: current.theirsValue,
      mineActorName: current.mineActorName,
      theirsActorName: current.theirsActorName,
      detectedAt: current.detectedAt,
      resolvedAt: DateTime.now().toUtc(),
      resolvedByName: 'You',
      resolution: resolution,
    );
  }
}
