import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/my_day/application/my_day_aggregator.dart';
import 'package:gratovo_toolbox/features/my_day/application/my_day_models.dart';

/// Gathers exactly the rows `computeMyDayItems` needs and nothing else, the
/// same shape as `team_dashboard_stats_provider.dart`'s
/// `teamDashboardStatsProvider`: every deal (small; the same whole-table read
/// `allDealsProvider` already does elsewhere), every deal's deliverables
/// (`DeliverableRepository` has no bulk query, so this fans `getForDeal` out
/// across the deals just fetched — the same shape
/// `team_dashboard_stats_provider.dart`'s `_fetchAllMessages` uses for
/// threads), every outreach thread and its messages, and the open follow-up
/// reminders `ReminderRepository.getUpcoming()` already exposes for the
/// Dashboard's own "upcoming outreach" stat.
final myDayItemsProvider = FutureProvider<List<MyDayItem>>((ref) async {
  // Re-read whenever a deal, an outreach thread/message, or a reminder
  // changes anywhere. Deliverables have no `DataDomain` of their own yet —
  // they ride on `DataDomain.deals` since every one belongs to a deal and a
  // deliverable edit is, today, always reached from the deal it's on.
  ref.watch(dataRevisionProvider(DataDomain.deals));
  ref.watch(dataRevisionProvider(DataDomain.outreach));
  ref.watch(dataRevisionProvider(DataDomain.reminders));

  final currentUserId = (await ref.watch(currentProfileProvider.future))?.id;

  final dealsFuture = ref.watch(allDealsProvider.future);
  final threadsFuture = ref.watch(outreachRepositoryProvider).getAllThreads();
  final remindersFuture = ref.watch(reminderRepositoryProvider).getUpcoming();

  final deals = await dealsFuture;
  final threads = await threadsFuture;
  final reminders = await remindersFuture;

  final deliverableRepo = ref.watch(deliverableRepositoryProvider);
  final deliverablesPerDeal = await Future.wait([
    for (final deal in deals) deliverableRepo.getForDeal(deal.id),
  ]);
  final deliverables = <Deliverable>[
    for (final list in deliverablesPerDeal) ...list,
  ];

  final outreachRepo = ref.watch(outreachRepositoryProvider);
  final messagesPerThread = await Future.wait([
    for (final thread in threads) outreachRepo.getMessages(thread.id),
  ]);
  final messages = <OutreachMessage>[
    for (final list in messagesPerThread) ...list,
  ];

  return computeMyDayItems(
    currentUserId: currentUserId,
    deals: deals,
    deliverables: deliverables,
    threads: threads,
    messages: messages,
    reminders: reminders,
    now: DateTime.now(),
  );
});
