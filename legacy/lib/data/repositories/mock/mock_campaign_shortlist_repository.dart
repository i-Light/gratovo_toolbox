import 'package:gratovo_toolbox/data/models/campaign_shortlist_entry.dart';
import 'package:gratovo_toolbox/data/repositories/campaign_shortlist_repository.dart';

/// In-memory [CampaignShortlistRepository], seeded with a couple of entries
/// against `MockCampaignRepository`'s campaigns.
class MockCampaignShortlistRepository implements CampaignShortlistRepository {
  final List<CampaignShortlistEntry> _entries = [
    CampaignShortlistEntry(
      id: 'shortlist_001',
      campaignId: 'campaign_001',
      channelId: 'UC_sample_channel_1',
      whyFit: 'Travel niche, engaged 18-35 audience.',
      priceBasisSnapshot: const {'brandPrice': 1200, 'medianViews': 45000},
      addedAt: DateTime.now().subtract(const Duration(days: 5)),
    ),
    CampaignShortlistEntry(
      id: 'shortlist_002',
      campaignId: 'campaign_001',
      channelId: 'UC_sample_channel_2',
      whyFit: 'Tech reviewer, frequent travel content.',
      addedAt: DateTime.now().subtract(const Duration(days: 4)),
    ),
  ];

  @override
  Future<List<CampaignShortlistEntry>> getForCampaign(String campaignId) async {
    return _entries.where((e) => e.campaignId == campaignId).toList()
      ..sort((a, b) => a.addedAt.compareTo(b.addedAt));
  }

  @override
  Future<CampaignShortlistEntry> add(CampaignShortlistEntry entry) async {
    final withId = entry.id.isEmpty
        ? CampaignShortlistEntry(
            id: 'shortlist_${_entries.length + 1}',
            campaignId: entry.campaignId,
            channelId: entry.channelId,
            whyFit: entry.whyFit,
            priceBasisSnapshot: entry.priceBasisSnapshot,
            addedAt: entry.addedAt,
          )
        : entry;
    _entries.add(withId);
    return withId;
  }

  @override
  Future<void> update(CampaignShortlistEntry entry) async {
    final index = _entries.indexWhere((e) => e.id == entry.id);
    if (index == -1) return;
    _entries[index] = entry;
  }

  @override
  Future<void> remove(String id) async {
    _entries.removeWhere((e) => e.id == id);
  }
}
