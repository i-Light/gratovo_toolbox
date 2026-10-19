import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/time/tz_clock.dart';
import 'package:gratovo_toolbox/core/widgets/date_time_picker.dart';
import 'package:gratovo_toolbox/features/outreach/application/scheduled_send_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:timezone/timezone.dart' as tz;

/// The quick choices in the "Send later" dialog.
enum SendLaterPreset { inAnHour, tomorrowMorning, mondayMorning, custom }

/// The UTC instant [preset] means, read in [clock]'s zone -- the display zone
/// from Settings, the one every time on the page is shown in. "Tomorrow at 9"
/// is 9 on that clock, not on whatever zone the machine happens to be set to.
///
/// [customWall] is the wall-clock time picked for [SendLaterPreset.custom],
/// in the same zone.
DateTime resolveSendLater(
  SendLaterPreset preset,
  TzClock clock, {
  required DateTime nowUtc,
  DateTime? customWall,
}) {
  final here = clock.toZone(nowUtc);
  DateTime at9(int daysAhead) => tz.TZDateTime(
          clock.location, here.year, here.month, here.day + daysAhead, 9)
      .toUtc();

  switch (preset) {
    case SendLaterPreset.inAnHour:
      final hour = nowUtc.add(const Duration(hours: 1));
      return DateTime.utc(
          hour.year, hour.month, hour.day, hour.hour, hour.minute);
    case SendLaterPreset.tomorrowMorning:
      return at9(1);
    case SendLaterPreset.mondayMorning:
      final ahead = (DateTime.monday - here.weekday + 7) % 7;
      return at9(ahead == 0 ? 7 : ahead);
    case SendLaterPreset.custom:
      final wall = customWall ?? here.add(const Duration(hours: 1));
      return tz.TZDateTime(clock.location, wall.year, wall.month, wall.day,
              wall.hour, wall.minute)
          .toUtc();
  }
}

/// Asks when to send. Resolves with the chosen instant (UTC), or null.
///
/// [initialUtc] opens it on that time, for moving an email already on the
/// list.
Future<DateTime?> showSendLaterDialog(
  BuildContext context, {
  DateTime? initialUtc,
}) {
  return showDialog<DateTime>(
    context: context,
    builder: (_) => SendLaterDialog(initialUtc: initialUtc),
  );
}

class SendLaterDialog extends ConsumerStatefulWidget {
  const SendLaterDialog({super.key, this.initialUtc});

  final DateTime? initialUtc;

  @override
  ConsumerState<SendLaterDialog> createState() => _SendLaterDialogState();
}

class _SendLaterDialogState extends ConsumerState<SendLaterDialog> {
  late SendLaterPreset _preset;
  DateTime? _customWall;

  @override
  void initState() {
    super.initState();
    final initial = widget.initialUtc;
    if (initial == null) {
      _preset = SendLaterPreset.tomorrowMorning;
    } else {
      _preset = SendLaterPreset.custom;
      final wall = ref.read(tzClockProvider).toZone(initial);
      _customWall =
          DateTime(wall.year, wall.month, wall.day, wall.hour, wall.minute);
    }
  }

  DateTime _resolved() => resolveSendLater(
        _preset,
        ref.read(tzClockProvider),
        nowUtc: ref.read(scheduledSendClockProvider)(),
        customWall: _customWall,
      );

  Future<void> _pickCustom() async {
    final clock = ref.read(tzClockProvider);
    final start = clock.toZone(_resolved());
    final picked = await pickDateTime(
      context,
      initial: DateTime(
          start.year, start.month, start.day, start.hour, start.minute),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _customWall = picked;
      _preset = SendLaterPreset.custom;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final clock = ref.watch(tzClockProvider);
    final when = _resolved();
    final inPast = !when.isAfter(ref.read(scheduledSendClockProvider)());

    return AlertDialog(
      title: Text(l10n.outreachSendLater),
      content: SizedBox(
        width: 400,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final (preset, label) in <(SendLaterPreset, String)>[
                  (SendLaterPreset.inAnHour, l10n.outreachSendLaterInAnHour),
                  (
                    SendLaterPreset.tomorrowMorning,
                    l10n.outreachSendLaterTomorrowMorning
                  ),
                  (
                    SendLaterPreset.mondayMorning,
                    l10n.outreachSendLaterMondayMorning
                  ),
                  (SendLaterPreset.custom, l10n.outreachFollowUpCustom),
                ])
                  ChoiceChip(
                    key: Key('send-later-preset-${preset.name}'),
                    label: Text(label),
                    selected: _preset == preset,
                    onSelected: (_) {
                      if (preset == SendLaterPreset.custom) {
                        _pickCustom();
                      } else {
                        setState(() => _preset = preset);
                      }
                    },
                  ),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                const Icon(Icons.schedule_send_outlined, size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    fmt.dateTime(when),
                    key: const Key('send-later-when'),
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                if (_preset == SendLaterPreset.custom)
                  TextButton.icon(
                    onPressed: _pickCustom,
                    icon: const Icon(Icons.event_outlined),
                    label: Text(l10n.outreachFollowUpPickDateTime),
                  ),
              ],
            ),
            Text(
              l10n.outreachSendLaterZone(clock.zoneName),
              style: theme.textTheme.bodySmall,
            ),
            if (inPast) ...[
              const SizedBox(height: 8),
              Text(
                l10n.outreachSendLaterInPast,
                key: const Key('send-later-in-past'),
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.error),
              ),
            ],
            const SizedBox(height: 12),
            Text(
              l10n.outreachSendLaterHowItWorks,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
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
        FilledButton(
          key: const Key('send-later-confirm'),
          onPressed: inPast ? null : () => Navigator.of(context).pop(when),
          child: Text(l10n.outreachSendLaterSchedule),
        ),
      ],
    );
  }
}
