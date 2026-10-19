import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/sync/sync_providers.dart';
import 'package:gratovo_toolbox/data/repositories/activity_log_repository.dart';
import 'package:gratovo_toolbox/data/repositories/agency_settings_repository.dart';
import 'package:gratovo_toolbox/data/repositories/ai_provider_config_repository.dart';
import 'package:gratovo_toolbox/data/repositories/archive_repository.dart';
import 'package:gratovo_toolbox/data/repositories/aws_gateway_repository.dart';
import 'package:gratovo_toolbox/data/repositories/brand_repository.dart';
import 'package:gratovo_toolbox/data/repositories/campaign_repository.dart';
import 'package:gratovo_toolbox/data/repositories/campaign_shortlist_repository.dart';
import 'package:gratovo_toolbox/data/repositories/channel_rate_history_repository.dart';
import 'package:gratovo_toolbox/data/repositories/channel_stats_repository.dart';
import 'package:gratovo_toolbox/data/repositories/client_merge_status_repository.dart';
import 'package:gratovo_toolbox/data/repositories/comms_proposal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/conflict_repository.dart';
import 'package:gratovo_toolbox/data/repositories/deal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/deliverable_repository.dart';
import 'package:gratovo_toolbox/data/repositories/influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/local/local_aws_gateway_repository.dart';
import 'package:gratovo_toolbox/data/repositories/local/local_search_repository.dart';
import 'package:gratovo_toolbox/data/repositories/local/local_search_tuning_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_activity_log_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_agency_settings_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_archive_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_brand_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_campaign_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_campaign_shortlist_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_channel_rate_history_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_channel_stats_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_client_merge_status_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_comms_proposal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_conflict_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_deal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_deliverable_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_news_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_remote_search_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_scheduled_job_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_scratchpad_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_template_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_writing_rules_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_activity_log_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_agency_settings_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_archive_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_brand_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_campaign_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_campaign_shortlist_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_channel_rate_history_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_channel_stats_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_client_merge_status_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_comms_proposal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_conflict_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_deal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_deliverable_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_news_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_remote_search_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_scheduled_job_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_scratchpad_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_template_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_writing_rules_repository.dart';
import 'package:gratovo_toolbox/data/repositories/news_repository.dart';
import 'package:gratovo_toolbox/data/repositories/outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/remote_search_repository.dart';
import 'package:gratovo_toolbox/data/repositories/scheduled_job_repository.dart';
import 'package:gratovo_toolbox/data/repositories/scratchpad_repository.dart';
import 'package:gratovo_toolbox/data/repositories/search_repository.dart';
import 'package:gratovo_toolbox/data/repositories/search_tuning_repository.dart';
import 'package:gratovo_toolbox/data/repositories/secure/secure_ai_provider_config_repository.dart';
import 'package:gratovo_toolbox/data/repositories/template_repository.dart';
import 'package:gratovo_toolbox/data/repositories/writing_rules_repository.dart';

/// The ONE file that decides where the app's data comes from.
///
/// Every screen depends on the abstract repository interfaces, never on a
/// concrete implementation, and the answer here is the same for all of them:
/// **the local database**, whenever there is one. Signed in or not, online or
/// not, synced or not — the app reads and writes `data/database/gratovo.db`
/// and nothing else. Syncing is the engine's job in the background
/// (`sync_providers.dart`), and the repositories neither know nor care
/// whether it is running.
///
/// The only fallback is the in-memory mock, for the one situation with no
/// local database at all: the web build, or a file that could not be
/// opened. That keeps the app's shape visible and explorable (and every
/// widget test on mocks), and the Settings page is where the real state is
/// reported.
///
/// Nothing in this file talks to Supabase. The old `Supabase*Repository`
/// classes are gone; PostgREST and the RPCs are reached only by the sync
/// engine's uploader and puller.

final influencerRepositoryProvider = Provider<InfluencerRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockInfluencerRepository();
  return MirrorInfluencerRepository(db, actor: ref.watch(syncActorProvider));
});

/// The action history. Written locally the moment an action happens and
/// uploaded in batches; nothing recorded offline is lost.
final activityLogRepositoryProvider = Provider<ActivityLogRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockActivityLogRepository();
  return MirrorActivityLogRepository(db);
});

/// What is left of the channels the team rejected — see `ArchiveRepository`'s
/// doc comment for why there is no `archive()` there.
final archiveRepositoryProvider = Provider<ArchiveRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockArchiveRepository();
  return MirrorArchiveRepository(db);
});

/// Aggregates over the channel table, for the Dashboard's analytics section.
/// Every number is computed here from local rows; none is stored anywhere.
final channelStatsRepositoryProvider = Provider<ChannelStatsRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return const MockChannelStatsRepository();
  return MirrorChannelStatsRepository(db);
});

/// Edits that were refused because somebody else changed the field first.
final conflictRepositoryProvider = Provider<ConflictRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockConflictRepository();
  return MirrorConflictRepository(db, ref.watch(syncActorProvider));
});

/// The news feed: the pipeline's fetcher fills the local tables, this reads
/// them. Not shared between machines.
final newsRepositoryProvider = Provider<NewsRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockNewsRepository();
  return MirrorNewsRepository(db);
});

/// The team scratchpad — one shared text box per person, and the one table
/// still replicated live.
final scratchpadRepositoryProvider = Provider<ScratchpadRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockScratchpadRepository();
  return MirrorScratchpadRepository(
    db,
    userId: ref.watch(syncActorProvider).id,
  );
});

/// Keyword lists handed between team members' machines — the Search screen's
/// upload button.
final remoteSearchRepositoryProvider = Provider<RemoteSearchRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockRemoteSearchRepository();
  final uid = ref.watch(syncActorProvider).id;
  return MirrorRemoteSearchRepository(db, myUserId: uid);
});

/// The merge board: which quarantined local databases this machine still has
/// to merge (see `pipeline_reset.dart`). Local-only bookkeeping.
final clientMergeStatusRepositoryProvider =
    Provider<ClientMergeStatusRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockClientMergeStatusRepository();
  return MirrorClientMergeStatusRepository(
    db,
    userId: ref.watch(syncActorProvider).id,
  );
});

final brandRepositoryProvider = Provider<BrandRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockBrandRepository();
  return MirrorBrandRepository(db);
});

final dealRepositoryProvider = Provider<DealRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockDealRepository();
  return MirrorDealRepository(db);
});

final campaignRepositoryProvider = Provider<CampaignRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockCampaignRepository();
  return MirrorCampaignRepository(db);
});

final campaignShortlistRepositoryProvider =
    Provider<CampaignShortlistRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockCampaignShortlistRepository();
  return MirrorCampaignShortlistRepository(db);
});

final deliverableRepositoryProvider = Provider<DeliverableRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockDeliverableRepository();
  return MirrorDeliverableRepository(db);
});

final channelRateHistoryRepositoryProvider =
    Provider<ChannelRateHistoryRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockChannelRateHistoryRepository();
  return MirrorChannelRateHistoryRepository(db);
});

/// Local-only -- no Supabase counterpart (see [ScheduledJob]'s doc comment),
/// but still swaps to the mock on web/no-local-db like every other entry
/// here, for widget-test and web-preview consistency.
final scheduledJobRepositoryProvider = Provider<ScheduledJobRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockScheduledJobRepository();
  return MirrorScheduledJobRepository(db);
});

/// Always the real [LocalSearchRepository] -- see its own doc comment for why
/// this one isn't a mock/real swap: run progress lives in the local
/// `gratovo.db` and nowhere else, signed in or not.
final searchRepositoryProvider = Provider<SearchRepository>((ref) {
  return const LocalSearchRepository();
});

final reminderRepositoryProvider = Provider<ReminderRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockReminderRepository();
  return MirrorReminderRepository(db);
});

final templateRepositoryProvider = Provider<TemplateRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockTemplateRepository();
  return MirrorTemplateRepository(db);
});

/// The Comms queue's items (`comms_proposals`).
final commsProposalRepositoryProvider =
    Provider<CommsProposalRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockCommsProposalRepository();
  return MirrorCommsProposalRepository(db);
});

/// The agency's own facts: the one shared `agency_settings` row.
final agencySettingsRepositoryProvider =
    Provider<AgencySettingsRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockAgencySettingsRepository();
  return MirrorAgencySettingsRepository(db);
});

/// The team's shared outreach writing rules.
final writingRulesRepositoryProvider = Provider<WritingRulesRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockWritingRulesRepository();
  return MirrorWritingRulesRepository(db);
});

/// Outreach threads and messages.
///
/// Not gated on the caller's role. The `basic` role hides the Outreach PAGE
/// (`app_router.dart`, `app_shell.dart`); the data still syncs to and is
/// readable on every machine, because the influencer list's outbound count
/// and the dashboard's "sent today" are computed from it locally.
final outreachRepositoryProvider = Provider<OutreachRepository>((ref) {
  final db = ref.watch(localMirrorProvider);
  if (db == null) return MockOutreachRepository();
  return MirrorOutreachRepository(db);
});

/// Always the real [LocalSearchTuningRepository] -- see its own doc comment
/// (and `LocalSearchRepository`'s, same reasoning) for why this is wired in
/// unconditionally rather than gated behind a mirror connection.
final searchTuningRepositoryProvider = Provider<SearchTuningRepository>((ref) {
  return const LocalSearchTuningRepository();
});

/// Always the real [LocalAwsGatewayRepository] -- same reasoning as
/// [searchTuningRepositoryProvider].
final awsGatewayRepositoryProvider = Provider<AwsGatewayRepository>((ref) {
  return const LocalAwsGatewayRepository();
});

/// Not mock-backed — see `ai_provider_config_repository.dart`'s doc comment
/// for why an API key goes straight to encrypted device storage.
final aiProviderConfigRepositoryProvider =
    Provider<AiProviderConfigRepository>((ref) {
  return SecureAiProviderConfigRepository();
});
