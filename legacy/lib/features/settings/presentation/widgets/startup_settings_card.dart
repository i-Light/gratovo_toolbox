import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/startup/startup_launch_store.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Whether the app registers itself with the OS to launch automatically
/// when the user logs into their machine.
///
/// There's only one thing to track here, unlike the image cache setting:
/// the checkbox reflects and drives the real OS-level registration
/// directly, rather than a stored preference that gets applied later.
/// Flipping it calls out to the OS right away, so what's checked always
/// matches what's actually registered — never a setting the app hasn't
/// gotten around to honoring yet.
///
/// On by default in most installs of a tool people rely on being open
/// every workday, so it's already running rather than waited on. Turning
/// it off is the right call on a machine shared with other things, where
/// one more app at login adds to everyone's wait.
///
/// Desktop only: on mobile and web there's no OS-level "launch at login"
/// to register with, so this shows an explanation instead of a checkbox
/// that couldn't do anything.
class StartupSettingsSection extends StatefulWidget {
  const StartupSettingsSection({super.key});

  @override
  State<StartupSettingsSection> createState() => _StartupSettingsSectionState();
}

class _StartupSettingsSectionState extends State<StartupSettingsSection> {
  bool? _enabled;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!StartupLaunchStore.isAvailable) return;
    final enabled = await StartupLaunchStore.isEnabled();
    if (mounted) setState(() => _enabled = enabled);
  }

  Future<void> _toggle(bool value) async {
    setState(() => _busy = true);
    try {
      // If the OS refuses the change (e.g. a permissions prompt was
      // dismissed), _load() below re-reads the real state, so the
      // checkbox snaps back rather than showing a value that isn't true.
      await (value
          ? StartupLaunchStore.enable()
          : StartupLaunchStore.disable());
    } finally {
      await _load();
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    if (!StartupLaunchStore.isAvailable) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        spacing: 8,
        children: [
          const Icon(Icons.rocket_launch_outlined),
          Text(l10n.settingsStartupTitle, style: theme.textTheme.labelLarge),
          Text(l10n.settingsStartupNoSupport, style: theme.textTheme.bodySmall),
        ],
      );
    }

    final enabled = _enabled ?? false;

    return Tooltip(
      message: '${l10n.settingsLaunchAtStartupLabel}\n'
          '${enabled ? l10n.settingsLaunchAtStartupOn : l10n.settingsLaunchAtStartupOff}',
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        spacing: 8,
        children: [
          const Icon(Icons.rocket_launch_outlined),
          // Flexible: `mainAxisSize.min` is what the row asks for, not what
          // the Settings grid gives it, and in a narrow column the label is
          // wider than its share. Unflexed, it overflows instead of eliding.
          Flexible(
            child: Text(
              l10n.settingsStartupTitle,
              style: theme.textTheme.labelLarge,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (_busy)
            const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          else
            Checkbox(
              value: enabled,
              // No `materialTapTargetSize: shrinkWrap` — it took this row's
              // whole hit area down to 32px, under every platform's floor,
              // to save eight pixels on a Settings card with room to
              // spare. `compact` alone still trims the standard 48 to 40.
              visualDensity: VisualDensity.compact,
              onChanged: (value) => _toggle(value ?? enabled),
            ),
        ],
      ),
    );
  }
}
