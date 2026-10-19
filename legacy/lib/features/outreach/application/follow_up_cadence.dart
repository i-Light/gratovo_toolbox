import 'package:gratovo_toolbox/data/models/outreach_message.dart';

/// When the next follow-up is due, from the owner's house choices
/// (`data/comms/playbook/house_choices.json`, answered 2026-10-18).
///
/// - Creators (HC-12, INF-FU-01): one working day after a first email that got
///   no reply, two working days after a stalled exchange and between later
///   follow-ups.
/// - Brands (HC-24, BRD-FU-15): two working days, then three, then a week.
/// - Never on a weekend; a message sent on a weekend lets a working day pass
///   first (INF-FU-01).
/// - At most three follow-ups, where HC-01 (2-3 touches) and HC-17 (3-4) meet;
///   then wait and start a new thread with a new angle (INF-FU-04).
///
/// This only times a reminder. Nothing is sent by it: the follow-up itself is
/// written and approved by a person when it is due.
const int kMaxFollowUps = 3;

/// The next follow-up after the latest outbound message, or null when none is
/// due (they replied last, or [kMaxFollowUps] have already gone out).
class NextFollowUp {
  const NextFollowUp({required this.number, required this.dueAt});

  /// 1 for the first follow-up after the opening message.
  final int number;

  /// Local wall-clock time it is due.
  final DateTime dueAt;
}

/// [from] plus [days] working days (Monday to Friday), keeping the time of
/// day. Starting on a weekend, the count begins on Monday, so the first day
/// that counts is a whole working day.
DateTime addWorkingDays(DateTime from, int days) {
  var day = from;
  if (_isWeekend(day)) {
    while (_isWeekend(day)) {
      day = day.add(const Duration(days: 1));
    }
  }
  var left = days;
  while (left > 0) {
    day = day.add(const Duration(days: 1));
    if (!_isWeekend(day)) left--;
  }
  return day;
}

bool _isWeekend(DateTime d) =>
    d.weekday == DateTime.saturday || d.weekday == DateTime.sunday;

/// How many working days after the latest message follow-up [number] is due.
int followUpGapDays({
  required int number,
  required bool toBrand,
  required bool afterExchange,
}) {
  if (toBrand) {
    return switch (number) { 1 => 2, 2 => 3, _ => 5 };
  }
  return (number == 1 && !afterExchange) ? 1 : 2;
}

/// The next follow-up for a thread whose messages are [messages] (any order).
///
/// Counts the outbound messages since their last inbound one: the first of
/// them is the message being chased, the rest are follow-ups already sent.
NextFollowUp? nextFollowUp(
  List<OutreachMessage> messages, {
  bool toBrand = false,
}) {
  if (messages.isEmpty) return null;
  final ordered = [...messages]..sort((a, b) => a.at.compareTo(b.at));
  final last = ordered.last;
  if (last.direction != MessageDirection.outbound) return null;

  var trailingOutbound = 0;
  var sawInbound = false;
  for (final message in ordered.reversed) {
    if (message.direction == MessageDirection.outbound) {
      trailingOutbound++;
    } else {
      sawInbound = true;
      break;
    }
  }
  final sent = trailingOutbound - 1;
  if (sent >= kMaxFollowUps) return null;
  final number = sent + 1;
  final gap = followUpGapDays(
    number: number,
    toBrand: toBrand,
    afterExchange: sawInbound,
  );
  return NextFollowUp(
    number: number,
    dueAt: addWorkingDays(last.at.toLocal(), gap),
  );
}

/// Follow-ups already sent since their last reply, for a thread whose messages
/// are [messages]: 0 right after the opening message.
int followUpsSent(List<OutreachMessage> messages) {
  final ordered = [...messages]..sort((a, b) => a.at.compareTo(b.at));
  var trailingOutbound = 0;
  for (final message in ordered.reversed) {
    if (message.direction != MessageDirection.outbound) break;
    trailingOutbound++;
  }
  return trailingOutbound == 0 ? 0 : trailingOutbound - 1;
}
