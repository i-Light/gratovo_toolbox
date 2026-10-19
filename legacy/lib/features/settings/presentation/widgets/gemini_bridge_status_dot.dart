import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';
import 'package:gratovo_toolbox/core/status/gemini_bridge_presentation.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// The Gemini bridge's state as one glyph in the app shell's rail, above the
/// sync button: nothing while stopped (the common case on a machine that
/// never drafts through Gemini), a spinner while starting, a hollow circle
/// while listening for the extension, a tick once connected, an error mark
/// when failed. The tooltip carries the same words the Settings card's chip
/// does, and a tap goes there — the card is where every one of these states
/// is acted on.
class GeminiBridgeStatusDot extends ConsumerWidget {
  const GeminiBridgeStatusDot({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(geminiBridgeProvider).isAvailable) {
      return const SizedBox.shrink();
    }
    final state = ref.watch(geminiBridgeStateProvider);
    if (state.isStopped) return const SizedBox.shrink();

    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final Widget glyph;
    if (state.isStarting) {
      glyph = SizedBox(
        width: 14,
        height: 14,
        child: CircularProgressIndicator(strokeWidth: 2, color: scheme.primary),
      );
    } else {
      final (icon, color) = switch (state.phase) {
        GeminiBridgePhase.connected => (Icons.check_circle, scheme.primary),
        GeminiBridgePhase.failed => (Icons.error, scheme.error),
        _ => (Icons.circle_outlined, scheme.outline),
      };
      glyph = Icon(icon, size: 16, color: color);
    }

    return Tooltip(
      message:
          '${l10n.geminiBridgeTitle}: ${geminiBridgeStateLabel(state, l10n)}',
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => context.go(AppRoutes.settings),
        child: Padding(padding: const EdgeInsets.all(6), child: glyph),
      ),
    );
  }
}
