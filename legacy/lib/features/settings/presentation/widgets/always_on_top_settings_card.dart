import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/always_on_top_store.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Whether the app window stays pinned above all other windows.
///
/// Same shape as [StartupSettingsSection]: the checkbox reflects and
/// drives the real window-manager state directly, so what's checked
/// always matches what's actually pinned.
///
/// Desktop only: mobile and web have no concept of window stacking,
/// so this shows an explanation instead of a checkbox that couldn't
/// do anything.
class AlwaysOnTopSettingsSection extends StatefulWidget {
  const AlwaysOnTopSettingsSection({super.key});

  @override
  State<AlwaysOnTopSettingsSection> createState() =>
      _AlwaysOnTopSettingsSectionState();
}

class _AlwaysOnTopSettingsSectionState
    extends State<AlwaysOnTopSettingsSection> {
  bool? _enabled;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!AlwaysOnTopStore.isAvailable) return;
    final enabled = await AlwaysOnTopStore.isEnabled();
    if (mounted) setState(() => _enabled = enabled);
  }

  Future<void> _toggle(bool value) async {
    setState(() => _busy = true);
    try {
      await (value ? AlwaysOnTopStore.enable() : AlwaysOnTopStore.disable());
    } finally {
      await _load();
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    if (!AlwaysOnTopStore.isAvailable) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        spacing: 8,
        children: [
          const Icon(Icons.push_pin_outlined),
          Text(l10n.settingsAlwaysOnTopTitle,
              style: theme.textTheme.labelLarge),
          Text(l10n.settingsAlwaysOnTopNoSupport,
              style: theme.textTheme.bodySmall),
        ],
      );
    }

    final enabled = _enabled ?? false;

    return Tooltip(
      message: '${l10n.settingsAlwaysOnTopLabel}\n'
          '${enabled ? l10n.settingsAlwaysOnTopOn : l10n.settingsAlwaysOnTopOff}',
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        spacing: 8,
        children: [
          const Icon(Icons.push_pin_outlined),
          // See the note in startup_settings_card.dart: the row's minimum is
          // not a promise of room.
          Flexible(
            child: Text(
              l10n.settingsAlwaysOnTopTitle,
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
