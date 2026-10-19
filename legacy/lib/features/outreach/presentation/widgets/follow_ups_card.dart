import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/follow_up_cadence.dart';
import 'package:gratovo_toolbox/features/outreach/application/follow_up_scheduler_controller.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/schedule_follow_up_dialog.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The channel's follow-ups: what is due next and how long is left, the button
/// that schedules one (it lived in the thread header before September; the
/// owner asked for it back here, 2026-10-18), and the rule that nothing in it
/// sends by itself.
///
/// Sending a message sets the next reminder from the house-choice cadence
/// (`follow_up_cadence.dart`); the follow-up's text is written and approved
/// when it is due. The countdown ticks every 30 seconds.
class FollowUpsCard extends ConsumerStatefulWidget {
  const FollowUpsCard({
    super.key,
    required this.influencer,
    required this.threadId,
  });

  final Influencer influencer;
  final String threadId;

  @override
  ConsumerState<FollowUpsCard> createState() => _FollowUpsCardState();
}

class _FollowUpsCardState extends ConsumerState<FollowUpsCard> {
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final reminders =
        ref.watch(remindersByInfluencerProvider(widget.influencer.id)).value ??
            const <FollowUpReminder>[];
    final followUps = [
      for (final r in reminders)
        if (r.kind == ReminderKind.followUp) r,
    ];
    final messages =
        ref.watch(messagesByThreadProvider(widget.threadId)).value ??
            const <OutreachMessage>[];
    final sequenceDone = followUps.isEmpty &&
        messages.isNotEmpty &&
        messages.last.direction == MessageDirection.outbound &&
        followUpsSent(messages) >= kMaxFollowUps;
    final fmt = ref.watch(instantFormatterProvider);
    final now = DateTime.now();

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 8, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.outreachFollowUpsSectionTitle,
                    style: theme.textTheme.titleSmall,
                  ),
                ),
                TextButton.icon(
                  key: const Key('thread-schedule-follow-up'),
                  icon: const Icon(Icons.alarm_add_outlined),
                  label: Text(l10n.outreachScheduleFollowUp),
                  onPressed: () => showDialog<void>(
                    context: context,
                    builder: (_) =>
                        ScheduleFollowUpDialog(influencer: widget.influencer),
                  ),
                ),
              ],
            ),
            if (followUps.isEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4, right: 8),
                child: Text(
                  sequenceDone
                      ? l10n.outreachFollowUpsSequenceDone
                      : l10n.outreachFollowUpsEmpty,
                  style: theme.textTheme.bodyMedium,
                ),
              )
            else
              for (final reminder in followUps)
                _FollowUpRow(
                  reminder: reminder,
                  formatted: fmt.dateTime(reminder.dueAt),
                  now: now,
                ),
            Padding(
              padding: const EdgeInsets.only(top: 8, right: 8),
              child: Text(
                l10n.outreachFollowUpsApproval,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// "2d 3h" / "4h 10m" / "12m" for a span, whichever way it points.
String _countdown(AppLocalizations l10n, Duration span) {
  final minutes = span.inMinutes.abs();
  final days = minutes ~/ (60 * 24);
  final hours = (minutes ~/ 60) % 24;
  if (days > 0) return l10n.outreachDurationDaysHours(days, hours);
  if (hours > 0) return l10n.outreachDurationHoursMinutes(hours, minutes % 60);
  return l10n.outreachDurationMinutes(minutes);
}

class _FollowUpRow extends ConsumerWidget {
  const _FollowUpRow({
    required this.reminder,
    required this.formatted,
    required this.now,
  });

  final FollowUpReminder reminder;
  final String formatted;
  final DateTime now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final left = reminder.dueAt.toLocal().difference(now);
    final overdue = left.isNegative;
    final when = overdue
        ? l10n.outreachFollowUpOverdue(_countdown(l10n, left))
        : l10n.outreachFollowUpLeft(_countdown(l10n, left));
    final color =
        overdue ? theme.colorScheme.error : theme.colorScheme.onSurfaceVariant;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      leading: ExcludeSemantics(
        child: Icon(
          overdue ? Icons.alarm_on : Icons.alarm,
          size: 20,
          color: color,
        ),
      ),
      title: Text(reminder.title, maxLines: 2, overflow: TextOverflow.ellipsis),
      subtitle: Text(
        '$formatted · $when',
        style: theme.textTheme.bodySmall?.copyWith(
          color: color,
          fontWeight: overdue ? FontWeight.w600 : null,
        ),
      ),
      trailing: IconButton(
        tooltip: l10n.outreachFollowUpClear,
        icon: const Icon(Icons.check_circle_outline),
        onPressed: () => ref.read(followUpSchedulerProvider).markDone(reminder),
      ),
    );
  }
}
