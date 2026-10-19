import 'package:flutter/material.dart';

/// The raised "open a panel" button two toolbars share — the Search page's
/// settings button and the Scratchpad's sync-log button.
///
/// A card-colored [ElevatedButton] whose hover, press and focus tones come
/// off the scheme's surface ramp, so it lifts the same way in both themes.
/// It used to be two copies of one hand-written map of dark blues, which
/// read fine on the dark theme and vanished on the light one.
ButtonStyle panelButtonStyle(ThemeData theme) {
  final scheme = theme.colorScheme;
  return ButtonStyle(
    elevation: const WidgetStatePropertyAll(5.0),
    foregroundColor: WidgetStatePropertyAll(scheme.onSurface),
    backgroundColor: WidgetStateColor.fromMap(<WidgetStatesConstraint, Color>{
      WidgetState.disabled: scheme.onSurface.withValues(alpha: 0.12),
      WidgetState.pressed: scheme.secondaryContainer,
      WidgetState.hovered: scheme.surfaceContainerHighest,
      WidgetState.focused: scheme.surfaceContainerHigh,
      WidgetState.any: theme.cardColor,
    }),
  );
}
