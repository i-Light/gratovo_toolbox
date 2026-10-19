import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/models/activity_log_query.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/team_dashboard/application/team_dashboard_aggregator.dart';
import 'package:gratovo_toolbox/features/team_dashboard/application/team_dashboard_models.dart';

/// Which week the screen is showing. Monday 00:00 **UTC**, deliberately not
/// shifted into the user's display time zone (`core/time/`) — a per-member
/// weekly rollup gains little precision from that shift and it would mean a
/// message sent close to midnight could move between weeks depending only on
/// who is looking, on machines that may not even share a zone. Displayed
/// dates still go through `InstantFormatter` as usual; this is a bucket
/// boundary, not a UI string.
class SelectedTeamDashboardWeekNotifier extends Notifier<DateTime> {
  @override
  DateTime build() => startOfWeek(DateTime.now().toUtc());

  void goToPreviousWeek() => state = state.subtract(const Duration(days: 7));

  void goToNextWeek() => state = state.add(const Duration(days: 7));

  void goToCurrentWeek() => state = startOfWeek(DateTime.now().toUtc());
}

final selectedTeamDashboardWeekProvider =
    NotifierProvider<SelectedTeamDashboardWeekNotifier, DateTime>(
  SelectedTeamDashboardWeekNotifier.new,
);

/// The full weekly rollup for [weekStart] (must already be a Monday 00:00
/// UTC — see [selectedTeamDashboardWeekProvider]).
///
/// Gathers exactly the rows `computeTeamDashboardStats` needs and nothing
/// else: every outreach thread's messages (there is no "messages in date
/// range" query to reach for — see `mirror_outreach_repository.dart`, it is
/// per-thread), every `emailSent` log entry up to the end of the week (older
/// entries are needed too, to attribute a response that lands in-week to a
/// reply that arrived before it), and the full deals table (small; the same
/// thing `allDealsProvider` already fetches whole).
final teamDashboardStatsProvider =
    FutureProvider.family<TeamDashboardStats, DateTime>((ref, weekStart) async {
  ref.watch(dataRevisionProvider(DataDomain.activity));
  ref.watch(dataRevisionProvider(DataDomain.outreach));
  ref.watch(dataRevisionProvider(DataDomain.deals));

  final weekEnd = weekStart.add(const Duration(days: 7));

  // Kicked off together, same style as `dashboard_stats_provider.dart`.
  final membersFuture = _resolveMembers(ref);
  final emailSentFuture = _fetchEmailSentLog(ref, before: weekEnd);
  final messagesFuture = _fetchAllMessages(ref);
  final dealsFuture = ref.watch(dealRepositoryProvider).getAll();

  final members = await membersFuture;
  final emailSentLog = await emailSentFuture;
  final messages = await messagesFuture;
  final deals = await dealsFuture;

  return computeTeamDashboardStats(
    members: members,
    messages: messages,
    emailSentLog: emailSentLog,
    deals: deals,
    weekStart: weekStart,
  );
});

/// The team roster to show a row for, even when a member sent nothing this
/// week. Prefers the live `profiles` list ([teamMembersProvider] — the same
/// id-to-name lookup the presence bar already uses); falls back to whoever
/// appears in the action log when that list is empty (no Supabase session:
/// the web preview, a widget test, or a machine that has never signed in),
/// which is also how the Logs page's actor filter behaves with no live
/// roster to join against (`ActivityLogRepository.getActors`).
Future<List<TeamDashboardMember>> _resolveMembers(Ref ref) async {
  final profiles = await ref.watch(teamMembersProvider.future);
  if (profiles.isNotEmpty) {
    return [
      for (final member in profiles.values)
        TeamDashboardMember(id: member.id, name: member.displayName),
    ];
  }
  final actors = await ref.watch(activityActorsProvider.future);
  return [
    for (final actor in actors)
      if (actor.id != null)
        TeamDashboardMember(id: actor.id!, name: actor.name),
  ];
}

/// Every `emailSent` entry recorded before [before], across every thread —
/// the only source of "who sent this outbound message" (see the aggregator's
/// doc comment). Paged through in full rather than capped at one page: a
/// missed later page would silently under-count messages sent, which is
/// worse than the extra round trips this team's data volume never makes
/// expensive.
Future<List<ActivityLogEntry>> _fetchEmailSentLog(
  Ref ref, {
  required DateTime before,
}) async {
  final repo = ref.watch(activityLogRepositoryProvider);
  const pageSize = 500;
  final all = <ActivityLogEntry>[];
  var offset = 0;
  while (true) {
    final page = await repo.getPage(
      offset: offset,
      limit: pageSize,
      query: ActivityLogQuery(
        action: ActivityAction.emailSent,
        entityType: 'thread',
        to: before,
      ),
    );
    all.addAll(page.items);
    if (!page.hasMore) break;
    offset += pageSize;
  }
  return all;
}

/// Every message on every thread. `OutreachRepository` has no bulk "all
/// messages" query (each thread carries its own conversation), so this is
/// `getAllThreads()` fanned out to `getMessages(thread.id)` — fine at this
/// team's scale, and the same fan-out shape the thread list screen already
/// does per row.
Future<List<OutreachMessage>> _fetchAllMessages(Ref ref) async {
  final repo = ref.watch(outreachRepositoryProvider);
  final threads = await repo.getAllThreads();
  final perThread = await Future.wait([
    for (final thread in threads) repo.getMessages(thread.id),
  ]);
  return [for (final messages in perThread) ...messages];
}
