import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/theme/app_theme.dart';

/// How much attention a toast/notification needs. Drives its icon, its
/// accent color (icon + outline, matched to each other so the outline reads
/// as "the icon's color, traced around the card") and how long it stays on
/// screen before it dismisses itself — more urgent levels linger longer.
enum ToastSeverity {
  /// Something completed as expected. Green, brief.
  success,

  /// Neutral, worth knowing but not acting on. Blue, brief.
  info,

  /// Worth a second look, not yet broken. Amber, holds a little longer.
  warning,

  /// Something failed. Red, holds the longest.
  error;

  IconData get icon => switch (this) {
        ToastSeverity.success => Icons.check_circle_outline,
        ToastSeverity.info => Icons.info_outline,
        ToastSeverity.warning => Icons.warning_amber_rounded,
        ToastSeverity.error => Icons.error_outline,
      };

  /// How long the toast stays visible before it animates out on its own.
  /// Errors and warnings linger longer than a plain success/info blip —
  /// there's more to read, and more reason to want it.
  Duration get displayDuration => switch (this) {
        ToastSeverity.success => const Duration(seconds: 3),
        ToastSeverity.info => const Duration(seconds: 3),
        ToastSeverity.warning => const Duration(seconds: 5),
        ToastSeverity.error => const Duration(seconds: 6),
      };

  /// The one color used for both the icon and the card's outline, so the two
  /// always read as the same signal. Pulled from the theme (not [AppColors]
  /// directly) so it stays correct across light/dark.
  Color color(BuildContext context) {
    final theme = Theme.of(context);
    final status =
        theme.extension<GratovoStatusColors>() ?? GratovoStatusColors.standard;
    return switch (this) {
      ToastSeverity.success => status.success,
      ToastSeverity.info => status.info,
      ToastSeverity.warning => status.warning,
      ToastSeverity.error => theme.colorScheme.error,
    };
  }
}
