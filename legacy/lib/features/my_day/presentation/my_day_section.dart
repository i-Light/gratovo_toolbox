import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/theme/app_theme.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/core/widgets/status_badge.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/widgets/holo_card.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/thirty_day_report_dialog.dart';
import 'package:gratovo_toolbox/features/my_day/application/my_day_models.dart';
import 'package:gratovo_toolbox/features/my_day/application/my_day_provider.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// The "My Day" card: the signed-in person's own most time-sensitive open
/// items — payouts and invoices coming due, deliverables running late,
/// outreach threads waiting on a reply, and overdue follow-ups — in one
/// place, above the general dashboard stats.
///
/// Self-contained: reads [myDayItemsProvider] itself and renders its own
/// loading/error/empty states, the same shape as `_UpcomingRemindersCard` in
/// `dashboard_screen.dart`. That screen is a hotspot file owned centrally
/// for this wave, so this widget is not wired into it here — see this
/// feature's handback notes for the exact insertion point.
class MyDaySection extends ConsumerWidget {
  const MyDaySection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final itemsAsync = ref.watch(myDayItemsProvider);

    return HoloCard(
      builder: (context) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                holoIconBadge(Icons.wb_sunny_outlined),
                const SizedBox(width: 8),
                Text(
                  l10n.myDaySectionTitle,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ],
            ),
            const SizedBox(height: 12),
            itemsAsync.when(
              // A re-read triggered by the change bus keeps whatever is
              // already on screen rather than flashing a spinner over it
              // every time anyone anywhere edits anything — same convention
              // as `_StatTiles`/`_UpcomingRemindersCard`.
              skipLoadingOnReload: true,
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (error, stackTrace) => Row(
                children: [
                  Expanded(child: Text(l10n.myDaySectionLoadError)),
                  TextButton(
                    onPressed: () => ref.invalidate(myDayItemsProvider),
                    child: Text(l10n.commonRetry),
                  ),
                ],
              ),
              data: (items) {
                if (items.isEmpty) {
                  return Text(
                    l10n.myDaySectionEmpty,
                    style: Theme.of(context).textTheme.bodyMedium,
                  );
                }
                final overdue = [
                  for (final item in items)
                    if (item.urgency == MyDayUrgency.overdue) item,
                ];
                final dueSoon = [
                  for (final item in items)
                    if (item.urgency == MyDayUrgency.dueSoon) item,
                ];
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (overdue.isNotEmpty)
                      _MyDayGroup(
                          label: l10n.myDayGroupOverdue, items: overdue),
                    if (overdue.isNotEmpty && dueSoon.isNotEmpty)
                      const SizedBox(height: 12),
                    if (dueSoon.isNotEmpty)
                      _MyDayGroup(
                          label: l10n.myDayGroupDueSoon, items: dueSoon),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _MyDayGroup extends StatelessWidget {
  const _MyDayGroup({required this.label, required this.items});

  final String label;
  final List<MyDayItem> items;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: Theme.of(context).textTheme.labelLarge?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
        ),
        for (final item in items) _MyDayItemTile(item: item),
      ],
    );
  }
}

/// One row: icon, title/subtitle built from [item], and a due chip — tap
/// opens the deal/thread this item is about.
class _MyDayItemTile extends ConsumerWidget {
  const _MyDayItemTile({required this.item});

  final MyDayItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final influencerId = item.influencerId;
    final influencerAsync = influencerId == null
        ? null
        : ref.watch(influencerByIdProvider(influencerId));
    final influencerLabel = influencerAsync?.maybeWhen(
          data: (influencer) =>
              influencer?.name ?? influencer?.handle ?? influencerId,
          orElse: () => influencerId,
        ) ??
        influencerId ??
        '';

    final (icon, title, subtitle) = switch (item.type) {
      MyDayItemType.payoutDue => (
          Icons.payments_outlined,
          l10n.myDayPayoutDueTitle(influencerLabel),
          formatCurrency(item.amount, locale: l10n.localeName),
        ),
      MyDayItemType.invoiceUnpaid => (
          Icons.receipt_long_outlined,
          l10n.myDayInvoiceUnpaidTitle(influencerLabel),
          formatCurrency(item.amount, locale: l10n.localeName),
        ),
      MyDayItemType.deliverableDue => (
          Icons.movie_creation_outlined,
          l10n.myDayDeliverableDueTitle(
            _deliverableTypeLabel(l10n, item.deliverableType),
            influencerLabel,
          ),
          l10n.myDayDeliverableDeadline(
            ref.watch(instantFormatterProvider).date(item.anchorAt),
          ),
        ),
      MyDayItemType.outreachNeedsReply => (
          Icons.mark_email_unread_outlined,
          l10n.myDayOutreachReplyTitle(influencerLabel),
          l10n.myDayOutreachWaitingSince(
            ref.watch(instantFormatterProvider).date(item.anchorAt),
          ),
        ),
      MyDayItemType.followUpDue => (
          Icons.schedule_outlined,
          item.reminderTitle ?? '',
          _reminderKindLabel(l10n, item.reminderKind),
        ),
      MyDayItemType.reportDue => (
          Icons.insights_outlined,
          l10n.myDayReportDueTitle(influencerLabel),
          l10n.myDayReportDueOn(
            ref.watch(instantFormatterProvider).date(item.anchorAt),
          ),
        ),
    };

    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(icon),
      title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: _MyDayDueChip(anchorAt: item.anchorAt),
      onTap: () => _open(context),
    );
  }

  void _open(BuildContext context) {
    final dealId = item.dealId;
    final threadId = item.threadId;
    final influencerId = item.influencerId;
    final deliverableId = item.deliverableId;
    // A report that is due opens itself: one click from My Day to the views.
    if (item.type == MyDayItemType.reportDue &&
        dealId != null &&
        deliverableId != null) {
      showThirtyDayReport(
        context,
        dealId: dealId,
        deliverableId: deliverableId,
      );
    } else if (dealId != null) {
      context.go(AppRoutes.dealDetail(dealId));
    } else if (threadId != null) {
      context.go(AppRoutes.outreachThread(threadId));
    } else if (influencerId != null) {
      context.go(AppRoutes.outreachCompose(influencerId));
    }
  }

  static String _deliverableTypeLabel(
    AppLocalizations l10n,
    DeliverableType? type,
  ) =>
      switch (type) {
        DeliverableType.integration => l10n.myDayDeliverableTypeIntegration,
        DeliverableType.dedicated => l10n.myDayDeliverableTypeDedicated,
        DeliverableType.short => l10n.myDayDeliverableTypeShort,
        DeliverableType.communityPost => l10n.myDayDeliverableTypeCommunityPost,
        DeliverableType.other || null => l10n.myDayDeliverableTypeOther,
      };

  static String _reminderKindLabel(AppLocalizations l10n, ReminderKind? kind) =>
      switch (kind) {
        ReminderKind.followUp => l10n.myDayReminderKindFollowUp,
        ReminderKind.dealDeadline => l10n.myDayReminderKindDealDeadline,
        ReminderKind.custom || null => l10n.myDayReminderKindCustom,
      };
}

/// The overdue/due-today/due-in-N-days pill, reusing the exact wording and
/// color convention `thread_list_panel.dart`'s `_ReminderChip` already
/// established for a follow-up reminder's due date — the same "how far is
/// this from now" question, just asked about a due date in general rather
/// than only a reminder's.
class _MyDayDueChip extends ConsumerWidget {
  const _MyDayDueChip({required this.anchorAt});

  final DateTime anchorAt;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final status = Theme.of(context).extension<GratovoStatusColors>();
    final days = ref.watch(instantFormatterProvider).daysUntil(anchorAt);

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
