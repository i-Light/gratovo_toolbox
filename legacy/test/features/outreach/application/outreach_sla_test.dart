import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_sla.dart';

/// A thread's SLA reading.
///
/// The rule this suite pins: only the *most recent* message decides the
/// state. A thread with an old, unanswered inbound message buried under a
/// later outbound reply is not waiting on anything — however long ago that
/// inbound message sat unanswered.
void main() {
  final now = DateTime(2026, 1, 10, 12);

  OutreachMessage message({
    required MessageDirection direction,
    required DateTime at,
  }) {
    return OutreachMessage(
      id: 'msg',
      threadId: 'thread',
      direction: direction,
      subject: 'Subject',
      body: 'Body',
      at: at,
      method: ContactMethod.email,
    );
  }

  group('outreachSlaFor', () {
    test('no messages: nothing to answer', () {
      final sla = outreachSlaFor(const [], now);
      expect(sla.status, OutreachSlaStatus.none);
      expect(sla.since, isNull);
    });

    test('last message outbound: nothing to answer, even after an old reply',
        () {
      final messages = [
        message(
          direction: MessageDirection.inbound,
          at: now.subtract(const Duration(days: 5)),
        ),
        message(
          direction: MessageDirection.outbound,
          at: now.subtract(const Duration(hours: 1)),
        ),
      ];
      final sla = outreachSlaFor(messages, now);
      expect(sla.status, OutreachSlaStatus.none);
    });

    test('last message inbound, within the threshold: waiting', () {
      final since = now.subtract(const Duration(hours: 5));
      final sla = outreachSlaFor(
        [message(direction: MessageDirection.inbound, at: since)],
        now,
      );
      expect(sla.status, OutreachSlaStatus.waiting);
      expect(sla.since, since);
    });

    test('last message inbound, exactly at the threshold: not yet overdue', () {
      final since = now.subtract(outreachSlaThreshold);
      final sla = outreachSlaFor(
        [message(direction: MessageDirection.inbound, at: since)],
        now,
      );
      expect(sla.status, OutreachSlaStatus.waiting);
    });

    test('last message inbound, past the threshold: overdue', () {
      final since = now.subtract(const Duration(hours: 25));
      final sla = outreachSlaFor(
        [message(direction: MessageDirection.inbound, at: since)],
        now,
      );
      expect(sla.status, OutreachSlaStatus.overdue);
      expect(sla.since, since);
    });

    test('messages out of order: still goes by actual recency, not list order',
        () {
      final recent = now.subtract(const Duration(hours: 2));
      final messages = [
        message(
          direction: MessageDirection.inbound,
          at: recent,
        ),
        message(
          direction: MessageDirection.outbound,
          at: now.subtract(const Duration(days: 10)),
        ),
      ];
      final sla = outreachSlaFor(messages, now);
      expect(sla.status, OutreachSlaStatus.waiting);
      expect(sla.since, recent);
    });
  });
}
