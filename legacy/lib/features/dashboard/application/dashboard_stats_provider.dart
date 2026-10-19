import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/settings/application/agency_settings_controller.dart';

/// HC-16 (pick 4-5): how many creators should be ready to pitch before brand
/// outreach starts — the roster tile counts toward its upper end.
const int kRosterReadyTarget = 5;

/// The counts the Dashboard's stat tiles show, computed in one place rather
/// than each tile independently re-deriving its number from the raw entity
/// providers. Kept as plain derived data (not stored anywhere) so there's
/// never a second source of truth to drift from the real
/// influencer/deal/reminder/message lists.
class DashboardStats {
  const DashboardStats({
    required this.newFinds,
    required this.archiveDue,
    required this.activeNegotiations,
    required this.emailsSentToday,
    required this.draftedToday,
    this.dailyTarget = 50,
    this.readyToPitch = 0,
    this.rosterTarget = kRosterReadyTarget,
  });

  /// Influencers still sitting at [VettingStatus.newlyFound] — discovered
  /// but not yet triaged.
  final int newFinds;

  /// Channels currently counting down to being archived — `archive_due_at`
  /// is set, the 7-day grace period from `trg_channels_archive_due` hasn't
  /// elapsed yet. Shown as a small badge on the "New finds" tile.
  final int archiveDue;

  /// Deals that haven't reached a terminal stage yet (see
  /// `Deal.isActive`).
  final int activeNegotiations;

  /// Outbound messages recorded today — sent manually or through the Gmail
  /// auto-send path. Always 0 for a reader without full authority.
  final int emailsSentToday;

  /// Drafts the Comms queue made today, whatever became of them. It used to
  /// count reminders created today, which every automatic follow-up reminder
  /// inflated.
  final int draftedToday;

  /// The agency's daily outreach target (decision `daily-target`): the
  /// "sent today" tile reads "N of [dailyTarget]".
  final int dailyTarget;

  /// Creators whose media kit, agreed rate and audience make them ready to
  /// pitch (BRD-PRES-15, HC-27), against [rosterTarget] (HC-16).
  final int readyToPitch;
  final int rosterTarget;
}

final dashboardStatsProvider = FutureProvider<DashboardStats>((ref) async {
  // Re-read whenever a message is sent or a reminder changes anywhere, so the
  // tiles keep up without the dashboard invalidating them by hand.
  ref.watch(dataRevisionProvider(DataDomain.outreach));
  ref.watch(dataRevisionProvider(DataDomain.reminders));
  ref.watch(dataRevisionProvider(DataDomain.comms));
  ref.watch(dataRevisionProvider(DataDomain.channels));

  // The day-boundary the "today" counts compare against.
  final now = DateTime.now();
  final startOfToday = DateTime(now.year, now.month, now.day);

  // Each `.future` / repository call is kicked off before any `await` below,
  // so all the reads are already in flight concurrently.
  final newFindsFuture = ref.watch(newFindsCountProvider.future);
  final archiveDueFuture = ref.watch(archiveDueCountProvider.future);
  final dealsFuture = ref.watch(allDealsProvider.future);
  final sentTodayFuture =
      ref.watch(outreachRepositoryProvider).countOutboundSince(startOfToday);
  final draftedTodayFuture = ref
      .watch(commsProposalRepositoryProvider)
      .countCreatedSince(startOfToday);
  final agencyFuture = ref.watch(agencySettingsProvider.future);
  // A page as wide as the target is plenty: the tile reads "N of 5", and
  // past that the exact count no longer changes what anyone does.
  final readyFuture = ref.watch(influencerRepositoryProvider).getPage(
        offset: 0,
        limit: 100,
        query: const InfluencerQuery(
          requireFlags: {InfluencerFlag.readyToPitch},
        ),
      );

  final newFinds = await newFindsFuture;
  final archiveDue = await archiveDueFuture;
  final deals = await dealsFuture;
  final emailsSentToday = await sentTodayFuture;
  final draftedToday = await draftedTodayFuture;
  final agency = await agencyFuture;
  final ready = await readyFuture;

  return DashboardStats(
    newFinds: newFinds,
    archiveDue: archiveDue,
    activeNegotiations: deals.where((d) => d.isActive).length,
    emailsSentToday: emailsSentToday,
    draftedToday: draftedToday,
    dailyTarget: agency.dailyTarget,
    readyToPitch: ready.items.length,
  );
});
