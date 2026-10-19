/// What kind of thing a [FollowUpReminder] is nudging someone about — drives
/// which icon/route it links to in the Dashboard and (Phase 3) Outreach.
enum ReminderKind {
  followUp,
  dealDeadline,
  custom;
}

/// A single upcoming thing someone on the team needs to do — a follow-up
/// email that's due, a deal deadline approaching, or a one-off custom
/// nudge. Exists mainly to make the Dashboard's "upcoming outreach" stat
/// real; Phase 3's Outreach page is where these actually get created and
/// resolved day to day.
class FollowUpReminder {
  const FollowUpReminder({
    required this.id,
    required this.title,
    required this.dueAt,
    required this.kind,
    this.influencerId,
    this.dealId,
    this.isDone = false,
    this.createdAt,
  });

  final String id;
  final String title;
  final DateTime dueAt;
  final ReminderKind kind;

  /// When the reminder was scheduled (its `created_at` row). Null for the
  /// in-memory mock's seed data and for rows written before the column
  /// existed — callers that count "scheduled today" treat null as "not
  /// today".
  final DateTime? createdAt;

  /// Set when this reminder is about a specific influencer relationship
  /// (e.g. "follow up with @channel — no reply in 5 days").
  final String? influencerId;

  /// Set when this reminder is tied to a specific deal (e.g. a deliverable
  /// deadline).
  final String? dealId;

  final bool isDone;

  /// [id], [influencerId], [dealId] and [createdAt] are identity and never
  /// change through [copyWith] — a reminder edited in the Outreach page keeps
  /// pointing at the same relationship and its original scheduled time.
  FollowUpReminder copyWith({
    String? title,
    DateTime? dueAt,
    ReminderKind? kind,
    bool? isDone,
  }) {
    return FollowUpReminder(
      id: id,
      title: title ?? this.title,
      dueAt: dueAt ?? this.dueAt,
      kind: kind ?? this.kind,
      influencerId: influencerId,
      dealId: dealId,
      isDone: isDone ?? this.isDone,
      createdAt: createdAt,
    );
  }
}
