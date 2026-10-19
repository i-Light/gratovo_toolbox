import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/notifications/local_notification_service.dart';

/// A scheduled desktop notification for one follow-up reminder.
///
/// The real, platform-backed implementation is [LocalNotificationService]
/// (`flutter_local_notifications`); [NoopNotificationService] is the seam
/// tests and no-plugin environments fall back to. Everything here is
/// best-effort by contract — the in-app due/overdue list (Dashboard + the
/// Outreach thread chip) is the source of truth, a toast is a bonus.
abstract class NotificationService {
  /// One-time setup. Safe to call more than once; never throws.
  Future<void> init();

  /// Ask the OS for permission to post notifications, if this platform has a
  /// runtime prompt. Returns whether notifications may be shown. Called
  /// lazily, the first time someone schedules a follow-up.
  Future<bool> requestPermission();

  /// Post a notification NOW.
  ///
  /// Separate from [schedule] because they answer different questions and the
  /// obvious shortcut does not work: `schedule(whenUtc: now)` is dropped, by
  /// contract, since a past time is silently ignored. This is what a reply
  /// landing uses -- the event has already happened, and there is nothing to
  /// wait for.
  ///
  /// [id] still identifies the toast so it can be replaced or cancelled; use a
  /// value derived from whatever the notification is about, the way
  /// [FollowUpScheduler.notifId] does.
  Future<void> show({
    required int id,
    required String title,
    required String body,
    String? payload,
  });

  /// Schedule a notification to fire at [whenUtc] (converted to the device
  /// zone by the implementation). A past [whenUtc] is dropped silently.
  Future<void> schedule({
    required int id,
    required String title,
    required String body,
    required DateTime whenUtc,
    String? payload,
  });

  Future<void> cancel(int id);

  Future<void> cancelAll();
}

/// Does nothing, successfully. The Phase E default — follow-ups are still
/// created and shown in-app; only the OS toast is absent.
class NoopNotificationService implements NotificationService {
  const NoopNotificationService();

  @override
  Future<void> init() async {}

  @override
  Future<bool> requestPermission() async => false;

  @override
  Future<void> show({
    required int id,
    required String title,
    required String body,
    String? payload,
  }) async {}

  @override
  Future<void> schedule({
    required int id,
    required String title,
    required String body,
    required DateTime whenUtc,
    String? payload,
  }) async {}

  @override
  Future<void> cancel(int id) async {}

  @override
  Future<void> cancelAll() async {}
}

/// The real service in the app; overridden with a recording fake in tests
/// and swapped for [NoopNotificationService] if a platform ever needs it.
final notificationServiceProvider = Provider<NotificationService>((ref) {
  return LocalNotificationService();
});
