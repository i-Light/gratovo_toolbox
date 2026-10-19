import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/models/activity_log_query.dart';
import 'package:gratovo_toolbox/data/models/ai_provider_config.dart';
import 'package:gratovo_toolbox/data/models/aws_gateway_settings.dart';
import 'package:gratovo_toolbox/data/models/brand.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/email_template.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/data/models/search_tuning_settings.dart';
import 'package:gratovo_toolbox/data/models/video.dart';
import 'package:gratovo_toolbox/data/repositories/activity_log_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';

/// Thin `FutureProvider` wrappers around the repositories — the layer every
/// screen actually watches. Keeping this separate from
/// repository_providers.dart means a screen that just wants "all
/// influencers" never has to know a repository interface exists; it only
/// ever imports this file.
///
/// Every provider here opens by watching its [DataDomain] counter, so it
/// re-reads itself whenever anything anywhere changes that kind of data. That
/// line is the whole subscription: a mutation announces only *what* it changed
/// (see `core/events/data_change_bus.dart`) and never has to know who is
/// reading it.
///
/// It replaced a per-mutation list of `ref.invalidate(...)` calls, which was
/// wrong in the way such lists always end up wrong — editing a channel's tags
/// from its profile refreshed the profile and left the influencer list, the
/// dashboard tiles and the analytics charts showing the old value, because the
/// profile's editor had no reason to know they existed.
///
/// A direct `ref.invalidate` is still right for the narrow cases: refreshing
/// one screen on a pull-to-refresh, or retrying after an error. It is the wrong
/// tool for "and now tell everyone else".

/// How many channels are still untriaged — the Dashboard's "new finds" tile,
/// as one integer rather than as every channel in the database.
///
/// This replaces an `allInfluencersProvider` that fetched the whole table so
/// four screens could each narrow it in Dart. Measured against 100,000
/// channels that provider moved 35 MB and built 100,000 `Influencer` objects;
/// the tile it fed rendered a single number, and the picker that shared it
/// rendered fifty rows. Both now ask the database the question they actually
/// have.
final newFindsCountProvider = FutureProvider<int>((ref) {
  ref.watch(dataRevisionProvider(DataDomain.channels));
  return ref
      .watch(influencerRepositoryProvider)
      .countByVettingStatus(VettingStatus.newlyFound);
});

/// How many channels are currently counting down to being archived — the
/// small "+N archive due" badge on the Dashboard's "New finds" tile, as one
/// integer rather than every tagged channel in the database. See
/// [InfluencerRepository.countArchiveDue].
final archiveDueCountProvider = FutureProvider<int>((ref) {
  ref.watch(dataRevisionProvider(DataDomain.channels));
  return ref.watch(influencerRepositoryProvider).countArchiveDue();
});

final influencerByIdProvider =
    FutureProvider.family<Influencer?, String>((ref, id) {
  ref.watch(dataRevisionProvider(DataDomain.channels));
  return ref.watch(influencerRepositoryProvider).getById(id);
});

final videosByInfluencerProvider =
    FutureProvider.family<List<Video>, String>((ref, influencerId) {
  ref.watch(dataRevisionProvider(DataDomain.videos));
  return ref.watch(influencerRepositoryProvider).getRecentVideos(influencerId);
});

/// Everyone who appears in the action log, including deleted accounts — the
/// options in the Logs page's actor filter.
final activityActorsProvider = FutureProvider<List<ActivityActor>>((ref) {
  ref.watch(dataRevisionProvider(DataDomain.activity));
  return ref.watch(activityLogRepositoryProvider).getActors();
});

/// One record's own history, newest first — the Activity card on a profile.
///
/// Capped rather than paged: a card on a profile page answers "what has
/// happened to this recently", and anyone who needs the whole history has the
/// Logs page, which is paged and filterable.
final activityForEntityProvider =
    FutureProvider.family<List<ActivityLogEntry>, ({String type, String id})>(
        (ref, target) async {
  ref.watch(dataRevisionProvider(DataDomain.activity));
  final page = await ref.watch(activityLogRepositoryProvider).getPage(
        offset: 0,
        limit: 12,
        query: ActivityLogQuery(entityType: target.type, entityId: target.id),
      );
  return page.items;
});

final allBrandsProvider = FutureProvider<List<Brand>>((ref) {
  ref.watch(dataRevisionProvider(DataDomain.brands));
  return ref.watch(brandRepositoryProvider).getAll();
});

final brandByIdProvider = FutureProvider.family<Brand?, String>((ref, id) {
  ref.watch(dataRevisionProvider(DataDomain.brands));
  return ref.watch(brandRepositoryProvider).getById(id);
});

final allDealsProvider = FutureProvider<List<Deal>>((ref) {
  ref.watch(dataRevisionProvider(DataDomain.deals));
  return ref.watch(dealRepositoryProvider).getAll();
});

final dealsByInfluencerProvider =
    FutureProvider.family<List<Deal>, String>((ref, influencerId) {
  ref.watch(dataRevisionProvider(DataDomain.deals));
  return ref.watch(dealRepositoryProvider).getByInfluencer(influencerId);
});

final dealsByBrandProvider =
    FutureProvider.family<List<Deal>, String>((ref, brandId) {
  ref.watch(dataRevisionProvider(DataDomain.deals));
  return ref.watch(dealRepositoryProvider).getByBrand(brandId);
});

final dealByIdProvider = FutureProvider.family<Deal?, String>((ref, id) {
  ref.watch(dataRevisionProvider(DataDomain.deals));
  return ref.watch(dealRepositoryProvider).getById(id);
});

/// Prefers `activeSearchRunControllerProvider`'s live, in-session state
/// (real stdout, real numbers, updates as the run progresses) whenever this
/// app instance has started a run; falls back to
/// `SearchRepository.getCurrentRun()`'s local-`gratovo.db`-only snapshot
/// otherwise (app just launched, or a teammate ran `python search.py` by
/// hand on this same machine) -- see `LocalSearchRepository`'s and
/// `ActiveSearchRunNotifier`'s doc comments for why these are two different
/// sources rather than one.
final currentSearchRunProvider = FutureProvider<SearchRun?>((ref) {
  ref.watch(dataRevisionProvider(DataDomain.searchRuns));
  final live = ref.watch(activeSearchRunControllerProvider);
  if (live != null) return live;
  return ref.watch(searchRepositoryProvider).getCurrentRun();
});

final upcomingRemindersProvider = FutureProvider<List<FollowUpReminder>>((
  ref,
) {
  return ref.watch(reminderRepositoryProvider).getUpcoming();
});

/// Open reminders for one influencer, soonest due first — the Outreach
/// thread's "scheduled follow-ups" section and the influencer profile.
final remindersByInfluencerProvider =
    FutureProvider.family<List<FollowUpReminder>, String>((ref, influencerId) {
  ref.watch(dataRevisionProvider(DataDomain.reminders));
  ref.watch(dataRevisionProvider(DataDomain.reminders));
  return ref.watch(reminderRepositoryProvider).getForInfluencer(influencerId);
});

/// The soonest open reminder per influencer id, derived from
/// [upcomingRemindersProvider] so the Outreach thread list can show a
/// due/overdue chip on every row without one query per row.
final openReminderByInfluencerProvider =
    Provider<AsyncValue<Map<String, FollowUpReminder>>>((ref) {
  return ref.watch(upcomingRemindersProvider).whenData((reminders) {
    final map = <String, FollowUpReminder>{};
    for (final reminder in reminders) {
      final id = reminder.influencerId;
      if (id == null) continue;
      final existing = map[id];
      if (existing == null || reminder.dueAt.isBefore(existing.dueAt)) {
        map[id] = reminder;
      }
    }
    return map;
  });
});

final allTemplatesProvider = FutureProvider<List<EmailTemplate>>((ref) {
  ref.watch(dataRevisionProvider(DataDomain.templates));
  return ref.watch(templateRepositoryProvider).getAll();
});

/// The team's shared outreach writing rules, in apply order. Edited through
/// `writingRulesControllerProvider`; the AI draft flow reads this when
/// assembling `AiDraftContext`.
final writingRulesProvider = FutureProvider<List<String>>((ref) {
  ref.watch(dataRevisionProvider(DataDomain.writingRules));
  return ref.watch(writingRulesRepositoryProvider).getAll();
});

final allOutreachThreadsProvider = FutureProvider<List<OutreachThread>>((
  ref,
) {
  return ref.watch(outreachRepositoryProvider).getAllThreads();
});

final threadByIdProvider =
    FutureProvider.family<OutreachThread?, String>((ref, id) {
  ref.watch(dataRevisionProvider(DataDomain.outreach));
  ref.watch(dataRevisionProvider(DataDomain.outreach));
  return ref.watch(outreachRepositoryProvider).getThreadById(id);
});

final threadByInfluencerProvider =
    FutureProvider.family<OutreachThread?, String>((ref, influencerId) {
  ref.watch(dataRevisionProvider(DataDomain.outreach));
  return ref.watch(outreachRepositoryProvider).getThreadByInfluencer(
        influencerId,
      );
});

final messagesByThreadProvider =
    FutureProvider.family<List<OutreachMessage>, String>((ref, threadId) {
  ref.watch(dataRevisionProvider(DataDomain.outreach));
  return ref.watch(outreachRepositoryProvider).getMessages(threadId);
});

final searchTuningSettingsProvider = FutureProvider<SearchTuningSettings>((
  ref,
) {
  return ref.watch(searchTuningRepositoryProvider).get();
});

final awsGatewaySettingsProvider = FutureProvider<AwsGatewaySettings>((ref) {
  return ref.watch(awsGatewayRepositoryProvider).get();
});

final aiProviderConfigsProvider = FutureProvider<List<AiProviderConfig>>((
  ref,
) {
  return ref.watch(aiProviderConfigRepositoryProvider).getAll();
});
