import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/features/team_dashboard/application/team_dashboard_aggregator.dart';
import 'package:gratovo_toolbox/features/team_dashboard/application/team_dashboard_models.dart';

/// Two mock team members — Amira and Omar, the same personas
/// `MockActivityLogRepository`/`MockOutreachRepository` already use — plus
/// Sara, who has no activity at all this week, seeded across three threads
/// so the rollup math has more than one number to get right at once.
void main() {
  // A fixed Monday, derived rather than guessed, so a slipped weekday
  // constant can never silently make the fixture wrong.
  final weekStart = startOfWeek(DateTime.utc(2026, 9, 16));
  const amira = TeamDashboardMember(id: 'amira', name: 'Amira');
  const omar = TeamDashboardMember(id: 'omar', name: 'Omar');
  const sara = TeamDashboardMember(id: 'sara', name: 'Sara');

  ActivityLogEntry emailSent({
    required String id,
    required String threadId,
    required String actorId,
    required String actorName,
    required DateTime at,
  }) =>
      ActivityLogEntry(
        id: id,
        at: at,
        actorId: actorId,
        actorName: actorName,
        actorRole: AccessLevel.full,
        action: ActivityAction.emailSent,
        entityType: 'thread',
        entityId: threadId,
      );

  OutreachMessage message({
    required String id,
    required String threadId,
    required MessageDirection direction,
    required DateTime at,
  }) =>
      OutreachMessage(
        id: id,
        threadId: threadId,
        direction: direction,
        subject: 'subject',
        body: 'body',
        at: at,
      );

  group('computeTeamDashboardStats', () {
    test('rolls up messages sent, replies and response time per member', () {
      final messages = <OutreachMessage>[
        // thread_1 (Amira): a message sent just before the week starts must
        // not count — the week boundary is exercised here.
        message(
          id: 'm0',
          threadId: 'thread_1',
          direction: MessageDirection.outbound,
          at: weekStart.subtract(const Duration(days: 1)),
        ),
        // thread_1: outbound -> inbound reply -> outbound response.
        message(
          id: 'm1',
          threadId: 'thread_1',
          direction: MessageDirection.outbound,
          at: weekStart.add(const Duration(days: 1, hours: 9)),
        ),
        message(
          id: 'm2',
          threadId: 'thread_1',
          direction: MessageDirection.inbound,
          at: weekStart.add(const Duration(days: 1, hours: 15)),
        ),
        message(
          id: 'm3',
          threadId: 'thread_1',
          direction: MessageDirection.outbound,
          at: weekStart.add(const Duration(days: 2, hours: 10)),
        ),

        // thread_2 (Omar): two full reply/response cycles.
        message(
          id: 'm4',
          threadId: 'thread_2',
          direction: MessageDirection.outbound,
          at: weekStart.add(const Duration(days: 1, hours: 8)),
        ),
        message(
          id: 'm5',
          threadId: 'thread_2',
          direction: MessageDirection.inbound,
          at: weekStart.add(const Duration(days: 3, hours: 8)),
        ),
        message(
          id: 'm6',
          threadId: 'thread_2',
          direction: MessageDirection.outbound,
          at: weekStart.add(const Duration(days: 3, hours: 9, minutes: 30)),
        ),
        message(
          id: 'm7',
          threadId: 'thread_2',
          direction: MessageDirection.inbound,
          at: weekStart.add(const Duration(days: 4, hours: 8)),
        ),
        message(
          id: 'm8',
          threadId: 'thread_2',
          direction: MessageDirection.outbound,
          at: weekStart.add(const Duration(days: 4, hours: 12)),
        ),

        // thread_3: an automated follow-up send with no matching
        // `emailSent` log entry — nobody clicked it, so it must not be
        // attributed to anyone, and the reply that follows it must not be
        // credited to anyone either.
        message(
          id: 'm9',
          threadId: 'thread_3',
          direction: MessageDirection.outbound,
          at: weekStart.add(const Duration(days: 1)),
        ),
        message(
          id: 'm10',
          threadId: 'thread_3',
          direction: MessageDirection.inbound,
          at: weekStart.add(const Duration(days: 2)),
        ),
      ];

      final emailSentLog = <ActivityLogEntry>[
        emailSent(
          id: 'l0',
          threadId: 'thread_1',
          actorId: 'amira',
          actorName: 'Amira',
          at: weekStart.subtract(const Duration(days: 1)).add(
                const Duration(seconds: 4),
              ),
        ),
        emailSent(
          id: 'l1',
          threadId: 'thread_1',
          actorId: 'amira',
          actorName: 'Amira',
          at: weekStart
              .add(const Duration(days: 1, hours: 9))
              .add(const Duration(seconds: 5)),
        ),
        emailSent(
          id: 'l3',
          threadId: 'thread_1',
          actorId: 'amira',
          actorName: 'Amira',
          at: weekStart
              .add(const Duration(days: 2, hours: 10))
              .add(const Duration(seconds: 3)),
        ),
        emailSent(
          id: 'l4',
          threadId: 'thread_2',
          actorId: 'omar',
          actorName: 'Omar',
          at: weekStart
              .add(const Duration(days: 1, hours: 8))
              .add(const Duration(seconds: 2)),
        ),
        emailSent(
          id: 'l6',
          threadId: 'thread_2',
          actorId: 'omar',
          actorName: 'Omar',
          at: weekStart
              .add(const Duration(days: 3, hours: 9, minutes: 30))
              .add(const Duration(seconds: 1)),
        ),
        emailSent(
          id: 'l8',
          threadId: 'thread_2',
          actorId: 'omar',
          actorName: 'Omar',
          at: weekStart.add(const Duration(days: 4, hours: 12)),
        ),
      ];

      final deals = <Deal>[
        Deal(
          id: 'deal_closed_1',
          brandId: 'brand_1',
          influencerId: 'inf_1',
          stage: DealStage.closed,
          brandPrice: 3000,
          influencerPayout: 2000,
          createdAt: weekStart.subtract(const Duration(days: 20)),
          updatedAt: weekStart.add(const Duration(days: 2)),
        ),
        Deal(
          id: 'deal_closed_2',
          brandId: 'brand_2',
          influencerId: 'inf_2',
          stage: DealStage.closed,
          brandPrice: 1500,
          influencerPayout: 1000,
          createdAt: weekStart.subtract(const Duration(days: 40)),
          updatedAt: weekStart.add(const Duration(days: 5)),
        ),
        // Closed, but not this week — must not be counted.
        Deal(
          id: 'deal_closed_old',
          brandId: 'brand_3',
          influencerId: 'inf_3',
          stage: DealStage.closed,
          brandPrice: 9000,
          influencerPayout: 1,
          createdAt: weekStart.subtract(const Duration(days: 60)),
          updatedAt: weekStart.subtract(const Duration(days: 10)),
        ),
        // Touched this week, but not closed — must not be counted.
        Deal(
          id: 'deal_negotiating',
          brandId: 'brand_1',
          influencerId: 'inf_4',
          stage: DealStage.negotiating,
          brandPrice: 5000,
          influencerPayout: 3000,
          createdAt: weekStart.subtract(const Duration(days: 5)),
          updatedAt: weekStart.add(const Duration(days: 1)),
        ),
      ];

      final stats = computeTeamDashboardStats(
        members: [amira, omar, sara],
        messages: messages,
        emailSentLog: emailSentLog,
        deals: deals,
        weekStart: weekStart,
      );

      expect(stats.weekStart, weekStart);
      expect(stats.rows, hasLength(3));

      final amiraRow = stats.rows.firstWhere((r) => r.member.id == 'amira');
      // m0 falls before the week and must not count; m1 and m3 do.
      expect(amiraRow.messagesSent, 2);
      // m1 (outbound) -> m2 (inbound, in week) credits one reply.
      expect(amiraRow.repliesReceived, 1);
      expect(amiraRow.replyRate, 0.5);
      // m2 -> m3 is the only timed response: 19 hours.
      expect(
        amiraRow.medianFirstResponseTime,
        const Duration(hours: 19),
      );

      final omarRow = stats.rows.firstWhere((r) => r.member.id == 'omar');
      expect(omarRow.messagesSent, 3); // m4, m6, m8
      expect(omarRow.repliesReceived, 2); // m5 and m7
      expect(omarRow.replyRate, closeTo(2 / 3, 1e-9));
      // Response times: m5->m6 = 1h30m, m7->m8 = 4h. Median of two is their
      // average: 2h45m.
      expect(
        omarRow.medianFirstResponseTime,
        const Duration(hours: 2, minutes: 45),
      );

      // Sara has no activity this week but still gets a row.
      final saraRow = stats.rows.firstWhere((r) => r.member.id == 'sara');
      expect(saraRow.messagesSent, 0);
      expect(saraRow.repliesReceived, 0);
      expect(saraRow.replyRate, isNull);
      expect(saraRow.medianFirstResponseTime, isNull);

      // Rows come back sorted by name by default: Amira, Omar, Sara.
      expect(
        stats.rows.map((r) => r.member.name),
        ['Amira', 'Omar', 'Sara'],
      );

      // thread_3's auto-sent follow-up (m9) has no matching log entry, so
      // nobody is credited for it or for the reply that follows it (m10) —
      // no row anywhere absorbed that traffic.
      final totalMessagesSent =
          stats.rows.fold<int>(0, (sum, r) => sum + r.messagesSent);
      final totalReplies =
          stats.rows.fold<int>(0, (sum, r) => sum + r.repliesReceived);
      expect(totalMessagesSent, 2 + 3); // amira + omar, m9 excluded
      expect(totalReplies, 1 + 2); // m10 excluded

      expect(stats.deals.dealsClosed, 2);
      expect(stats.deals.marginClosed, 1000 + 500);
    });

    test('recovers a roster member missing from the passed-in list', () {
      // Simulates the degraded case: `teamMembersProvider` came back empty
      // (no Supabase session) and the actor list had to stand in for the
      // roster on its own.
      final messages = [
        message(
          id: 'm1',
          threadId: 'thread_1',
          direction: MessageDirection.outbound,
          at: weekStart.add(const Duration(hours: 1)),
        ),
      ];
      final emailSentLog = [
        emailSent(
          id: 'l1',
          threadId: 'thread_1',
          actorId: 'unlisted',
          actorName: 'Unlisted Teammate',
          at: weekStart.add(const Duration(hours: 1, seconds: 1)),
        ),
      ];

      final stats = computeTeamDashboardStats(
        members: const [],
        messages: messages,
        emailSentLog: emailSentLog,
        deals: const [],
        weekStart: weekStart,
      );

      expect(stats.rows, hasLength(1));
      expect(stats.rows.single.member.name, 'Unlisted Teammate');
      expect(stats.rows.single.messagesSent, 1);
    });

    test('leaves an outbound message unattributed past the match tolerance',
        () {
      final messages = [
        message(
          id: 'm1',
          threadId: 'thread_1',
          direction: MessageDirection.outbound,
          at: weekStart.add(const Duration(hours: 1)),
        ),
      ];
      final emailSentLog = [
        // 20 minutes away — outside the default 10-minute tolerance.
        emailSent(
          id: 'l1',
          threadId: 'thread_1',
          actorId: 'amira',
          actorName: 'Amira',
          at: weekStart.add(const Duration(hours: 1, minutes: 20)),
        ),
      ];

      final stats = computeTeamDashboardStats(
        members: [amira],
        messages: messages,
        emailSentLog: emailSentLog,
        deals: const [],
        weekStart: weekStart,
      );

      expect(stats.rows.single.messagesSent, 0);
    });
  });

  group('startOfWeek', () {
    test('walks any day back to that week\'s Monday 00:00', () {
      final monday = startOfWeek(DateTime.utc(2026, 9, 16));
      expect(monday, DateTime.utc(2026, 9, 14));

      final sunday = startOfWeek(DateTime.utc(2026, 9, 20, 23, 59));
      expect(sunday, DateTime.utc(2026, 9, 14));

      // Already a Monday, mid-day — stays put at that day's midnight.
      final alreadyMonday = startOfWeek(DateTime.utc(2026, 9, 14, 13));
      expect(alreadyMonday, DateTime.utc(2026, 9, 14));
    });

    test('always returns a UTC-flagged instant, never local', () {
      // Regression guard for a real bug caught during development: the
      // first version read year/month/day off a UTC input but rebuilt the
      // result with the local-zone `DateTime.new` constructor, which
      // silently reinterprets those same numbers as local midnight —
      // shifting every boundary by whatever offset the host machine happens
      // to be running in, and passing this exact `==` comparison anyway on
      // a UTC+0 machine (Dart's `DateTime.==` ignores `isUtc`, so only the
      // `.isUtc` flag itself — not the earlier date-value assertions above
      // — can catch this on every machine, including this one).
      expect(startOfWeek(DateTime.utc(2026, 9, 16)).isUtc, isTrue);
      // A caller that forgets `.toUtc()` before calling in must still get a
      // safe, UTC-anchored result back rather than a mislabeled local one.
      expect(startOfWeek(DateTime(2026, 9, 16, 12)).isUtc, isTrue);
    });
  });
}
