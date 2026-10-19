import 'package:gratovo_toolbox/data/models/brand.dart';
import 'package:gratovo_toolbox/data/repositories/brand_repository.dart';

/// In-memory [BrandRepository], seeded with three sample clients.
class MockBrandRepository implements BrandRepository {
  final List<Brand> _brands = [
    Brand(
      id: 'brand_001',
      name: 'NordVPN',
      contactName: 'Alex Turner',
      contactEmail: 'alex.turner@nordvpn-partners.example',
      website: 'https://nordvpn.com',
      budget: 15000,
      campaignBrief:
          'VPN sponsorship — 60-90s mid-roll read, focused on the privacy '
          'and safe-travel-wifi angle.',
      preferredCriteria: const [
        'tech or travel niche',
        'engaged audience 18-35',
        'min 50k subscribers',
      ],
      createdAt: DateTime.now().subtract(const Duration(days: 200)),
    ),
    Brand(
      id: 'brand_002',
      name: 'Notion',
      contactName: 'Priya Shah',
      contactEmail: 'priya.shah@notion-partners.example',
      website: 'https://notion.so',
      budget: 8000,
      campaignBrief:
          'Promoting the new template gallery — dedicated video preferred '
          'over a mid-roll spot.',
      preferredCriteria: const [
        'productivity or business niche',
        'min 30k subscribers',
      ],
      createdAt: DateTime.now().subtract(const Duration(days: 140)),
    ),
    Brand(
      id: 'brand_003',
      name: 'Skillshare',
      contactName: 'Omar Haddad',
      contactEmail: 'omar.haddad@skillshare-partners.example',
      website: 'https://skillshare.com',
      budget: 12000,
      campaignBrief:
          'Course-platform sponsorship — works with any niche that has an '
          'engaged how-to/tutorial audience.',
      preferredCriteria: const [
        'how-to / tutorial format',
        'min 40k subscribers',
      ],
      createdAt: DateTime.now().subtract(const Duration(days: 260)),
    ),
  ];

  @override
  Future<List<Brand>> getAll() async => List.unmodifiable(_brands);

  @override
  Future<Brand?> getById(String id) async {
    for (final brand in _brands) {
      if (brand.id == id) return brand;
    }
    return null;
  }

  int _next = 4;

  @override
  Future<Brand> create(Brand brand) async {
    final saved = Brand(
      id: brand.id.isEmpty
          ? 'brand_${(_next++).toString().padLeft(3, '0')}'
          : brand.id,
      name: brand.name,
      createdAt: brand.createdAt,
      contactName: brand.primaryContact?.name ?? brand.contactName,
      contactEmail: brand.primaryContact?.email ?? brand.contactEmail,
      contactPhone: brand.contactPhone,
      website: brand.website,
      budget: brand.budget,
      budgetCurrency: brand.budgetCurrency,
      campaignBrief: brand.campaignBrief,
      preferredCriteria: brand.preferredCriteria,
      notes: brand.notes,
      category: brand.category,
      country: brand.country,
      contacts: brand.contacts,
      source: brand.source,
    );
    _brands.add(saved);
    return saved;
  }

  @override
  Future<void> update(Brand brand) async {
    final index = _brands.indexWhere((b) => b.id == brand.id);
    if (index == -1) return;
    _brands[index] = brand;
  }

  @override
  Future<void> updateNotes(String id, String notes) async {
    final index = _brands.indexWhere((b) => b.id == id);
    if (index == -1) return;
    _brands[index] = _brands[index].copyWith(notes: notes);
  }
}
