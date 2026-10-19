import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';

/// How long a thread can sit on an unanswered inbound message before the
/// list flags it as overdue.
///
/// Deliberately a flat wall-clock day rather than a configurable-hours or
/// business-hours system: the thread list needs "is somebody waiting too
/// long", not a rota. If that stops being good enough this is the one place
/// to change.
const outreachSlaThreshold = Duration(hours: 24);

/// Where a thread stands against [outreachSlaThreshold].
enum OutreachSlaStatus {
  /// Nothing to answer: either no message has ever arrived on the thread, or
  /// the most recent message is one of ours.
  none,

  /// The most recent message is inbound and still inside the threshold.
  waiting,

  /// The most recent message is inbound and has sat unanswered past
  /// [outreachSlaThreshold].
  overdue,
}

/// A thread's SLA reading: whether it is waiting on our reply and, when it
/// is, since when.
class OutreachSla {
  const OutreachSla(this.status, [this.since]);

  final OutreachSlaStatus status;

  /// When the unanswered inbound message arrived. Null when [status] is
  /// [OutreachSlaStatus.none].
  final DateTime? since;
}

/// Reads a thread's messages (any order) for its SLA state as of [now].
///
/// Only the most recent message matters — a thread we have since replied to
/// is not waiting on anything, however old its last inbound message was.
OutreachSla outreachSlaFor(List<OutreachMessage> messages, DateTime now) {
  if (messages.isEmpty) return const OutreachSla(OutreachSlaStatus.none);

  final last = messages.reduce((a, b) => a.at.isAfter(b.at) ? a : b);
  if (last.direction != MessageDirection.inbound) {
    return const OutreachSla(OutreachSlaStatus.none);
  }

  final waited = now.difference(last.at);
  final status = waited > outreachSlaThreshold
      ? OutreachSlaStatus.overdue
      : OutreachSlaStatus.waiting;
  return OutreachSla(status, last.at);
}

/// One thread's SLA reading, for the thread list row — recomputed whenever
/// outreach data changes, via [messagesByThreadProvider]'s own revision
/// watch.
final outreachSlaProvider =
    FutureProvider.family<OutreachSla, String>((ref, threadId) async {
  final messages = await ref.watch(messagesByThreadProvider(threadId).future);
  return outreachSlaFor(messages, DateTime.now());
});
