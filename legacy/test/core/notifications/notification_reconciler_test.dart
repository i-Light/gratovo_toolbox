import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/notifications/notification_reconciler.dart';
import 'package:gratovo_toolbox/core/notifications/notification_service.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/follow_up_scheduler_controller.dart';

class _RecordingNotificationService implements NotificationService {
  final List<({int id, DateTime whenUtc, String? payload})> scheduled = [];
  int cancelAllCount = 0;

  final shown = <({int id, String title, String body, String? payload})>[];

  @override
  Future<void> init() async {}

  @override
  Future<bool> requestPermission() async => true;

  @override
  Future<void> show({
    required int id,
    required String title,
    required String body,
    String? payload,
  }) async {
    shown.add((id: id, title: title, body: body, payload: payload));
  }

  @override
  Future<void> schedule({
    required int id,
    required String title,
    required String body,
    required DateTime whenUtc,
    String? payload,
  }) async {
    scheduled.add((id: id, whenUtc: whenUtc, payload: payload));
  }

  @override
  Future<void> cancel(int id) async {}

  @override
  Future<void> cancelAll() async => cancelAllCount++;
}

Future<void> _settle() async {
  for (var i = 0; i < 5; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  test('re-arms every open future reminder, clearing the schedule first',
      () async {
    final reminders = MockReminderRepository();
    final notifications = _RecordingNotificationService();
    final container = ProviderContainer(
      overrides: [
        reminderRepositoryProvider.overrideWithValue(reminders),
        notificationServiceProvider.overrideWithValue(notifications),
      ],
    );
    addTearDown(container.dispose);

    container.read(notificationReconcilerProvider);
    await _settle();

    // The mock seeds four open, future-dated reminders.
    expect(notifications.cancelAllCount, greaterThanOrEqualTo(1));
    expect(notifications.scheduled, hasLength(4));
    expect(
      notifications.scheduled.map((s) => s.id),
      containsAll([
        FollowUpScheduler.notifId('rem_001'),
        FollowUpScheduler.notifId('rem_002'),
      ]),
    );
    expect(
      notifications.scheduled.map((s) => s.payload),
      contains('thread:inf_001'),
    );
  });

  test('a past-due reminder is skipped', () async {
    final reminders = MockReminderRepository();
    await reminders.create(
      FollowUpReminder(
        id: '',
        title: 'overdue chase',
        dueAt: DateTime.now().subtract(const Duration(days: 1)),
        kind: ReminderKind.followUp,
        influencerId: 'inf_099',
      ),
    );
    final notifications = _RecordingNotificationService();
    final container = ProviderContainer(
      overrides: [
        reminderRepositoryProvider.overrideWithValue(reminders),
        notificationServiceProvider.overrideWithValue(notifications),
      ],
    );
    addTearDown(container.dispose);

    container.read(notificationReconcilerProvider);
    await _settle();

    expect(
      notifications.scheduled.map((s) => s.payload),
      isNot(contains('thread:inf_099')),
    );
  });
}
