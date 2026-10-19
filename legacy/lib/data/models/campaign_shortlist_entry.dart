/// One channel under consideration for a [Campaign], before any of them
/// becomes a [Deal] — the proposal-building step between "shortlisted in
/// the roster" (`VettingStatus` on `Influencer`) and "we're pitching this
/// to the brand". `channelId` is plain text, never a foreign key to a local
/// table, for the same reason `Deal.influencerId` is: the channel it names
/// may live only in R2 or another machine's local file, never in this
/// database (see `backend/schema.sql`'s doc comment on `deals.channel_id`).
class CampaignShortlistEntry {
  const CampaignShortlistEntry({
    required this.id,
    required this.campaignId,
    required this.channelId,
    required this.addedAt,
    this.whyFit,
    this.priceBasisSnapshot,
  });

  final String id;
  final String campaignId;
  final String channelId;

  /// Why this channel was picked for the brief — freeform, shown on the
  /// proposal next to the channel.
  final String? whyFit;

  /// Whatever rate numbers were on screen the moment this was shortlisted
  /// (e.g. `{"brandPrice": 1200, "medianViews": 45000}`), frozen at add
  /// time so a later change to the channel's going rate doesn't rewrite a
  /// proposal that has already been sent.
  final Map<String, dynamic>? priceBasisSnapshot;

  final DateTime addedAt;

  /// [id], [campaignId], [channelId] and [addedAt] are identity and never
  /// change — a shortlist entry doesn't move to a different campaign or
  /// channel, only its own notes and snapshot get edited.
  CampaignShortlistEntry copyWith({
    String? whyFit,
    Map<String, dynamic>? priceBasisSnapshot,
  }) {
    return CampaignShortlistEntry(
      id: id,
      campaignId: campaignId,
      channelId: channelId,
      addedAt: addedAt,
      whyFit: whyFit ?? this.whyFit,
      priceBasisSnapshot: priceBasisSnapshot ?? this.priceBasisSnapshot,
    );
  }
}
