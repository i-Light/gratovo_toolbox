import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';

/// An auto-computed working-days estimate, offered as an ASSIST alongside
/// [Deal.workingDaysEstimate] — never written to the deal automatically. See
/// [computeWorkingDaysSuggestion] for how it is derived and why the range it
/// reports may be wider than the "ideal" first-contact-to-signed window.
class WorkingDaysSuggestion {
  const WorkingDaysSuggestion({
    required this.workingDays,
    required this.from,
    required this.to,
  });

  /// Business days (Mon–Fri) elapsed between [from] and [to].
  final int workingDays;

  final DateTime from;
  final DateTime to;
}

/// Stages that imply a deal has reached at least [DealStage.agreed] at some
/// point. [DealStage.lost] is deliberately excluded: a deal can be lost
/// straight out of [DealStage.negotiating], and with no per-stage history
/// (see [computeWorkingDaysSuggestion]'s doc) there is no way to tell whether
/// a lost deal ever reached agreed at all.
const Set<DealStage> _stagesPastAgreement = {
  DealStage.agreed,
  DealStage.contractSent,
  DealStage.signed,
  DealStage.live,
  DealStage.closed,
};

/// Suggests how many working days a deal's negotiation took, for display
/// next to the manually-entered [Deal.workingDaysEstimate] — never in place
/// of it.
///
/// The ideal signal (per the owner's ask) is the first outbound message's
/// timestamp through the moment [Deal.stage] first reached `agreed` /
/// `signed` / `live`. That second timestamp does not exist anywhere in this
/// codebase today: deal stage changes are never written to `activity_log`
/// (only an influencer's shallow sourcing `pipeline_stage` is — see
/// `ActivityLogger.channelStageChanged`); [DealDetailScreen]'s stage dropdown
/// calls `DealRepository.updateStage` with no logging at all. Rather than add
/// new tracking, this falls back to [Deal.createdAt] → [Deal.updatedAt], per
/// the owner's explicit instruction — which means the reported span can be
/// wider than "first contact to signed" (it also grows on a notes edit, for
/// instance, since that bumps `updated_at` too). Callers should present this
/// plainly as a suggestion, not a fact.
///
/// [messages] gates whether outreach has actually happened yet — a deal that
/// reached `agreed` with no recorded outbound message (e.g. seed/test data,
/// or a deal fast-tracked outside the normal flow) has no outreach signal to
/// suggest from, so this returns null rather than a guess.
///
/// Returns null — "show nothing" — when: the deal has not reached at least
/// `agreed` yet, no outbound message has been recorded on its thread, or the
/// computed span is zero working days.
WorkingDaysSuggestion? computeWorkingDaysSuggestion({
  required Deal deal,
  required List<OutreachMessage> messages,
}) {
  if (!_stagesPastAgreement.contains(deal.stage)) return null;

  final hasOutbound =
      messages.any((m) => m.direction == MessageDirection.outbound);
  if (!hasOutbound) return null;

  final from = deal.createdAt;
  final to = deal.updatedAt;
  final days = businessDaysBetween(from, to);
  if (days <= 0) return null;

  return WorkingDaysSuggestion(workingDays: days, from: from, to: to);
}

/// Counts business days (Monday–Friday) strictly after [start]'s calendar
/// date, up to and including [end]'s calendar date. Time-of-day and time
/// zone on [start]/[end] are ignored — only the wall-calendar date matters,
/// the same convention [formatCalendarDate] documents for calendar dates.
///
/// `businessDaysBetween(x, x)` is 0: a deal cannot take zero-or-more working
/// days from the same instant to itself in any useful sense. Returns 0 if
/// [end] is not after [start], including when [end] is before it.
int businessDaysBetween(DateTime start, DateTime end) {
  final startDate = DateTime(start.year, start.month, start.day);
  final endDate = DateTime(end.year, end.month, end.day);
  if (!endDate.isAfter(startDate)) return 0;

  var count = 0;
  var cursor = startDate.add(const Duration(days: 1));
  while (!cursor.isAfter(endDate)) {
    if (cursor.weekday != DateTime.saturday &&
        cursor.weekday != DateTime.sunday) {
      count++;
    }
    cursor = cursor.add(const Duration(days: 1));
  }
  return count;
}
