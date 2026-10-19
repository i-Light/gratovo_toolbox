import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/features/my_day/application/my_day_models.dart';

/// The pure rollup at the heart of "My Day" — every item on the section is
/// computed here, from rows that already exist, and nothing is written back
/// anywhere. Mirrors `team_dashboard_aggregator.dart`'s
/// `computeTeamDashboardStats`: a plain function over already-fetched lists,
/// so it's trivially unit-testable and never itself touches a repository.
///
/// ## The four sources, and what "time-sensitive" means for each
///
/// * **Payout due** — [Deal.creatorPayoutDueAt] is set,
///   [Deal.creatorPayoutPaidAt] is not, and the due date falls inside
///   `[now, now + soonWindow]` or has already passed.
/// * **Invoice unpaid** — [Deal.brandInvoiceSentAt] is set and
///   [Deal.brandInvoicePaidAt] is not. Unlike a payout, an unpaid invoice has
///   no due date of its own to compare against `soonWindow` — nobody entered
///   one — so every open invoice is surfaced, and [invoiceOverdueAfter]
///   (measured from [Deal.brandInvoiceSentAt]) decides whether it reads as
///   overdue or merely due-soon. That threshold is a judgment call, not a
///   stored business rule; callers with a different sense of "an invoice has
///   been outstanding too long" pass their own.
/// * **Deliverable due** — a [Deliverable] whose [Deliverable.status] is not
///   [DeliverableStatus.published], on a deal whose [Deal.deadline] falls
///   inside the soon window or has passed. [Deliverable] itself carries no
///   due date of its own (see its doc comment: `agreedDate` is when it was
///   *agreed*, not when it's due) — the deal's deadline is the closest
///   honest proxy the data has for "when does this content need to be out."
/// * **Outreach needs reply** — an [OutreachThread] whose most recent
///   message (by [OutreachMessage.at]) is inbound. There is no `soonWindow`
///   gate here: a thread waiting on a reply is time-sensitive from the
///   moment it starts waiting, not from some point in the future.
///   [replyOverdueAfter] (measured from that inbound message) decides
///   overdue vs. due-soon, the same judgment-call shape as
///   [invoiceOverdueAfter].
/// * **Follow-up due** — an open [FollowUpReminder] (the same rows the
///   existing Dashboard's "upcoming outreach" stat reads via
///   `ReminderRepository.getUpcoming()`) whose [FollowUpReminder.dueAt]
///   falls inside the soon window or has passed. This reuses that model and
///   repository outright rather than inventing a second "thing to follow up
///   on" concept — see the model's own doc comment.
///
/// ## Ownership
///
/// [FollowUpReminder] carries no owner field of its own. Its ownership is
/// resolved through whatever it's linked to: [FollowUpReminder.dealId]'s
/// deal owner if set, otherwise the thread owner for
/// [FollowUpReminder.influencerId] (via [threads], keyed by influencer — see
/// [OutreachRepository.getOrCreateThreadForInfluencer]'s "at most one thread
/// per influencer" guarantee), otherwise unassigned. Every other item type
/// reads its owner straight off the row it came from.
///
/// [currentUserId] null (no signed-in profile) is treated as "show only
/// unassigned items" rather than "show everything" — a machine with no
/// session has no identity to claim someone else's items under.
///
/// ## Sort order
///
/// Overdue items first (oldest [MyDayItem.anchorAt] first — the most
/// overdue thing leads), then due-soon items (soonest [MyDayItem.anchorAt]
/// first).
List<MyDayItem> computeMyDayItems({
  required String? currentUserId,
  required List<Deal> deals,
  required List<Deliverable> deliverables,
  required List<OutreachThread> threads,
  required List<OutreachMessage> messages,
  required List<FollowUpReminder> reminders,
  required DateTime now,
  Duration soonWindow = const Duration(days: 3),
  Duration invoiceOverdueAfter = const Duration(days: 14),
  Duration replyOverdueAfter = const Duration(days: 2),
}) {
  final soonCutoff = now.add(soonWindow);
  bool isMine(String? ownerId) =>
      ownerId == null || (currentUserId != null && ownerId == currentUserId);
  MyDayUrgency urgencyFor(DateTime anchor) =>
      anchor.isBefore(now) ? MyDayUrgency.overdue : MyDayUrgency.dueSoon;

  final dealsById = <String, Deal>{for (final d in deals) d.id: d};
  final threadsByInfluencer = <String, OutreachThread>{
    for (final t in threads) t.influencerId: t,
  };

  final items = <MyDayItem>[];

  // --- 1. Deal payments: payout due, invoice unpaid --------------------

  for (final deal in deals) {
    if (!isMine(deal.ownerId)) continue;

    final payoutDue = deal.creatorPayoutDueAt;
    if (payoutDue != null &&
        deal.creatorPayoutPaidAt == null &&
        !payoutDue.isAfter(soonCutoff)) {
      items.add(MyDayItem(
        id: 'payout_${deal.id}',
        type: MyDayItemType.payoutDue,
        urgency: urgencyFor(payoutDue),
        anchorAt: payoutDue,
        ownerId: deal.ownerId,
        dealId: deal.id,
        influencerId: deal.influencerId,
        amount: deal.influencerPayout,
        currency: deal.currency,
      ));
    }

    final invoiceSent = deal.brandInvoiceSentAt;
    if (invoiceSent != null && deal.brandInvoicePaidAt == null) {
      final overdue = now.difference(invoiceSent) >= invoiceOverdueAfter;
      items.add(MyDayItem(
        id: 'invoice_${deal.id}',
        type: MyDayItemType.invoiceUnpaid,
        urgency: overdue ? MyDayUrgency.overdue : MyDayUrgency.dueSoon,
        anchorAt: invoiceSent,
        ownerId: deal.ownerId,
        dealId: deal.id,
        influencerId: deal.influencerId,
        amount: deal.brandPrice,
        currency: deal.currency,
      ));
    }
  }

  // --- 2. Deliverables not yet published, on a deal whose deadline is ---
  // --- coming up or has passed -------------------------------------------

  for (final deliverable in deliverables) {
    if (deliverable.status == DeliverableStatus.published) continue;
    final deal = dealsById[deliverable.dealId];
    if (deal == null || !isMine(deal.ownerId)) continue;
    final deadline = deal.deadline;
    if (deadline == null || deadline.isAfter(soonCutoff)) continue;

    items.add(MyDayItem(
      id: 'deliverable_${deliverable.id}',
      type: MyDayItemType.deliverableDue,
      urgency: urgencyFor(deadline),
      anchorAt: deadline,
      ownerId: deal.ownerId,
      dealId: deal.id,
      influencerId: deal.influencerId,
      deliverableType: deliverable.type,
    ));
  }

  // --- 2b. 30-day reports due ---------------------------------------------
  // Asked for from the day it is due, not before: views taken early are not
  // 30-day views. Due soon for the soon window after that, then overdue.

  for (final deliverable in deliverables) {
    if (!deliverable.isPublished || deliverable.hasReport) continue;
    final due = deliverable.reportDueAt;
    if (due == null || due.isAfter(now)) continue;
    final deal = dealsById[deliverable.dealId];
    if (deal == null || !isMine(deal.ownerId)) continue;

    items.add(MyDayItem(
      id: 'report_${deliverable.id}',
      type: MyDayItemType.reportDue,
      urgency: now.difference(due) > soonWindow
          ? MyDayUrgency.overdue
          : MyDayUrgency.dueSoon,
      anchorAt: due,
      ownerId: deal.ownerId,
      dealId: deal.id,
      influencerId: deal.influencerId,
      deliverableType: deliverable.type,
      deliverableId: deliverable.id,
    ));
  }

  // --- 3. Outreach threads awaiting a reply ------------------------------

  final messagesByThread = <String, List<OutreachMessage>>{};
  for (final message in messages) {
    (messagesByThread[message.threadId] ??= []).add(message);
  }
  for (final list in messagesByThread.values) {
    list.sort((a, b) => a.at.compareTo(b.at));
  }

  for (final thread in threads) {
    if (!isMine(thread.ownerId)) continue;
    final threadMessages = messagesByThread[thread.id];
    if (threadMessages == null || threadMessages.isEmpty) continue;
    final last = threadMessages.last;
    if (last.direction != MessageDirection.inbound) continue;

    final overdue = now.difference(last.at) >= replyOverdueAfter;
    items.add(MyDayItem(
      id: 'thread_${thread.id}',
      type: MyDayItemType.outreachNeedsReply,
      urgency: overdue ? MyDayUrgency.overdue : MyDayUrgency.dueSoon,
      anchorAt: last.at,
      ownerId: thread.ownerId,
      threadId: thread.id,
      influencerId: thread.influencerId,
    ));
  }

  // --- 4. Open follow-up reminders ---------------------------------------

  for (final reminder in reminders) {
    if (reminder.isDone || reminder.dueAt.isAfter(soonCutoff)) continue;

    final linkedDealOwner =
        reminder.dealId == null ? null : dealsById[reminder.dealId]?.ownerId;
    final linkedThreadOwner = reminder.influencerId == null
        ? null
        : threadsByInfluencer[reminder.influencerId]?.ownerId;
    final resolvedOwner = linkedDealOwner ?? linkedThreadOwner;
    if (!isMine(resolvedOwner)) continue;

    items.add(MyDayItem(
      id: 'reminder_${reminder.id}',
      type: MyDayItemType.followUpDue,
      urgency: urgencyFor(reminder.dueAt),
      anchorAt: reminder.dueAt,
      ownerId: resolvedOwner,
      dealId: reminder.dealId,
      influencerId: reminder.influencerId,
      reminderTitle: reminder.title,
      reminderKind: reminder.kind,
    ));
  }

  items.sort((a, b) {
    final urgencyCompare = a.urgency.index.compareTo(b.urgency.index);
    if (urgencyCompare != 0) return urgencyCompare;
    return a.anchorAt.compareTo(b.anchorAt);
  });

  return items;
}
