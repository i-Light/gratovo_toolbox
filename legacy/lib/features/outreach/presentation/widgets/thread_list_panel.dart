import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/theme/app_theme.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/widgets/status_badge.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_classification_filter_controller.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_sla.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/access_level_notice.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/scheduled_sends.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/thread_message_history.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// The list of outreach conversations, most-recently-updated first. Tapping
/// one navigates to `/outreach/thread/:id`, which the detail panel reads from
/// the route — selection is URL state now, not a provider.
///
/// Each row also carries a due/overdue chip for that channel's soonest open
/// follow-up reminder, sourced once from [openReminderByInfluencerProvider]
/// (no per-row query).
///
/// The selected row expands to show that conversation's messages. The history
/// belongs beside the composer rather than above it — see
/// [ThreadMessageHistory] — and only one row is ever open, so the list stays a
/// list.
class ThreadListPanel extends ConsumerWidget {
  const ThreadListPanel({super.key, this.selectedThreadId});

  final String? selectedThreadId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final threadsAsync = ref.watch(allOutreachThreadsProvider);
    final classificationFilter =
        ref.watch(outreachClassificationFilterProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _ClassificationFilterBar(),
        Expanded(
          child: threadsAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, stackTrace) => Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(l10n.commonError),
                  TextButton(
                    onPressed: () => ref.invalidate(allOutreachThreadsProvider),
                    child: Text(l10n.commonRetry),
                  ),
                ],
              ),
            ),
            data: (threads) {
              if (threads.isEmpty) {
                return Center(child: Text(l10n.outreachThreadListEmpty));
              }
              if (classificationFilter == null) {
                return _ThreadList(
                  threads: threads,
                  selectedThreadId: selectedThreadId,
                );
              }
              // A filter is picked: narrow to the threads whose latest
              // classification matches, via one small query per thread
              // rather than the whole-table `allOutreachThreadsProvider`
              // pretending to know something it doesn't carry.
              final idsAsync = ref
                  .watch(threadsByClassificationProvider(classificationFilter));
              return idsAsync.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, stackTrace) =>
                    Center(child: Text(l10n.commonError)),
                data: (ids) {
                  final filtered =
                      threads.where((t) => ids.contains(t.id)).toList();
                  if (filtered.isEmpty) {
                    return Center(
                      child: Text(l10n.outreachClassificationFilterEmpty),
                    );
                  }
                  return _ThreadList(
                    threads: filtered,
                    selectedThreadId: selectedThreadId,
                  );
                },
              );
            },
          ),
        ),
      ],
    );
  }
}

/// The scrollable rows themselves, factored out of [ThreadListPanel] so the
/// "which threads" decision (all of them, or a classification-filtered
/// subset) stays separate from "how a row of threads renders".
class _ThreadList extends StatelessWidget {
  const _ThreadList({required this.threads, required this.selectedThreadId});

  final List<OutreachThread> threads;
  final String? selectedThreadId;

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      itemCount: threads.length,
      itemBuilder: (context, index) {
        final thread = threads[index];
        final selected = thread.id == selectedThreadId;
        if (!selected) {
          return _ThreadTile(
            thread: thread,
            selected: false,
            onTap: () => context.go(AppRoutes.outreachThread(thread.id)),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _ThreadTile(
              thread: thread,
              selected: true,
              // Tapping the open row again is not a de-select: the detail
              // panel is showing this thread, and the list is where you
              // come back to it.
              onTap: () => context.go(AppRoutes.outreachThread(thread.id)),
            ),
            ThreadMessageHistory(threadId: thread.id),
          ],
        );
      },
    );
  }
}

/// A compact "narrow to..." control above the list, for triaging replies by
/// what they said rather than reading every open thread. Picking a
/// classification is session state, same as every other list-shaping toggle
/// on this page — see [outreachClassificationFilterProvider].
class _ClassificationFilterBar extends ConsumerWidget {
  const _ClassificationFilterBar();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final current = ref.watch(outreachClassificationFilterProvider);

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      child: MenuAnchor(
        builder: (context, controller, _) => InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () =>
              controller.isOpen ? controller.close() : controller.open(),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.filter_alt_outlined,
                  size: 16,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: 6),
                Text(
                  current == null
                      ? l10n.outreachClassificationFilterAll
                      : current.label(l10n),
                  style: Theme.of(context).textTheme.labelMedium,
                ),
                const Icon(Icons.arrow_drop_down, size: 18),
              ],
            ),
          ),
        ),
        menuChildren: [
          MenuItemButton(
            trailingIcon:
                current == null ? const Icon(Icons.check, size: 16) : null,
            onPressed: () =>
                ref.read(outreachClassificationFilterProvider.notifier).set(
                      null,
                    ),
            child: Text(l10n.outreachClassificationFilterAll),
          ),
          for (final option in MessageClassification.values)
            MenuItemButton(
              trailingIcon:
                  option == current ? const Icon(Icons.check, size: 16) : null,
              onPressed: () => ref
                  .read(outreachClassificationFilterProvider.notifier)
                  .set(option),
              child: Text(option.label(l10n)),
            ),
        ],
      ),
    );
  }
}

class _ThreadTile extends ConsumerWidget {
  const _ThreadTile({
    required this.thread,
    required this.selected,
    required this.onTap,
  });

  final OutreachThread thread;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final seesNames = ref.watch(accessLevelProvider).seesSensitiveData;
    // A basic account's threads come back with no influencer id at all — the
    // server never sends one — so there is nothing to look up. Watching the
    // provider anyway would fire a query per row for a value that is known in
    // advance to be absent.
    final influencerAsync = seesNames
        ? ref.watch(influencerByIdProvider(thread.influencerId))
        : null;
    final reminder = seesNames
        ? ref.watch(openReminderByInfluencerProvider).maybeWhen(
              data: (map) => map[thread.influencerId],
              orElse: () => null,
            )
        : null;

    return ListTile(
      selected: selected,
      selectedTileColor:
          Theme.of(context).colorScheme.primary.withValues(alpha: 0.1),
      onTap: onTap,
      title: RedactableText(
        influencerAsync?.maybeWhen(
              data: (influencer) => influencer?.handle ?? thread.influencerId,
              orElse: () => thread.influencerId,
            ) ??
            kRedactionMarker,
      ),
      // The waiting-reply, scheduled-send and reminder pills sit under the
      // date rather than stacked beside the status: a two-line tile gives its
      // trailing side 56px, which three pills overflow, while the subtitle
      // grows with what it holds.
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(fmt.dateTime(thread.updatedAt)),
          Wrap(
            spacing: 6,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              _SlaIndicator(threadId: thread.id),
              ScheduledSendChip(threadId: thread.id),
              if (reminder != null) _ReminderChip(reminder: reminder),
            ],
          ),
        ],
      ),
      trailing: StatusBadge(
        label: thread.status.label(l10n),
        color: thread.status.color(context),
      ),
    );
  }
}

/// How long a thread has been sitting on an unanswered inbound message —
/// nothing shown when we are not the ones who owe a reply (no inbound
/// message yet, or we already answered the last one), colored as a warning
/// once it is inside [outreachSlaThreshold] and as an error once it isn't.
///
/// Reads [outreachSlaProvider], which derives its answer from the same
/// messages [ThreadMessageHistory] already shows under the expanded row —
/// this is the collapsed row's one-glance version of the same fact.
class _SlaIndicator extends ConsumerWidget {
  const _SlaIndicator({required this.threadId});

  final String threadId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final sla = ref.watch(outreachSlaProvider(threadId)).value;
    if (sla == null || sla.status == OutreachSlaStatus.none) {
      return const SizedBox.shrink();
    }

    final since = sla.since!;
    final elapsed = DateTime.now().difference(since);
    final label = switch (elapsed) {
      Duration(inHours: final h) when h < 1 =>
        l10n.outreachSlaMinutesShort(elapsed.inMinutes),
      Duration(inHours: final h) when h < 24 =>
        l10n.outreachSlaHoursShort(elapsed.inHours),
      _ => l10n.outreachSlaDaysShort(elapsed.inDays),
    };

    final overdue = sla.status == OutreachSlaStatus.overdue;
    final scheme = Theme.of(context).colorScheme;
    final status = Theme.of(context).extension<GratovoStatusColors>();
    final color =
        overdue ? scheme.error : (status?.warning ?? scheme.secondary);

    return Tooltip(
      message: overdue
          ? l10n.outreachSlaTooltipOverdue
          : l10n.outreachSlaTooltipWaiting,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            overdue ? Icons.report_problem_outlined : Icons.timer_outlined,
            size: 12,
            color: color,
          ),
          const SizedBox(width: 3),
          StatusBadge(label: label, color: color),
        ],
      ),
    );
  }
}

/// A small due/overdue pill for the soonest open follow-up on a thread. The
/// day count is against display-zone "now" so it matches what every other
/// timestamp on the page shows.
class _ReminderChip extends ConsumerWidget {
  const _ReminderChip({required this.reminder});

  final FollowUpReminder reminder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final status = Theme.of(context).extension<GratovoStatusColors>();
    final days = ref.watch(instantFormatterProvider).daysUntil(reminder.dueAt);

    final (String label, Color color) = switch (days) {
      < 0 => (l10n.outreachReminderOverdueByDays(-days), scheme.error),
      0 => (l10n.outreachReminderDueToday, status?.warning ?? scheme.secondary),
      _ => (
          l10n.outreachReminderDueInDays(days),
          status?.warning ?? scheme.secondary,
        ),
    };

    return StatusBadge(label: label, color: color);
  }
}
