import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/notifications/notification_service.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/follow_up_cadence.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The quick "when should I chase this up" choices in the schedule dialog.
enum FollowUpPreset { tomorrow, inThreeDays, inAWeek, custom }

const _permissionAskedKey = 'gratovo.notifications.asked';

/// Creates, moves and clears follow-up reminders, and mirrors each one into a
/// best-effort desktop notification.
///
/// The reminder row is the real thing — it shows on the Dashboard and as the
/// due/overdue chip on the Outreach thread list regardless of whether a
/// notification ever fires. The toast is best-effort on top:
/// [NotificationService] swallows a failure, and [NotificationReconciler]
/// re-arms the OS schedule from the reminder list on every launch.
class FollowUpScheduler {
  FollowUpScheduler(this._ref);

  final Ref _ref;

  /// A local wall-clock [DateTime] for [preset]. Presets land at 09:00 on the
  /// day N days from [now]; `custom` passes [custom] straight through. The
  /// caller stores/transports `.toUtc()`.
  DateTime resolve(
    FollowUpPreset preset, {
    DateTime? custom,
    DateTime? now,
  }) {
    final base = now ?? DateTime.now();
    DateTime atNine(int daysFromNow) {
      final day = DateTime(base.year, base.month, base.day)
          .add(Duration(days: daysFromNow));
      return DateTime(day.year, day.month, day.day, 9);
    }

    return switch (preset) {
      FollowUpPreset.tomorrow => atNine(1),
      FollowUpPreset.inThreeDays => atNine(3),
      FollowUpPreset.inAWeek => atNine(7),
      FollowUpPreset.custom => custom ?? atNine(1),
    };
  }

  /// Creates a reminder for [influencerId] due at [dueUtc], schedules its
  /// notification, and refreshes the reminder providers.
  ///
  /// Returns whether a desktop notification was actually armed — the dialog
  /// shows a softer confirmation when it wasn't (permission denied, or the
  /// no-op service).
  Future<bool> schedule({
    required String influencerId,
    required String title,
    required DateTime dueUtc,
  }) async {
    final repo = _ref.read(reminderRepositoryProvider);
    final created = await repo.create(
      FollowUpReminder(
        id: '',
        title: title.trim(),
        dueAt: dueUtc,
        kind: ReminderKind.followUp,
        influencerId: influencerId,
      ),
    );

    final notified = await _tryNotify(created);
    _announce();
    return notified;
  }

  /// Moves an existing reminder to [dueUtc] (and optionally retitles it),
  /// re-arming its notification.
  Future<bool> reschedule(
    FollowUpReminder reminder, {
    required DateTime dueUtc,
    String? title,
  }) async {
    final repo = _ref.read(reminderRepositoryProvider);
    final updated = reminder.copyWith(dueAt: dueUtc, title: title);
    await repo.update(updated);

    await _ref.read(notificationServiceProvider).cancel(notifId(reminder.id));
    final notified = await _tryNotify(updated);
    _announce();
    return notified;
  }

  /// Marks a reminder done and cancels its pending notification.
  Future<void> markDone(FollowUpReminder reminder) async {
    await _ref.read(reminderRepositoryProvider).complete(reminder.id);
    await _ref.read(notificationServiceProvider).cancel(notifId(reminder.id));
    _announce();
  }

  /// After a message goes out to [influencerId]: the follow-up reminders it
  /// answered are done, and the next one is set when [next] says one is due
  /// (see `follow_up_cadence.dart`). Deal deadlines and other kinds are left
  /// alone. [title] names follow-up number N for the reminder.
  Future<void> rollForward({
    required String influencerId,
    required NextFollowUp? next,
    required String Function(int number) title,
  }) async {
    final repo = _ref.read(reminderRepositoryProvider);
    final service = _ref.read(notificationServiceProvider);
    for (final reminder in await repo.getForInfluencer(influencerId)) {
      if (reminder.kind != ReminderKind.followUp) continue;
      await repo.complete(reminder.id);
      await service.cancel(notifId(reminder.id));
    }
    if (next == null) {
      _announce();
      return;
    }
    await schedule(
      influencerId: influencerId,
      title: title(next.number),
      dueUtc: next.dueAt.toUtc(),
    );
  }

  /// Clears every open follow-up for a channel and cancels each one's
  /// notification — used when a reply lands and the outstanding "chase them"
  /// nudges no longer apply.
  Future<void> clearAllForInfluencer(String influencerId) async {
    final repo = _ref.read(reminderRepositoryProvider);
    final open = await repo.getForInfluencer(influencerId);
    await repo.completeForInfluencer(influencerId);
    final service = _ref.read(notificationServiceProvider);
    for (final reminder in open) {
      await service.cancel(notifId(reminder.id));
    }
    _announce();
  }

  Future<bool> _tryNotify(FollowUpReminder reminder) async {
    if (!reminder.dueAt.toUtc().isAfter(DateTime.now().toUtc())) return false;
    final service = _ref.read(notificationServiceProvider);
    try {
      final granted = await _ensurePermission(service);
      if (!granted) return false;
      await service.schedule(
        id: notifId(reminder.id),
        title: reminder.title,
        body: reminder.title,
        whenUtc: reminder.dueAt.toUtc(),
        payload: reminder.influencerId == null
            ? null
            : 'thread:${reminder.influencerId}',
      );
      return true;
    } catch (error, stackTrace) {
      developer.log(
        'Follow-up notification could not be scheduled; the reminder itself '
        'was still saved.',
        name: 'gratovo.outreach.followUp',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
      return false;
    }
  }

  /// Asks for OS permission once, ever, and remembers the answer. A later
  /// call just re-reads whatever the service reports now.
  Future<bool> _ensurePermission(NotificationService service) async {
    SharedPreferences? prefs;
    try {
      prefs = await SharedPreferences.getInstance();
    } catch (_) {
      // No prefs (e.g. under test) — fall through and just ask the service.
    }
    final asked = prefs?.getBool(_permissionAskedKey) ?? false;
    final granted = await service.requestPermission();
    if (!asked) {
      try {
        await prefs?.setBool(_permissionAskedKey, true);
      } catch (_) {}
    }
    return granted;
  }

  /// One announcement covers the dashboard's outreach tile, the profile's
  /// scheduled-follow-ups section and the thread list's due/overdue chips —
  /// none of which this file has to know exist.
  void _announce() => _ref.bumpData(const {DataDomain.reminders});

  /// A stable non-negative 32-bit id derived from the reminder's own id, so
  /// [NotificationReconciler] can cancel/replace a notification without
  /// keeping its own mapping.
  static int notifId(String reminderId) => reminderId.hashCode & 0x7fffffff;
}

final followUpSchedulerProvider = Provider<FollowUpScheduler>((ref) {
  return FollowUpScheduler(ref);
});
