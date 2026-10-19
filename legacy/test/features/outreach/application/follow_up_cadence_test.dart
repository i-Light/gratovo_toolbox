import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/features/outreach/application/follow_up_cadence.dart';

/// Follow-up timing from the owner's house choices (2026-10-18): HC-12 for
/// creators, HC-24 for brands, never on a weekend (INF-FU-01), three at most
/// (HC-01 meets HC-17).

OutreachMessage _msg(MessageDirection direction, DateTime at) =>
    OutreachMessage(
      id: '${direction.name}-${at.toIso8601String()}',
      threadId: 't',
      direction: direction,
      subject: '',
      body: '',
      at: at,
    );

const _out = MessageDirection.outbound;
const _in = MessageDirection.inbound;

void main() {
  group('addWorkingDays', () {
    test('skips the weekend and keeps the time of day', () {
      final friday = DateTime(2026, 10, 16, 15, 30);
      expect(addWorkingDays(friday, 1), DateTime(2026, 10, 19, 15, 30));
      expect(addWorkingDays(DateTime(2026, 10, 14, 9), 2),
          DateTime(2026, 10, 16, 9)); // Wednesday + 2 = Friday
    });

    test('from a weekend, a whole working day passes first', () {
      final saturday = DateTime(2026, 10, 17, 11);
      expect(addWorkingDays(saturday, 1), DateTime(2026, 10, 20, 11)); // Tue
    });
  });

  group('nextFollowUp', () {
    final monday = DateTime(2026, 10, 12, 10);

    test('a creator gets the first one a working day after a first email', () {
      final next = nextFollowUp([_msg(_out, monday)])!;
      expect(next.number, 1);
      expect(next.dueAt, DateTime(2026, 10, 13, 10));
    });

    test('after a stalled exchange, and between later ones, two working days',
        () {
      final afterReply = nextFollowUp([
        _msg(_out, monday),
        _msg(_in, monday.add(const Duration(hours: 2))),
        _msg(_out, monday.add(const Duration(hours: 3))),
      ])!;
      expect(afterReply.number, 1);
      expect(afterReply.dueAt, DateTime(2026, 10, 14, 13));

      final second = nextFollowUp([
        _msg(_out, monday),
        _msg(_out, DateTime(2026, 10, 13, 10)),
      ])!;
      expect(second.number, 2);
      expect(second.dueAt, DateTime(2026, 10, 15, 10));
    });

    test('a brand gets two working days, then three, then a week', () {
      expect(nextFollowUp([_msg(_out, monday)], toBrand: true)!.dueAt,
          DateTime(2026, 10, 14, 10));
      expect(
          nextFollowUp([_msg(_out, monday), _msg(_out, monday)], toBrand: true)!
              .dueAt,
          DateTime(2026, 10, 15, 10));
      expect(
          nextFollowUp(
            [_msg(_out, monday), _msg(_out, monday), _msg(_out, monday)],
            toBrand: true,
          )!
              .dueAt,
          DateTime(2026, 10, 19, 10));
    });

    test('nothing after three follow-ups, or when they wrote last', () {
      expect(
        nextFollowUp([for (var i = 0; i < 4; i++) _msg(_out, monday)]),
        isNull,
      );
      expect(nextFollowUp([_msg(_out, monday), _msg(_in, monday)]), isNull);
      expect(nextFollowUp(const []), isNull);
    });
  });

  test('followUpsSent counts the outbound messages after the first', () {
    final t0 = DateTime.utc(2026, 10, 12);
    expect(followUpsSent([_msg(_out, t0)]), 0);
    expect(followUpsSent([_msg(_out, t0), _msg(_out, t0), _msg(_out, t0)]), 2);
    expect(followUpsSent([_msg(_out, t0), _msg(_in, t0)]), 0);
  });
}
