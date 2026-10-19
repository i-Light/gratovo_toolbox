import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';

/// What kind of time-sensitive thing a [MyDayItem] is surfacing. Mirrors the
/// four sources `computeMyDayItems` reads — see that function's doc comment
/// for exactly what makes a row of each kind appear.
enum MyDayItemType {
  /// [Deal.creatorPayoutDueAt] is coming due or has passed, and
  /// [Deal.creatorPayoutPaidAt] is still unset.
  payoutDue,

  /// The brand was invoiced ([Deal.brandInvoiceSentAt] is set) but the
  /// invoice hasn't been marked paid yet ([Deal.brandInvoicePaidAt] is null).
  invoiceUnpaid,

  /// A [Deliverable] that isn't published yet, on a deal whose own
  /// [Deal.deadline] is coming up or has passed — see the aggregator's doc
  /// comment for why the deal's deadline stands in for a per-deliverable one.
  deliverableDue,

  /// An [OutreachThread] whose most recent message is inbound — nobody has
  /// replied since.
  outreachNeedsReply,

  /// An open [FollowUpReminder] that is due soon or overdue.
  followUpDue,

  /// A published [Deliverable] whose 30-day report is due (30 days after
  /// [Deliverable.publishedAt]) and has not been taken yet.
  reportDue,
}

/// How pressing a [MyDayItem] is, relative to the moment `computeMyDayItems`
/// was asked to treat as "now".
enum MyDayUrgency {
  /// Already past [MyDayItem.anchorAt].
  overdue,

  /// Not overdue yet, but inside the "soon" window the aggregator was asked
  /// to use.
  dueSoon,
}

/// One time-sensitive open item, ready for `MyDaySection` to render.
///
/// Nothing here is stored — every field is derived fresh from Deal/
/// Deliverable/OutreachThread/OutreachMessage/FollowUpReminder rows each time
/// `computeMyDayItems` runs, the same "no second copy of the truth" spirit as
/// `TeamDashboardRow`. Deliberately carries raw ids rather than resolved
/// names: looking up an influencer by id is a per-row provider watch
/// (`influencerByIdProvider`) at render time, not something this pure
/// function should do — see that provider's doc comment on why the app
/// stopped fetching influencers in bulk.
class MyDayItem {
  const MyDayItem({
    required this.id,
    required this.type,
    required this.urgency,
    required this.anchorAt,
    required this.ownerId,
    this.dealId,
    this.influencerId,
    this.threadId,
    this.amount,
    this.currency,
    this.deliverableType,
    this.deliverableId,
    this.reminderTitle,
    this.reminderKind,
  });

  /// Unique within one aggregator run — stable per underlying row, so a
  /// widget can key a list tile on it (e.g. `'payout_${deal.id}'`,
  /// `'thread_${thread.id}'`).
  final String id;

  final MyDayItemType type;
  final MyDayUrgency urgency;

  /// The one instant that explains why this item is here and how it's
  /// sorted: the payout due date, the invoice-sent date, the deal's
  /// deadline, the last inbound message's time, or the reminder's due date,
  /// depending on [type]. Not always literally a "due" date — an unpaid
  /// invoice has none of its own — see `computeMyDayItems`'s doc comment.
  final DateTime anchorAt;

  /// Who this item is filtered against: the deal's or thread's own
  /// [Deal.ownerId]/[OutreachThread.ownerId], or — for a follow-up reminder,
  /// which carries no owner field of its own — whichever the reminder's
  /// linked deal or thread resolves to. Null means unassigned.
  final String? ownerId;

  final String? dealId;
  final String? influencerId;
  final String? threadId;

  /// Set for [MyDayItemType.payoutDue] (the influencer payout) and
  /// [MyDayItemType.invoiceUnpaid] (the brand price), in [currency].
  final double? amount;
  final String? currency;

  /// Set for [MyDayItemType.deliverableDue] and [MyDayItemType.reportDue].
  final DeliverableType? deliverableType;

  /// Set for [MyDayItemType.reportDue]: which deliverable's report.
  final String? deliverableId;

  /// Set for [MyDayItemType.followUpDue] — [FollowUpReminder.title] and
  /// [FollowUpReminder.kind]. [reminderTitle] is free text a person typed
  /// in, not a localization key.
  final String? reminderTitle;
  final ReminderKind? reminderKind;
}
