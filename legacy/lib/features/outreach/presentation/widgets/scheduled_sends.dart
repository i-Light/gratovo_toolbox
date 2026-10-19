import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/data/models/scheduled_email.dart';
import 'package:gratovo_toolbox/features/outreach/application/scheduled_send_controller.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/send_later_dialog.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// One "Send later" email with everything that can still be done to it:
/// Send now, Change time, Edit (back into the composer) and Don't send.
///
/// [onEdit] is given only where a composer for its thread is on screen.
class ScheduledEmailTile extends ConsumerWidget {
  const ScheduledEmailTile({
    super.key,
    required this.email,
    this.showHandle = false,
    this.onEdit,
  });

  final ScheduledEmail email;
  final bool showHandle;
  final ValueChanged<ScheduledEmail>? onEdit;

  Future<void> _sendNow(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    final outcome = await ref
        .read(scheduledSendProvider.notifier)
        .sendNow(email.id, evenIfMaybeSent: email.mayHaveBeenSent);
    if (!context.mounted) return;
    switch (outcome) {
      case ScheduledSendOutcome.sent:
        AppToast.success(context, l10n.outreachScheduledSentTo(email.to));
      case ScheduledSendOutcome.busy:
        AppToast.warning(context, l10n.outreachScheduledBusy);
      case ScheduledSendOutcome.failed:
        final failed = ref
            .read(scheduledSendProvider)
            .emails
            .where((e) => e.id == email.id)
            .firstOrNull;
        AppToast.error(
          context,
          l10n.outreachScheduledFailed(failed?.lastError ?? l10n.commonError),
        );
      case ScheduledSendOutcome.missing:
        break;
    }
  }

  Future<void> _changeTime(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    final fmt = ref.read(instantFormatterProvider);
    final when = await showSendLaterDialog(context, initialUtc: email.sendAt);
    if (when == null) return;
    final moved = await ref
        .read(scheduledSendProvider.notifier)
        .reschedule(email.id, when);
    if (!context.mounted) return;
    if (moved) {
      AppToast.success(
          context, l10n.outreachSendLaterScheduled(fmt.dateTime(when)));
    } else {
      AppToast.warning(context, l10n.outreachScheduledBusy);
    }
  }

  Future<void> _dontSend(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    final cancelled =
        await ref.read(scheduledSendProvider.notifier).cancel(email.id);
    if (!context.mounted) return;
    if (cancelled) {
      AppToast.success(context, l10n.outreachScheduledCancelled);
    } else {
      AppToast.warning(context, l10n.outreachScheduledBusy);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final now = ref.watch(scheduledSendProvider.select((s) => s.checkedAt));
    final sending = email.status == ScheduledEmailStatus.sending;
    final failed = email.status == ScheduledEmailStatus.failed;
    final late = now != null && ScheduledSendState.isLate(email, now);

    final String status;
    if (sending) {
      status = l10n.outreachSendingWithGmail;
    } else if (email.mayHaveBeenSent) {
      status = l10n.outreachScheduledMaybeSent;
    } else if (failed) {
      status =
          l10n.outreachScheduledFailed(email.lastError ?? l10n.commonError);
    } else if (late) {
      status = l10n.outreachScheduledLate(fmt.dateTime(email.sendAt));
    } else {
      status = l10n.outreachScheduledFor(fmt.dateTime(email.sendAt));
    }
    final warn = failed || late;
    final color =
        warn ? theme.colorScheme.error : theme.colorScheme.onSurfaceVariant;
    final title = [
      if (showHandle && email.handle.isNotEmpty) email.handle,
      if (email.subject.isNotEmpty) email.subject else email.to,
    ].join(' · ');

    return Padding(
      key: Key('scheduled-email-${email.id}'),
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: sending
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Icon(
                    warn ? Icons.error_outline : Icons.schedule_send_outlined,
                    size: 18,
                    color: warn ? color : theme.colorScheme.primary,
                  ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodyMedium,
                ),
                Text(
                  status,
                  key: const Key('scheduled-email-status'),
                  style: theme.textTheme.bodySmall?.copyWith(color: color),
                ),
                if (!sending)
                  Wrap(
                    spacing: 4,
                    children: [
                      TextButton(
                        key: const Key('scheduled-send-now'),
                        onPressed: () => _sendNow(context, ref),
                        child: Text(email.mayHaveBeenSent
                            ? l10n.outreachScheduledSendAnyway
                            : l10n.outreachScheduledSendNow),
                      ),
                      TextButton(
                        key: const Key('scheduled-change-time'),
                        onPressed: () => _changeTime(context, ref),
                        child: Text(l10n.outreachScheduledChangeTime),
                      ),
                      if (onEdit != null)
                        TextButton(
                          key: const Key('scheduled-edit'),
                          onPressed: () => onEdit!(email),
                          child: Text(l10n.outreachScheduledEdit),
                        ),
                      TextButton(
                        key: const Key('scheduled-dont-send'),
                        onPressed: () => _dontSend(context, ref),
                        child: Text(l10n.outreachScheduledDontSend),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The emails waiting to go out on one thread, above the composer's actions.
/// Nothing at all when there are none.
class ScheduledSendsForThread extends ConsumerWidget {
  const ScheduledSendsForThread({
    super.key,
    required this.threadId,
    this.onEdit,
  });

  final String threadId;
  final ValueChanged<ScheduledEmail>? onEdit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final emails = ref.watch(scheduledSendProvider).forThread(threadId);
    if (emails.isEmpty) return const SizedBox.shrink();
    return Padding(
      key: const Key('composer-scheduled-sends'),
      padding: const EdgeInsets.fromLTRB(25, 8, 25, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final email in emails)
            ScheduledEmailTile(email: email, onEdit: onEdit),
        ],
      ),
    );
  }
}

/// Everything that did not go out on its own and waits for a person.
Future<void> showScheduledSendsReview(BuildContext context) {
  return showDialog<void>(
    context: context,
    builder: (_) => const _ScheduledSendsReviewDialog(),
  );
}

class _ScheduledSendsReviewDialog extends ConsumerWidget {
  const _ScheduledSendsReviewDialog();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final waiting = ref.watch(scheduledSendProvider).needsAttention;
    return AlertDialog(
      title: Text(l10n.outreachScheduledReviewTitle),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(l10n.outreachScheduledReviewIntro),
              const SizedBox(height: 12),
              if (waiting.isEmpty)
                Text(l10n.outreachScheduledReviewEmpty)
              else
                for (final email in waiting)
                  ScheduledEmailTile(email: email, showHandle: true),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonClose),
        ),
      ],
    );
  }
}

/// A strip along the bottom of the app while any scheduled email waits for a
/// decision -- late because the app was closed at its time, or failed.
///
/// In the shell rather than on the Outreach page: the launch after a night
/// with the laptop shut can open on any page, and an email that silently
/// did not go out is exactly the thing nobody goes looking for.
class ScheduledSendsAttentionStrip extends ConsumerWidget {
  const ScheduledSendsAttentionStrip({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count =
        ref.watch(scheduledSendProvider.select((s) => s.needsAttention.length));
    if (count == 0) return const SizedBox.shrink();

    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Material(
      key: const Key('scheduled-attention-strip'),
      color: scheme.tertiaryContainer,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
          child: Row(
            children: [
              Icon(Icons.schedule_send_outlined,
                  size: 18, color: scheme.onTertiaryContainer),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  l10n.outreachScheduledBanner(count),
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(color: scheme.onTertiaryContainer),
                ),
              ),
              TextButton(
                key: const Key('scheduled-attention-review'),
                onPressed: () => showScheduledSendsReview(context),
                style: TextButton.styleFrom(
                  foregroundColor: scheme.onTertiaryContainer,
                ),
                child: Text(l10n.outreachScheduledReview),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A clock on a thread-list row that has an email waiting to go out, with
/// the soonest time. Red when one of them needs a decision.
class ScheduledSendChip extends ConsumerWidget {
  const ScheduledSendChip({super.key, required this.threadId});

  final String threadId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // A record, so the row rebuilds when this thread's answer changes and not
    // on every tick of the list.
    final (soonest, attention) = ref.watch(
      scheduledSendProvider.select((s) {
        final mine = s.forThread(threadId);
        if (mine.isEmpty) return (null, false);
        final waiting = s.needsAttention.any((e) => e.threadId == threadId);
        final first =
            mine.map((e) => e.sendAt).reduce((a, b) => a.isBefore(b) ? a : b);
        return (first, waiting);
      }),
    );
    if (soonest == null) return const SizedBox.shrink();

    final l10n = AppLocalizations.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final scheme = Theme.of(context).colorScheme;
    final color = attention ? scheme.error : scheme.primary;
    return Tooltip(
      message: l10n.outreachScheduledChipTooltip(fmt.dateTime(soonest)),
      child: Row(
        key: const Key('thread-scheduled-chip'),
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.schedule_send_outlined, size: 12, color: color),
          const SizedBox(width: 3),
          Text(
            fmt.pattern(soonest, 'EEE d, HH:mm'),
            style:
                Theme.of(context).textTheme.labelSmall?.copyWith(color: color),
          ),
        ],
      ),
    );
  }
}
