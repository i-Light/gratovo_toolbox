// The Home tiles (plan step 8): sent today against the daily target, the
// roster's creators ready to pitch against HC-16's five, and "Drafted today"
// counting the Comms queue's drafts rather than reminders.
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/native/comms_protocol.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/agency_settings.dart';
import 'package:gratovo_toolbox/data/models/comms_proposal.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/media_kit.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_agency_settings_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_comms_proposal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/dashboard/application/dashboard_stats_provider.dart';

Influencer _creator(String id, {MediaKit? kit}) => Influencer(
      id: id,
      handle: '@$id',
      channelUrl: '',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 150000,
      sourceKeywords: const [],
      vettingStatus: VettingStatus.shortlisted,
      discoveredAt: DateTime.utc(2026),
      mediaKit: kit,
    );

const _readyKit = MediaKit(
  countries: [AudienceShare(code: 'US', pct: 41)],
  ageBand: '25-34',
  rates: [RateCardRow(format: 'integration', price: 2500, agreed: true)],
);

CommsProposal _draft(String id, DateTime at) => CommsProposal(
      id: id,
      kind: CommsKind.reply,
      status: CommsQueueStatus.proposed,
      engineStatus: CommsEngineStatus.ready,
      createdAt: at,
      updatedAt: at,
    );

void main() {
  late MockCommsProposalRepository proposals;
  late MockReminderRepository reminders;
  late MockAgencySettingsRepository agency;
  late MockInfluencerRepository influencers;
  late ProviderContainer container;

  setUp(() {
    proposals = MockCommsProposalRepository();
    reminders = MockReminderRepository();
    agency = MockAgencySettingsRepository();
    influencers = MockInfluencerRepository()
      ..replaceAllForTesting([
        _creator('UC_ready', kit: _readyKit),
        _creator('UC_not'),
      ]);
    container = ProviderContainer(overrides: [
      supabaseBootProvider.overrideWithValue(const SupabaseBoot(
        config: SupabaseConfig(url: '', anonKey: ''),
        error: 'no server configured in this test',
      )),
      commsProposalRepositoryProvider.overrideWithValue(proposals),
      reminderRepositoryProvider.overrideWithValue(reminders),
      agencySettingsRepositoryProvider.overrideWithValue(agency),
      influencerRepositoryProvider.overrideWithValue(influencers),
    ]);
    addTearDown(container.dispose);
  });

  test('drafted today counts the queue drafts made today, not reminders',
      () async {
    final now = DateTime.now();
    await proposals.save(_draft('', now));
    await proposals.save(_draft('', now.subtract(const Duration(days: 2))));
    await reminders.create(FollowUpReminder(
      id: '',
      title: 'Follow-up 1 of 3',
      kind: ReminderKind.followUp,
      dueAt: now.add(const Duration(days: 4)),
      createdAt: now,
    ));

    final stats = await container.read(dashboardStatsProvider.future);

    expect(stats.draftedToday, 1);
  });

  test('sent today is read against the daily target', () async {
    await agency.save(const AgencySettings(dailyTarget: 40));

    final stats = await container.read(dashboardStatsProvider.future);

    expect(stats.dailyTarget, 40);
  });

  test('the roster counts creators ready to pitch, out of five', () async {
    final stats = await container.read(dashboardStatsProvider.future);

    expect(stats.readyToPitch, 1);
    expect(stats.rosterTarget, 5);
  });
}
