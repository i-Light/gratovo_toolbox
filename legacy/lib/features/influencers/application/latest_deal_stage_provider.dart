import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';

/// The influencer's most recent deal stage, or null if they've never had a
/// deal — the small "latest stage" badge the Influencer list/profile show.
///
/// Deliberately derived on read, never stored: the `Deal` model's doc is
/// explicit that a persisted "current stage" field on Influencer is exactly
/// the trap that would silently lose history across repeat engagements.
/// [DealRepository.getByInfluencer] already returns deals newest-first, so
/// this is just "take the first one."
final latestDealStageProvider = FutureProvider.family<DealStage?, String>((
  ref,
  influencerId,
) async {
  final deals = await ref.watch(dealsByInfluencerProvider(influencerId).future);
  if (deals.isEmpty) return null;
  return deals.first.stage;
});
