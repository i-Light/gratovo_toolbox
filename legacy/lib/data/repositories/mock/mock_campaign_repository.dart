import 'package:gratovo_toolbox/data/models/campaign.dart';
import 'package:gratovo_toolbox/data/repositories/campaign_repository.dart';

/// In-memory [CampaignRepository], seeded with a couple of sample campaigns
/// against `MockBrandRepository`'s brands.
class MockCampaignRepository implements CampaignRepository {
  final List<Campaign> _campaigns = [
    Campaign(
      id: 'campaign_001',
      brandId: 'brand_001',
      name: 'Spring safe-travel push',
      notes: 'Focused on the privacy and safe-travel-wifi angle.',
      startDate: DateTime.now().subtract(const Duration(days: 20)),
      createdAt: DateTime.now().subtract(const Duration(days: 20)),
      updatedAt: DateTime.now().subtract(const Duration(days: 3)),
    ),
    Campaign(
      id: 'campaign_002',
      brandId: 'brand_002',
      name: 'Template gallery launch',
      status: CampaignStatus.closed,
      startDate: DateTime.now().subtract(const Duration(days: 90)),
      liveDate: DateTime.now().subtract(const Duration(days: 60)),
      createdAt: DateTime.now().subtract(const Duration(days: 90)),
      updatedAt: DateTime.now().subtract(const Duration(days: 55)),
    ),
  ];

  @override
  Future<List<Campaign>> getAll() async => List.unmodifiable(_campaigns);

  @override
  Future<Campaign?> getById(String id) async {
    for (final campaign in _campaigns) {
      if (campaign.id == id) return campaign;
    }
    return null;
  }

  @override
  Future<List<Campaign>> getByBrand(String brandId) async =>
      _campaigns.where((c) => c.brandId == brandId).toList();

  @override
  Future<Campaign> create(Campaign campaign) async {
    final withId = campaign.id.isEmpty
        ? Campaign(
            id: 'campaign_${_campaigns.length + 1}',
            brandId: campaign.brandId,
            name: campaign.name,
            notes: campaign.notes,
            status: campaign.status,
            startDate: campaign.startDate,
            liveDate: campaign.liveDate,
            createdAt: campaign.createdAt,
            updatedAt: campaign.updatedAt,
          )
        : campaign;
    _campaigns.add(withId);
    return withId;
  }

  @override
  Future<void> update(Campaign campaign) async {
    final index = _campaigns.indexWhere((c) => c.id == campaign.id);
    if (index == -1) return;
    _campaigns[index] = campaign;
  }

  @override
  Future<void> delete(String id) async {
    _campaigns.removeWhere((c) => c.id == id);
  }
}
