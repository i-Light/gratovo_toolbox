import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/notifications/notification_service.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/follow_up_scheduler_controller.dart';

/// Keeps the OS notification schedule in step with the reminder list.
///
/// A scheduled toast lives in the operating system, not in the app, so it
/// drifts out of sync with the truth in two ordinary cases: a reminder was
/// created (or completed) on another machine, or this machine was closed
/// when a reminder came or went. Every time [upcomingRemindersProvider]
/// resolves — at launch and after any reminder edit — this clears the whole
/// OS schedule and re-arms it from the current open, future-dated reminders.
///
/// Watched by `AppShell`, the same way `presenceControllerProvider` is, so it
/// is alive for exactly as long as a signed-in session is on screen. It holds
/// no state; the reminder providers and [NotificationService] do.
class NotificationReconciler {
  NotificationReconciler(this._ref) {
    _ref.listen<AsyncValue<List<FollowUpReminder>>>(
      upcomingRemindersProvider,
      (_, next) => next.whenData(_reconcile),
      fireImmediately: true,
    );
  }

  final Ref _ref;

  Future<void> _reconcile(List<FollowUpReminder> reminders) async {
    final service = _ref.read(notificationServiceProvider);
    await service.cancelAll();

    final now = DateTime.now().toUtc();
    for (final reminder in reminders) {
      final dueUtc = reminder.dueAt.toUtc();
      if (!dueUtc.isAfter(now)) continue;
      await service.schedule(
        id: FollowUpScheduler.notifId(reminder.id),
        title: reminder.title,
        body: reminder.title,
        whenUtc: dueUtc,
        payload: reminder.influencerId == null
            ? null
            : 'thread:${reminder.influencerId}',
      );
    }
  }
}

/// Instantiated (and kept alive) by `AppShell`. Reading it is enough — the
/// constructor wires the listener.
final notificationReconcilerProvider = Provider<NotificationReconciler>((ref) {
  return NotificationReconciler(ref);
});
