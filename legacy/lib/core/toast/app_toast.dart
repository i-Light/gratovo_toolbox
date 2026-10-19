import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/toast/notification_center.dart';
import 'package:gratovo_toolbox/core/toast/toast_action.dart';
import 'package:gratovo_toolbox/core/toast/toast_severity.dart';

/// The app-wide entry point for raising a toast — the direct replacement for
/// the old `ScaffoldMessenger.of(context).showSnackBar(SnackBar(...))` calls
/// scattered through every feature.
///
/// Static and context-based (not `ref`-based) so it drops into any widget,
/// `Consumer` or not, with the same call shape the old snackbar calls had.
/// It reads the provider container off [context] rather than requiring a
/// `WidgetRef` — [ToastOverlay] (mounted once at the app root) is what
/// actually renders the result, so the call site needs nothing more than a
/// `BuildContext` still inside the widget tree.
abstract final class AppToast {
  /// Shows [message] as a toast at [severity] (defaults to
  /// [ToastSeverity.info]) and records it in the notifications log. Prefer
  /// the named [success]/[info]/[warning]/[error] helpers below at call
  /// sites — they read as intent rather than an enum value.
  static void show(
    BuildContext context,
    String message, {
    ToastSeverity severity = ToastSeverity.info,
    ToastAction? action,
    Duration? duration,
  }) {
    ProviderScope.containerOf(context, listen: false)
        .read(notificationCenterProvider.notifier)
        .notify(message, severity, action: action, duration: duration);
  }

  static void success(
    BuildContext context,
    String message, {
    ToastAction? action,
    Duration? duration,
  }) =>
      show(
        context,
        message,
        severity: ToastSeverity.success,
        action: action,
        duration: duration,
      );

  static void info(
    BuildContext context,
    String message, {
    ToastAction? action,
    Duration? duration,
  }) =>
      show(
        context,
        message,
        severity: ToastSeverity.info,
        action: action,
        duration: duration,
      );

  static void warning(
    BuildContext context,
    String message, {
    ToastAction? action,
    Duration? duration,
  }) =>
      show(
        context,
        message,
        severity: ToastSeverity.warning,
        action: action,
        duration: duration,
      );

  static void error(
    BuildContext context,
    String message, {
    ToastAction? action,
    Duration? duration,
  }) =>
      show(
        context,
        message,
        severity: ToastSeverity.error,
        action: action,
        duration: duration,
      );
}
