import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/time/device_time_zone.dart';
import 'package:gratovo_toolbox/core/time/display_time_zone_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:timezone/timezone.dart' as tz;

/// Picks the zone every date and time in the app is rendered in.
///
/// Lives inside [GeneralSettingsCard] because it is the same kind of
/// per-device display preference as language and theme. The stored data never
/// moves — only the presentation — so switching here is always safe. Defaults
/// to the device zone ([deviceTimeZoneProvider]); an unknown or stale choice
/// silently resolves to UTC (see [DisplayTimeZoneNotifier]).
class TimeZoneSection extends ConsumerWidget {
  const TimeZoneSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final current = ref.watch(displayTimeZoneProvider);
    final deviceZone = ref.watch(deviceTimeZoneProvider).asData?.value;
    final onDeviceZone = deviceZone != null && deviceZone == current;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 16,
      children: [
        Row(mainAxisSize: MainAxisSize.min, spacing: 8, children: [
          const Icon(Icons.schedule_outlined, color: AppColors.offwhite),
          // See startup_settings_card.dart: `mainAxisSize.min` is a request,
          // not a guarantee of room.
          Flexible(
            child: Text(
              l10n.settingsTimeZoneLabel,
              style: Theme.of(context).textTheme.labelLarge,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          )
        ]),
        // The button's label carries the current zone name inside it, so its
        // width is data, not design — "Africa/Cairo" at a large font scale is
        // wider than a narrow card. A Wrap gives its children unbounded width
        // and so cannot rein that in; the cap here is the row's own width, so
        // the label elides at exactly the point it would otherwise spill.
        LayoutBuilder(
          builder: (context, constraints) => Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              ConstrainedBox(
                constraints: BoxConstraints(maxWidth: constraints.maxWidth),
                child: Tooltip(
                  message: l10n.settingsTimeZoneSubtitle,
                  child: FilledButton(
                    onPressed: () => _changeZone(context, ref),
                    child: Text(
                      l10n.settingsTimeZoneChangeButton(current),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
              ),
              if (deviceZone != null && !onDeviceZone)
                IconButton(
                  onPressed: () => ref
                      .read(displayTimeZoneProvider.notifier)
                      .setZone(deviceZone),
                  icon: const Icon(Icons.restore),
                  tooltip: l10n.settingsTimeZoneUseDevice,
                ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _changeZone(BuildContext context, WidgetRef ref) async {
    final chosen = await showDialog<String>(
      context: context,
      builder: (_) => const _TimeZonePickerDialog(),
    );
    if (chosen == null) return;
    await ref.read(displayTimeZoneProvider.notifier).setZone(chosen);
  }
}

/// A search-as-you-type list over every zone name the loaded `timezone`
/// database knows. Pops the chosen IANA name, or null on cancel.
class _TimeZonePickerDialog extends StatefulWidget {
  const _TimeZonePickerDialog();

  @override
  State<_TimeZonePickerDialog> createState() => _TimeZonePickerDialogState();
}

class _TimeZonePickerDialogState extends State<_TimeZonePickerDialog> {
  late final List<String> _all = tz.timeZoneDatabase.locations.keys.toList()
    ..sort();
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final needle = _query.trim().toLowerCase();
    final matches = needle.isEmpty
        ? _all
        : [
            for (final zone in _all)
              if (zone.toLowerCase().contains(needle)) zone,
          ];

    return AlertDialog(
      title: Text(l10n.settingsTimeZoneChange),
      content: SizedBox(
        width: 380,
        height: 440,
        child: Column(
          children: [
            TextField(
              autofocus: true,
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search),
                hintText: l10n.settingsTimeZoneSearchHint,
                isDense: true,
              ),
              onChanged: (value) => setState(() => _query = value),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: matches.isEmpty
                  ? Center(child: Text(l10n.settingsTimeZoneNoMatches))
                  : ListView.builder(
                      itemCount: matches.length,
                      itemBuilder: (context, index) => ListTile(
                        dense: true,
                        title: Text(matches[index]),
                        onTap: () => Navigator.of(context).pop(matches[index]),
                      ),
                    ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
      ],
    );
  }
}
