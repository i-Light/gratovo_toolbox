/// One closed deal's actual numbers for a channel, kept even if the [Deal]
/// itself is later deleted — `dealId` just goes null (the server's
/// `on delete set null`, not a cascade) so a deleted deal never takes the
/// answer to "what has this channel actually gone for before" away from
/// future pricing. Written once when a deal closes and never edited or
/// replaced — a fact about the past, not a record the team maintains — so,
/// unlike every other model in this folder, there is no `copyWith` here.
class ChannelRateHistoryEntry {
  const ChannelRateHistoryEntry({
    required this.id,
    required this.channelId,
    required this.brandPrice,
    required this.influencerPayout,
    required this.closedAt,
    this.dealId,
    this.medianViewsAtDeal,
  });

  final String id;
  final String channelId;

  /// The deal this closed rate came from, if it still exists.
  final String? dealId;

  final double brandPrice;
  final double influencerPayout;

  /// The channel's trailing-30-day median views at the moment the deal
  /// closed — so a rate can be read alongside the audience size it was
  /// actually priced against, which may have grown or shrunk since.
  final int? medianViewsAtDeal;

  final DateTime closedAt;

  /// The agency's cut on this closed deal — same definition as
  /// [Deal.margin].
  double get margin => brandPrice - influencerPayout;
}
