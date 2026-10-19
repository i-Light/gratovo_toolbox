/// The rollup shapes the Team Dashboard renders. Everything here is derived,
/// never stored — the same spirit as `dashboard_stats_provider.dart`'s
/// [DashboardStats]: computed fresh from `activity_log`, `outreach_messages`
/// and `deals` every time the screen asks, so there is never a second copy of
/// a number to drift from the source rows.
library;

/// One person the dashboard can show a row for. Deliberately smaller than
/// [TeamMember] (just what a row needs to render) so the aggregator does not
/// have to depend on how the roster was fetched — a live `profiles` read, a
/// mock, or (as a last resort) names recovered from `activity_log` itself.
class TeamDashboardMember {
  const TeamDashboardMember({required this.id, required this.name});

  final String id;
  final String name;

  @override
  bool operator ==(Object other) =>
      other is TeamDashboardMember && other.id == id && other.name == name;

  @override
  int get hashCode => Object.hash(id, name);
}

/// One team member's numbers for one week.
///
/// [repliesReceived] and [medianFirstResponseTime] both come from matching an
/// inbound `outreach_messages` row to whichever outbound message immediately
/// precedes or follows it on the same thread — see
/// `team_dashboard_aggregator.dart`'s doc comment for exactly what that
/// attribution can and cannot promise.
class TeamDashboardRow {
  const TeamDashboardRow({
    required this.member,
    required this.messagesSent,
    required this.repliesReceived,
    required this.medianFirstResponseTime,
  });

  final TeamDashboardMember member;

  /// Outbound messages this member sent this week — counted from
  /// `activity_log`'s `emailSent` entries, which is the only place a message
  /// send carries an actor at all (`outreach_messages` itself does not).
  /// Automated follow-up sends (nobody clicked "send") have no actor and are
  /// not counted toward anyone.
  final int messagesSent;

  /// Inbound replies this week that answered a message this member sent —
  /// i.e. the reply's immediately preceding message on the same thread was an
  /// outbound message attributed to this member. A reply that arrives on a
  /// thread whose last outbound message could not be attributed to anyone
  /// (an automated send) is not counted here either.
  final int repliesReceived;

  /// `repliesReceived / messagesSent` for the week, or null when
  /// [messagesSent] is 0 (nothing to divide by, not a 0% rate).
  double? get replyRate =>
      messagesSent == 0 ? null : repliesReceived / messagesSent;

  /// The median time from an inbound message to the next outbound message
  /// this member sent on the same thread, counting only responses sent this
  /// week. Null when this member has no such response this week.
  final Duration? medianFirstResponseTime;
}

/// What the deals table can tell us for the week, at the team level.
///
/// Not broken out per member: `deals` has no owner/actor column, and no
/// `activity_log` entry is written when a deal's stage changes (see
/// `deal_detail_screen.dart` — it calls `DealRepository.updateStage` directly)
/// — there is nothing in the data that says *who* moved a deal. See this
/// feature's top-level doc comment for the full explanation; this type exists
/// so that absence is a typed, visible fact rather than a silently-omitted
/// column.
class TeamDashboardDealSummary {
  const TeamDashboardDealSummary({
    required this.dealsClosed,
    required this.marginClosed,
  });

  /// Deals whose stage is `closed` and whose `updatedAt` falls in the week.
  /// `updatedAt` bumps on a notes edit too, not only a stage change, so this
  /// is "closed and touched this week", not a guaranteed stage-transition
  /// count — the closest honest reading of what's actually stored.
  final int dealsClosed;

  /// Sum of `brandPrice - influencerPayout` across [dealsClosed]'s deals.
  final double marginClosed;
}

/// One week's complete rollup: every team member's row, plus the team-wide
/// deal figures that can't be split by person.
class TeamDashboardStats {
  const TeamDashboardStats({
    required this.weekStart,
    required this.rows,
    required this.deals,
  });

  /// Monday 00:00 of the week these numbers cover (half-open
  /// `[weekStart, weekStart + 7 days)`).
  final DateTime weekStart;

  final List<TeamDashboardRow> rows;
  final TeamDashboardDealSummary deals;
}
