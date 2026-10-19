import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/data/models/campaign.dart';
import 'package:gratovo_toolbox/data/models/campaign_shortlist_entry.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';

/// Thin `FutureProvider` wrappers around [campaignRepositoryProvider] and
/// [campaignShortlistRepositoryProvider] — the same shape as
/// `data/providers/entity_providers.dart`'s `brandByIdProvider` and
/// `dealsByBrandProvider`, kept in this feature's own file rather than that
/// one since `entity_providers.dart` is a file this wave doesn't touch.
/// Every provider here watches [DataDomain.campaigns] so the brand profile's
/// Campaigns section and the campaign detail screen both re-read themselves
/// after either one writes, without knowing the other exists.
final campaignsByBrandProvider =
    FutureProvider.family<List<Campaign>, String>((ref, brandId) {
  ref.watch(dataRevisionProvider(DataDomain.campaigns));
  return ref.watch(campaignRepositoryProvider).getByBrand(brandId);
});

final campaignByIdProvider = FutureProvider.family<Campaign?, String>((
  ref,
  id,
) {
  ref.watch(dataRevisionProvider(DataDomain.campaigns));
  return ref.watch(campaignRepositoryProvider).getById(id);
});

/// One campaign's shortlist, in the order channels were added — see
/// [CampaignShortlistEntry]'s doc comment.
final campaignShortlistProvider =
    FutureProvider.family<List<CampaignShortlistEntry>, String>((
  ref,
  campaignId,
) {
  ref.watch(dataRevisionProvider(DataDomain.campaigns));
  return ref
      .watch(campaignShortlistRepositoryProvider)
      .getForCampaign(campaignId);
});
