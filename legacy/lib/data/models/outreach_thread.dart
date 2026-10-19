/// Where a relationship with one influencer currently stands,
/// conversation-wise. Deliberately a *thread*-level status, separate from
/// a Deal's own stage — a thread can be `awaitingReply` while there's no
/// deal yet, or stay `replied` long after a deal has moved on to
/// negotiating.
enum ThreadStatus {
  notContactedYet,
  awaitingReply,
  replied,
  needsFollowUp;
}

/// One ongoing outreach relationship — the CRM-style "everything we've said
/// to this influencer" record. Optionally linked to a deal once one
/// exists, but a thread can exist before any deal does (early feeler
/// outreach) or continue after a deal closes (after-sale check-ins).
class OutreachThread {
  const OutreachThread({
    required this.id,
    required this.influencerId,
    required this.status,
    required this.updatedAt,
    this.dealId,
    this.ownerId,
    this.brandId,
    this.contactEmail,
  });

  final String id;

  /// The channel this thread is with; empty for a brand thread.
  final String influencerId;
  final String? dealId;
  final ThreadStatus status;
  final DateTime updatedAt;

  /// Who on the team owns this conversation. Nullable: most threads start
  /// unassigned.
  final String? ownerId;

  /// Set on a thread with a brand contact instead of a channel (1.4).
  final String? brandId;

  /// The brand contact's address, for a brand thread.
  final String? contactEmail;

  bool get isBrandThread => brandId != null;

  OutreachThread copyWith({ThreadStatus? status, DateTime? updatedAt}) {
    return OutreachThread(
      id: id,
      influencerId: influencerId,
      dealId: dealId,
      ownerId: ownerId,
      brandId: brandId,
      contactEmail: contactEmail,
      status: status ?? this.status,
      updatedAt: updatedAt ?? DateTime.now(),
    );
  }
}
