import 'package:gratovo_toolbox/data/models/campaign_shortlist_entry.dart';

/// How the UI reads and edits a campaign's shortlist — channels under
/// consideration for a [Campaign] before any of them becomes a [Deal]. See
/// `influencer_repository.dart`'s doc comment for the mock/Supabase swap
/// pattern this follows.
abstract class CampaignShortlistRepository {
  /// A campaign's shortlist, in the order channels were added.
  Future<List<CampaignShortlistEntry>> getForCampaign(String campaignId);

  /// Adds a channel to a campaign's shortlist and returns the stored
  /// record with its id. The repository owns id generation; pass
  /// [CampaignShortlistEntry.id] as `''`.
  Future<CampaignShortlistEntry> add(CampaignShortlistEntry entry);

  Future<void> update(CampaignShortlistEntry entry);

  /// Removes one entry — a channel dropped from the shortlist, not a
  /// rejection of the channel itself.
  Future<void> remove(String id);
}
