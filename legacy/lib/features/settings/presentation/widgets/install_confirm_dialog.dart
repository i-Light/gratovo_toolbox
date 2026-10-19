import 'dart:async';

import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// How long the countdown runs, in counted time — not wall-clock time. A
/// window left in the background for an hour has counted nothing.
const kInstallConfirmCountdown = Duration(seconds: 5);

/// How recently the user must have done something for the countdown to be
/// counting. Long enough that reading the dialog while resting a hand on the
/// mouse keeps it running, short enough that walking away stops it within a
/// breath.
const kInstallConfirmActivityWindow = Duration(milliseconds: 1500);

const _tick = Duration(milliseconds: 100);

/// The "you asked to install while a sync was still going" confirmation.
///
/// The install button is not offered immediately, and the delay before it is
/// offered only runs while somebody is actually here: the window has to be
/// focused, and there has to have been a pointer or keyboard event within
/// [kInstallConfirmActivityWindow]. The whole point of the countdown is to buy
/// five seconds of a person's attention before the app restarts underneath
/// unsaved work, and a countdown that expires against an unattended screen
/// buys nothing. So it pauses, says why, and waits.
///
/// While it counts, the dialog pulses — the flashing is what makes a
/// five-second wait read as "this is deliberate, look at it" rather than as
/// the button being broken.
///
/// Returns true when the user insisted, false or null when they backed out.
class InstallConfirmDialog extends StatefulWidget {
  const InstallConfirmDialog({super.key, this.sideBySideVersion});

  /// Set when the update will land in its own folder, so the dialog can say
  /// the current install is not being replaced — which is the main reason
  /// somebody might reasonably insist.
  final String? sideBySideVersion;

  @override
  State<InstallConfirmDialog> createState() => _InstallConfirmDialogState();
}

class _InstallConfirmDialogState extends State<InstallConfirmDialog>
    with WidgetsBindingObserver, SingleTickerProviderStateMixin {
  Timer? _timer;
  late final AnimationController _flash = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat(reverse: true);

  Duration _remaining = kInstallConfirmCountdown;
  DateTime _lastActivity = DateTime.now();

  /// Whether the app window itself has focus. Desktop Flutter reports focus
  /// loss as [AppLifecycleState.inactive], which is exactly the "they clicked
  /// on something else" case this needs to catch.
  bool _focused = true;

  bool get _isCounting =>
      _focused &&
      DateTime.now().difference(_lastActivity) <= kInstallConfirmActivityWindow;

  bool get _ready => _remaining <= Duration.zero;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _timer = Timer.periodic(_tick, (_) {
      if (_ready) return;
      if (!_isCounting) {
        // Re-render so the "move the mouse" hint appears the moment it stops
        // counting, rather than at the next real tick.
        setState(() {});
        return;
      }
      setState(() => _remaining -= _tick);
      if (_ready) {
        _flash.stop();
        _timer?.cancel();
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final focused = state == AppLifecycleState.resumed;
    if (focused != _focused) setState(() => _focused = focused);
  }

  @override
  void dispose() {
    _timer?.cancel();
    _flash.dispose();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  void _noteActivity() {
    _lastActivity = DateTime.now();
    if (!_focused) setState(() => _focused = true);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final counting = _isCounting && !_ready;

    return Listener(
      // Anywhere in the dialog counts, including a click that lands on
      // nothing — "trying to click" is the signal, not hitting a target.
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _noteActivity(),
      onPointerMove: (_) => _noteActivity(),
      onPointerHover: (_) => _noteActivity(),
      onPointerSignal: (_) => _noteActivity(),
      child: Focus(
        autofocus: true,
        onKeyEvent: (_, __) {
          _noteActivity();
          // Never consumed: the dialog's own buttons and Escape must still
          // work while this is watching for signs of life.
          return KeyEventResult.ignored;
        },
        child: AnimatedBuilder(
          animation: _flash,
          builder: (context, child) {
            // Only pulses while actually counting — a frozen countdown with a
            // pulsing border would be saying two different things at once.
            final t = counting ? _flash.value : 0.0;
            return AlertDialog(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
                side: BorderSide(
                  color: Color.lerp(
                    theme.colorScheme.outlineVariant,
                    theme.colorScheme.primary,
                    t,
                  )!,
                  width: 1 + t,
                ),
              ),
              title: Text(l10n.settingsUpdateConfirmTitle),
              content: child,
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  child: Text(l10n.settingsUpdateConfirmWait),
                ),
                if (_ready)
                  FilledButton.icon(
                    onPressed: () => Navigator.of(context).pop(true),
                    icon: const Icon(Icons.system_update_alt, size: 18),
                    label: Text(l10n.settingsUpdateConfirmInstall),
                  )
                else
                  // Disabled on purpose, and still showing the count: a button
                  // that is simply absent for five seconds reads as a bug, and
                  // one that appears without warning gets clicked by accident.
                  FilledButton(
                    onPressed: null,
                    child: Text(
                      l10n.settingsUpdateConfirmCountdown(_secondsLabel),
                    ),
                  ),
              ],
            );
          },
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(l10n.settingsUpdateConfirmBody),
              if (widget.sideBySideVersion != null) ...[
                const SizedBox(height: 12),
                Text(
                  l10n.settingsUpdateConfirmSideBySide(
                    widget.sideBySideVersion!,
                  ),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
              const SizedBox(height: 16),
              LinearProgressIndicator(
                value: 1 -
                    (_remaining.inMilliseconds /
                        kInstallConfirmCountdown.inMilliseconds),
              ),
              const SizedBox(height: 8),
              // Only shown while stalled, and it says what to do about it —
              // otherwise a paused countdown looks like a frozen app.
              SizedBox(
                height: 18,
                child: counting || _ready
                    ? null
                    : Text(
                        l10n.settingsUpdateConfirmPaused,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Rounded up, so the last tenth of a second still reads as "1" rather than
  /// flicking to "0" a beat before the button appears.
  String get _secondsLabel =>
      (_remaining.inMilliseconds / 1000).ceil().clamp(0, 99).toString();
}
