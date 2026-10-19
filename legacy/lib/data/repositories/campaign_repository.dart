import 'package:gratovo_toolbox/data/models/campaign.dart';

/// How the UI reads and edits campaigns — the grouping a proposal or report
/// is built around. See `influencer_repository.dart`'s doc comment for the
/// mock/Supabase swap pattern this follows.
abstract class CampaignRepository {
  Future<List<Campaign>> getAll();

  Future<Campaign?> getById(String id);

  Future<List<Campaign>> getByBrand(String brandId);

  /// Creates a campaign and returns the stored record with its id. The
  /// repository owns id generation; pass [Campaign.id] as `''`.
  Future<Campaign> create(Campaign campaign);

  Future<void> update(Campaign campaign);

  Future<void> delete(String id);
}
