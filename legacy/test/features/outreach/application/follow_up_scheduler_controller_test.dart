import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/notifications/notification_service.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/follow_up_scheduler_controller.dart';

/// Records every call so the scheduler's side effects can be asserted.
class _RecordingNotificationService implements NotificationService {
  final List<({int id, DateTime whenUtc, String? payload})> scheduled = [];
  final List<int> cancelled = [];
  bool cancelledAll = false;
  bool grantPermission = true;

  final shown = <({int id, String title, String body, String? payload})>[];

  @override
  Future<void> init() async {}

  @override
  Future<bool> requestPermission() async => grantPermission;

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
  Future<void> cancel(int id) async => cancelled.add(id);

  @override
  Future<void> cancelAll() async => cancelledAll = true;
}

ProviderContainer _container({
  MockReminderRepository? reminders,
  NotificationService? notifications,
}) {
  final container = ProviderContainer(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      if (reminders != null)
        reminderRepositoryProvider.overrideWithValue(reminders),
      if (notifications != null)
        notificationServiceProvider.overrideWithValue(notifications),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('resolve', () {
    final now = DateTime(2026, 3, 8, 14, 30); // a Sunday afternoon

    test('tomorrow lands at 09:00 the next day', () {
      final scheduler = _container().read(followUpSchedulerProvider);
      final due = scheduler.resolve(FollowUpPreset.tomorrow, now: now);
      expect(due, DateTime(2026, 3, 9, 9));
    });

    test('in three days / in a week', () {
      final scheduler = _container().read(followUpSchedulerProvider);
      expect(
        scheduler.resolve(FollowUpPreset.inThreeDays, now: now),
        DateTime(2026, 3, 11, 9),
      );
      expect(
        scheduler.resolve(FollowUpPreset.inAWeek, now: now),
        DateTime(2026, 3, 15, 9),
      );
    });

    test('custom passes the picked value straight through', () {
      final scheduler = _container().read(followUpSchedulerProvider);
      final picked = DateTime(2026, 4, 1, 16, 20);
      expect(
        scheduler.resolve(FollowUpPreset.custom, custom: picked, now: now),
        picked,
      );
    });
  });

  group('schedule', () {
    test('creates the reminder and arms a future notification', () async {
      final reminders = MockReminderRepository();
      final notifications = _RecordingNotificationService();
      final scheduler = _container(
        reminders: reminders,
        notifications: notifications,
      ).read(followUpSchedulerProvider);

      final dueUtc = DateTime.now().toUtc().add(const Duration(days: 2));
      final armed = await scheduler.schedule(
        influencerId: 'ch_9',
        title: 'Nudge them',
        dueUtc: dueUtc,
      );

      expect(armed, isTrue);
      final open = await reminders.getForInfluencer('ch_9');
      expect(open, hasLength(1));
      expect(open.single.title, 'Nudge them');
      expect(notifications.scheduled, hasLength(1));
      expect(notifications.scheduled.single.whenUtc, dueUtc);
      expect(notifications.scheduled.single.payload, 'thread:ch_9');
    });

    test('a past due time still saves the reminder but arms nothing', () async {
      final reminders = MockReminderRepository();
      final notifications = _RecordingNotificationService();
      final scheduler = _container(
        reminders: reminders,
        notifications: notifications,
      ).read(followUpSchedulerProvider);

      final armed = await scheduler.schedule(
        influencerId: 'ch_9',
        title: 'Late',
        dueUtc: DateTime.now().toUtc().subtract(const Duration(days: 1)),
      );

      expect(armed, isFalse);
      expect(await reminders.getForInfluencer('ch_9'), hasLength(1));
      expect(notifications.scheduled, isEmpty);
    });

    test('reports not-armed when permission is denied', () async {
      final reminders = MockReminderRepository();
      final notifications = _RecordingNotificationService()
        ..grantPermission = false;
      final scheduler = _container(
        reminders: reminders,
        notifications: notifications,
      ).read(followUpSchedulerProvider);

      final armed = await scheduler.schedule(
        influencerId: 'ch_9',
        title: 'x',
        dueUtc: DateTime.now().toUtc().add(const Duration(days: 1)),
      );

      expect(armed, isFalse);
      expect(await reminders.getForInfluencer('ch_9'), hasLength(1));
      expect(notifications.scheduled, isEmpty);
    });
  });

  test('markDone completes the reminder and cancels its notification',
      () async {
    final reminders = MockReminderRepository();
    final notifications = _RecordingNotificationService();
    final scheduler = _container(
      reminders: reminders,
      notifications: notifications,
    ).read(followUpSchedulerProvider);

    final created = await reminders.create(
      FollowUpReminder(
        id: '',
        title: 'chase',
        dueAt: DateTime.now().add(const Duration(days: 1)),
        kind: ReminderKind.followUp,
        influencerId: 'ch_9',
      ),
    );

    await scheduler.markDone(created);

    expect(await reminders.getForInfluencer('ch_9'), isEmpty);
    expect(notifications.cancelled, isNotEmpty);
  });

  test('clearAllForInfluencer completes every open reminder', () async {
    final reminders = MockReminderRepository();
    final notifications = _RecordingNotificationService();
    final scheduler = _container(
      reminders: reminders,
      notifications: notifications,
    ).read(followUpSchedulerProvider);

    // MockReminderRepository seeds two open reminders for inf_007 / inf_006.
    expect(await reminders.getForInfluencer('inf_007'), isNotEmpty);

    await scheduler.clearAllForInfluencer('inf_007');

    expect(await reminders.getForInfluencer('inf_007'), isEmpty);
    expect(notifications.cancelled, isNotEmpty);
  });
}
