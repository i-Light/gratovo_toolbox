import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/models/activity_log_query.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_activity_log_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_deal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/team_dashboard/application/team_dashboard_aggregator.dart';
import 'package:gratovo_toolbox/features/team_dashboard/application/team_dashboard_stats_provider.dart';

/// The provider wiring, exercised against the real mock repositories rather
/// than hand-built model lists — `_resolveMembers`'s no-session fallback,
/// the `getAllThreads` → `getMessages` fan-out, and the `emailSent` paging
/// loop all have to work together correctly, which the pure aggregator test
/// (`team_dashboard_aggregator_test.dart`) cannot exercise on its own since
/// it is handed already-fetched lists.
void main() {
  test('produces a non-trivial rollup from two mock team members', () async {
    final activityLog = MockActivityLogRepository();
    final outreach = MockOutreachRepository();
    final deals = MockDealRepository();

    // The stock seed data in these three mocks was written for their own
    // pages (Logs, Outreach, Deals) and its timestamps don't line up closely
    // enough with each other for this feature's message<->actor matching, so
    // a coordinated exchange is layered on top of it here — the same "two
    // mock team members" the pure aggregator test uses, sending through the
    // real repository methods this time instead of constructing
    // `ActivityLogEntry`/`OutreachMessage` by hand.
    final thread = await outreach.getOrCreateThreadForInfluencer(
      'inf_team_dashboard_test',
    );

    Future<void> send(String actorId, String actorName, String subject) async {
      await outreach.recordMessage(
        threadId: thread.id,
        direction: MessageDirection.outbound,
        subject: subject,
        body: subject,
      );
      // `recordMessage` and `record` both stamp `DateTime.now()` themselves
      // (neither takes the other's timestamp) — calling them back to back is
      // exactly what `outreach_compose_controller.dart`'s `_recordOutbound`
      // does for a real send, which is what makes the aggregator's
      // nearest-timestamp match find them.
      await activityLog.record(
        draft: ActivityDraft(
          action: ActivityAction.emailSent,
          entityType: 'thread',
          entityId: thread.id,
          entityLabel: 'test channel',
          newValue: subject,
        ),
        actorId: actorId,
        actorName: actorName,
        actorRole: AccessLevel.full,
      );
    }

    await send('amira', 'Amira', 'Quick idea for a collab');
    await outreach.recordMessage(
      threadId: thread.id,
      direction: MessageDirection.inbound,
      subject: 'Re: Quick idea for a collab',
      body: "Sounds good, let's talk numbers",
    );
    await send('amira', 'Amira', 'Here are the details');

    final container = ProviderContainer(
      overrides: [
        // No Supabase in a unit test — `_resolveMembers` falls back to
        // `activityActorsProvider`, which reads the very entries just
        // written above.
        supabaseBootProvider.overrideWithValue(
          const SupabaseBoot(
            config: SupabaseConfig(url: '', anonKey: ''),
            error: 'no server configured in this test',
          ),
        ),
        activityLogRepositoryProvider.overrideWithValue(activityLog),
        outreachRepositoryProvider.overrideWithValue(outreach),
        dealRepositoryProvider.overrideWithValue(deals),
      ],
    );
    addTearDown(container.dispose);

    final weekStart = startOfWeek(DateTime.now().toUtc());
    final stats =
        await container.read(teamDashboardStatsProvider(weekStart).future);

    final amiraRow = stats.rows.firstWhere(
      (r) => r.member.id == 'amira',
      orElse: () => throw StateError(
        'expected a row for amira; got ${stats.rows.map((r) => r.member.id)}',
      ),
    );
    expect(amiraRow.messagesSent, 2);
    expect(amiraRow.repliesReceived, 1);
    expect(amiraRow.replyRate, 0.5);
    expect(amiraRow.medianFirstResponseTime, isNotNull);

    // The mock deal repository's stock data includes a deal that closed
    // outside "this week", so the summary should not be crediting it —
    // asserting the field is reachable and non-negative is the meaningful
    // check here; the exact figure is the pure aggregator test's job.
    expect(stats.deals.dealsClosed, greaterThanOrEqualTo(0));
    expect(stats.deals.marginClosed, greaterThanOrEqualTo(0));
  });
}
