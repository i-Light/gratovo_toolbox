import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/repositories/reminder_repository.dart';

/// In-memory [ReminderRepository], seeded so the Dashboard's "upcoming
/// outreach" stat and reminder list have realistic content to show.
class MockReminderRepository implements ReminderRepository {
  final List<FollowUpReminder> _reminders = [
    FollowUpReminder(
      id: 'rem_001',
      title: 'Follow up with @TechWithTaha — confirm final script',
      dueAt: DateTime.now().add(const Duration(days: 2)),
      kind: ReminderKind.followUp,
      influencerId: 'inf_001',
      dealId: 'deal_001',
    ),
    FollowUpReminder(
      id: 'rem_002',
      title: 'NordVPN x @MoneyMovesWithKarim — send counter-offer',
      dueAt: DateTime.now().add(const Duration(days: 1)),
      kind: ReminderKind.followUp,
      influencerId: 'inf_007',
      dealId: 'deal_003',
    ),
    FollowUpReminder(
      id: 'rem_003',
      title: 'Deliverable deadline — @WanderlustWithSara video due',
      dueAt: DateTime.now().add(const Duration(days: 5)),
      kind: ReminderKind.dealDeadline,
      influencerId: 'inf_006',
      dealId: 'deal_005',
    ),
    FollowUpReminder(
      id: 'rem_004',
      title: 'Review Notion contract draft before sending',
      dueAt: DateTime.now().add(const Duration(days: 3)),
      kind: ReminderKind.custom,
      dealId: 'deal_004',
    ),
  ];

  int _counter = 5;

  @override
  Future<List<FollowUpReminder>> getUpcoming() async {
    final upcoming = _reminders.where((r) => !r.isDone).toList()
      ..sort((a, b) => a.dueAt.compareTo(b.dueAt));
    return upcoming;
  }

  @override
  Future<int> countCreatedSince(DateTime since) async {
    return _reminders.where((r) => r.createdAt?.isAfter(since) ?? false).length;
  }

  @override
  Future<List<FollowUpReminder>> getForInfluencer(String influencerId) async {
    final list = _reminders
        .where((r) => !r.isDone && r.influencerId == influencerId)
        .toList()
      ..sort((a, b) => a.dueAt.compareTo(b.dueAt));
    return list;
  }

  @override
  Future<FollowUpReminder> create(FollowUpReminder reminder) async {
    final created = FollowUpReminder(
      id: 'rem_${(_counter++).toString().padLeft(3, '0')}',
      title: reminder.title,
      dueAt: reminder.dueAt,
      kind: reminder.kind,
      influencerId: reminder.influencerId,
      dealId: reminder.dealId,
      isDone: reminder.isDone,
      createdAt: reminder.createdAt ?? DateTime.now(),
    );
    _reminders.add(created);
    return created;
  }

  @override
  Future<void> update(FollowUpReminder reminder) async {
    final index = _reminders.indexWhere((r) => r.id == reminder.id);
    if (index == -1) return;
    _reminders[index] = reminder;
  }

  @override
  Future<void> complete(String id) async {
    final index = _reminders.indexWhere((r) => r.id == id);
    if (index == -1) return;
    _reminders[index] = _reminders[index].copyWith(isDone: true);
  }

  @override
  Future<void> completeForInfluencer(String influencerId) async {
    for (var i = 0; i < _reminders.length; i++) {
      if (_reminders[i].influencerId == influencerId && !_reminders[i].isDone) {
        _reminders[i] = _reminders[i].copyWith(isDone: true);
      }
    }
  }
}
