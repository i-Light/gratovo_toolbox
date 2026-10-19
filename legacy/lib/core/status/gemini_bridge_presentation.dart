import 'package:gratovo_toolbox/core/native/gemini_bridge_types.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Localized wording for the Gemini bridge's state and failures.
///
/// Lives in `core/status/` beside the other presentation helpers because
/// three features read it — the Settings card, the Search keywords dialog
/// and the Outreach draft stepper — and a failure has to read the same way
/// in all three: the code, the daemon's own message, and (when the fix is a
/// Settings matter) where to go. Never a raw exception string.

/// One line for the bridge's phase: "Connected as Name (email)", "Listening
/// on port 8765 — waiting for the extension", and so on.
String geminiBridgeStateLabel(GeminiBridgeState state, AppLocalizations l10n) {
  switch (state.phase) {
    case GeminiBridgePhase.stopped:
      return l10n.geminiBridgeStateStopped;
    case GeminiBridgePhase.starting:
      return l10n.geminiBridgeStateStarting;
    case GeminiBridgePhase.listening:
      return l10n.geminiBridgeStateListening(
        '${state.port ?? GeminiBridgeSettings.defaultPort}',
      );
    case GeminiBridgePhase.connected:
      final account = state.account;
      if (account == null || account.isEmpty) {
        return l10n.geminiBridgeStateConnectedNoAccount;
      }
      return l10n.geminiBridgeStateConnected(account.label);
    case GeminiBridgePhase.failed:
      return l10n.geminiBridgeStateFailed;
  }
}

/// "CODE: message", plus a pointer to Settings when the failure is a bridge
/// problem rather than something about the task at hand.
String describeGeminiFailure(
  GeminiBridgeException error,
  AppLocalizations l10n,
) {
  final line = l10n.geminiBridgeFailure(error.code, error.message);
  if (error.failure.isBridgeProblem) {
    return '$line\n${l10n.geminiBridgeFailureHint}';
  }
  return line;
}

/// Whether the dialogs that need a Gemini tab can be offered at all: the
/// platform has the daemon and it is not in a failed state. Stopped counts —
/// the first call starts it.
bool geminiBridgeUsable(GeminiBridge bridge) =>
    bridge.isAvailable && !bridge.state.isFailed;
