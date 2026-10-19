import 'package:gratovo_toolbox/core/toast/toast_action.dart';
import 'package:gratovo_toolbox/core/toast/toast_severity.dart';

/// One toast, as recorded in the in-session notification log — the same
/// object that drives the on-screen toast card and the row in the
/// notifications log dialog.
///
/// Session-only by design: nothing here is persisted past app restart. A
/// toast is a transient "here's what just happened", not an audit trail —
/// the activity log (`data/models/activity_log_entry.dart`) already covers
/// that for anything that actually needs to survive a restart.
class NotificationEntry {
  NotificationEntry({
    required this.id,
    required this.message,
    required this.severity,
    required this.createdAt,
    this.action,
  });

  final String id;
  final String message;
  final ToastSeverity severity;
  final DateTime createdAt;

  /// An optional button on the toast card — e.g. "Resume". Not replayable
  /// from the log (the log shows past entries; a stale action button on a
  /// three-minutes-ago row would invite acting on state that's since moved
  /// on), so [NotificationsLogScreen] ignores this field entirely.
  final ToastAction? action;
}
