/// Whether a [Campaign] is still being worked or has been wrapped up.
enum CampaignStatus {
  active,
  closed;
}

/// A named grouping of deals for one brand — the unit a proposal or a
/// report is built around ("Q3 back-to-school push", "NordVPN — spring
/// creators"). Purely organisational: the broker does not manage the
/// brand's budget or campaign delivery/KPIs — that is the brand's own job —
/// so there is deliberately no budget or KPI field here. Money lives on
/// [Deal] instead, one row per influencer engagement, exactly as it did
/// before campaigns existed; a campaign is just a label a set of deals can
/// share.
class Campaign {
  const Campaign({
    required this.id,
    required this.brandId,
    required this.name,
    required this.createdAt,
    required this.updatedAt,
    this.notes,
    this.status = CampaignStatus.active,
    this.startDate,
    this.liveDate,
  });

  final String id;
  final String brandId;
  final String name;
  final String? notes;
  final CampaignStatus status;

  /// When work on the campaign begins — planning/outreach, not necessarily
  /// when content goes out (see [liveDate]).
  final DateTime? startDate;

  /// When the campaign's content is expected/scheduled to go live.
  final DateTime? liveDate;

  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isActive => status == CampaignStatus.active;

  /// [id], [brandId] and [createdAt] are identity and never change through
  /// [copyWith]. [updatedAt] defaults to now — the same opt-out rule as
  /// [Deal.copyWith].
  Campaign copyWith({
    String? name,
    String? notes,
    CampaignStatus? status,
    DateTime? startDate,
    DateTime? liveDate,
    DateTime? updatedAt,
  }) {
    return Campaign(
      id: id,
      brandId: brandId,
      name: name ?? this.name,
      notes: notes ?? this.notes,
      status: status ?? this.status,
      startDate: startDate ?? this.startDate,
      liveDate: liveDate ?? this.liveDate,
      createdAt: createdAt,
      updatedAt: updatedAt ?? DateTime.now(),
    );
  }
}
