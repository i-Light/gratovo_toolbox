import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/repositories/deal_repository.dart';

/// In-memory [DealRepository], seeded to show every stage of the pipeline
/// at once — including `inf_007` (@MoneyMovesWithKarim) having *two* deals
/// with two different brands, one closed months ago and one being
/// negotiated right now. That's the concrete demonstration of "an
/// influencer can loop through the pipeline again without losing history"
/// that the [Deal] model is built around.
class MockDealRepository implements DealRepository {
  final List<Deal> _deals = [
    Deal(
      id: 'deal_001',
      brandId: 'brand_001',
      influencerId: 'inf_001',
      stage: DealStage.signed,
      brandPrice: 3000,
      influencerPayout: 2400,
      deliverables: '60s mid-roll integration + pinned comment for 7 days',
      deadline: DateTime.now().add(const Duration(days: 10)),
      createdAt: DateTime.now().subtract(const Duration(days: 18)),
      updatedAt: DateTime.now().subtract(const Duration(days: 2)),
      workingDaysEstimate: 6,
    ),
    Deal(
      id: 'deal_002',
      brandId: 'brand_003',
      influencerId: 'inf_007',
      stage: DealStage.closed,
      brandPrice: 2500,
      influencerPayout: 2000,
      deliverables: 'Dedicated 8-minute video',
      notes: 'Smooth first engagement — paid on time, open to more work.',
      createdAt: DateTime.now().subtract(const Duration(days: 130)),
      updatedAt: DateTime.now().subtract(const Duration(days: 95)),
      workingDaysEstimate: 4,
    ),
    Deal(
      id: 'deal_003',
      brandId: 'brand_001',
      influencerId: 'inf_007',
      stage: DealStage.negotiating,
      brandPrice: 2800,
      influencerPayout: 2100,
      deliverables: '60s mid-roll integration',
      notes: 'Countered our first offer — waiting on brand approval to '
          'come up to \$2,800.',
      createdAt: DateTime.now().subtract(const Duration(days: 6)),
      updatedAt: DateTime.now().subtract(const Duration(days: 1)),
    ),
    Deal(
      id: 'deal_004',
      brandId: 'brand_002',
      influencerId: 'inf_003',
      stage: DealStage.proposed,
      brandPrice: 1800,
      influencerPayout: 1400,
      deliverables: 'Dedicated video featuring the new template gallery',
      createdAt: DateTime.now().subtract(const Duration(days: 3)),
      updatedAt: DateTime.now().subtract(const Duration(days: 3)),
    ),
    Deal(
      id: 'deal_005',
      brandId: 'brand_001',
      influencerId: 'inf_006',
      stage: DealStage.contractSent,
      brandPrice: 2200,
      influencerPayout: 1700,
      deliverables: '90s integration in a travel-wifi-themed video',
      deadline: DateTime.now().add(const Duration(days: 5)),
      createdAt: DateTime.now().subtract(const Duration(days: 12)),
      updatedAt: DateTime.now().subtract(const Duration(hours: 20)),
      workingDaysEstimate: 5,
    ),
    Deal(
      id: 'deal_006',
      brandId: 'brand_003',
      influencerId: 'inf_004',
      stage: DealStage.lost,
      brandPrice: 3500,
      influencerPayout: 2600,
      notes: 'Brand passed — audience age mismatch confirmed after review.',
      createdAt: DateTime.now().subtract(const Duration(days: 45)),
      updatedAt: DateTime.now().subtract(const Duration(days: 38)),
    ),
  ];

  @override
  Future<List<Deal>> getAll() async => List.unmodifiable(_deals);

  @override
  Future<Deal?> getById(String id) async {
    for (final deal in _deals) {
      if (deal.id == id) return deal;
    }
    return null;
  }

  @override
  Future<List<Deal>> getByInfluencer(String influencerId) async {
    final matches = _deals.where((d) => d.influencerId == influencerId).toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return matches;
  }

  @override
  Future<List<Deal>> getByBrand(String brandId) async {
    final matches = _deals.where((d) => d.brandId == brandId).toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return matches;
  }

  @override
  Future<void> updateStage(String id, DealStage stage) async {
    _replace(id, (d) => d.copyWith(stage: stage));
  }

  int _created = 0;

  @override
  Future<Deal> create(Deal deal) async {
    final saved = deal.id.isEmpty
        ? Deal(
            id: 'deal_new_${_created++}',
            brandId: deal.brandId,
            influencerId: deal.influencerId,
            stage: deal.stage,
            brandPrice: deal.brandPrice,
            influencerPayout: deal.influencerPayout,
            deliverables: deal.deliverables,
            deadline: deal.deadline,
            notes: deal.notes,
            campaignId: deal.campaignId,
            ownerId: deal.ownerId,
            currency: deal.currency,
            paymentTerms: deal.paymentTerms,
            trackingLink: deal.trackingLink,
            createdAt: deal.createdAt,
            updatedAt: deal.updatedAt,
          )
        : deal;
    _deals.add(saved);
    return saved;
  }

  @override
  Future<void> updateTerms(String id, DealTerms terms) async {
    _replace(id, (d) => d.withTerms(terms));
  }

  @override
  Future<void> updateContract(
    String id,
    ContractParty party,
    DealContract contract,
  ) async {
    _replace(
      id,
      (d) => party == ContractParty.creator
          ? d.copyWithContracts(creator: contract)
          : d.copyWithContracts(brand: contract),
    );
  }

  @override
  Future<void> updateNotes(String id, String notes) async {
    _replace(id, (d) => d.copyWith(notes: notes));
  }

  @override
  Future<void> updateWorkingDaysEstimate(String id, int? workingDays) async {
    // Bypasses [Deal.copyWith], which has no way to null a field out — this
    // is the one field that needs to (see updateWorkingDaysEstimate's own
    // doc: null clears it).
    _replace(
      id,
      (d) => Deal(
        id: d.id,
        brandId: d.brandId,
        influencerId: d.influencerId,
        stage: d.stage,
        brandPrice: d.brandPrice,
        influencerPayout: d.influencerPayout,
        deliverables: d.deliverables,
        deadline: d.deadline,
        contractUrl: d.contractUrl,
        notes: d.notes,
        workingDaysEstimate: workingDays,
        campaignId: d.campaignId,
        ownerId: d.ownerId,
        currency: d.currency,
        brandInvoiceSentAt: d.brandInvoiceSentAt,
        brandInvoicePaidAt: d.brandInvoicePaidAt,
        creatorPayoutDueAt: d.creatorPayoutDueAt,
        creatorPayoutPaidAt: d.creatorPayoutPaidAt,
        paymentMethod: d.paymentMethod,
        paymentReference: d.paymentReference,
        paymentTerms: d.paymentTerms,
        trackingLink: d.trackingLink,
        creatorContract: d.creatorContract,
        brandContract: d.brandContract,
        createdAt: d.createdAt,
        updatedAt: DateTime.now(),
      ),
    );
  }

  @override
  Future<void> updateOwner(String id, String? ownerId) async {
    _replace(id, (d) => _withPatch(d, ownerId: () => ownerId));
  }

  @override
  Future<void> updateCampaign(String id, String? campaignId) async {
    _replace(id, (d) => _withPatch(d, campaignId: () => campaignId));
  }

  @override
  Future<void> updatePayment(
    String id, {
    required String currency,
    DateTime? brandInvoiceSentAt,
    DateTime? brandInvoicePaidAt,
    DateTime? creatorPayoutDueAt,
    DateTime? creatorPayoutPaidAt,
    String? paymentMethod,
    String? paymentReference,
  }) async {
    _replace(
      id,
      (d) => _withPatch(
        d,
        currency: currency,
        brandInvoiceSentAt: () => brandInvoiceSentAt,
        brandInvoicePaidAt: () => brandInvoicePaidAt,
        creatorPayoutDueAt: () => creatorPayoutDueAt,
        creatorPayoutPaidAt: () => creatorPayoutPaidAt,
        paymentMethod: () => paymentMethod,
        paymentReference: () => paymentReference,
      ),
    );
  }

  /// Bypasses [Deal.copyWith] the same way [updateWorkingDaysEstimate] does,
  /// for fields that need to be nullable-settable. Each nullable field takes
  /// a thunk rather than a bare value so "not passed" (keep current) and
  /// "passed as null" (clear it) stay distinguishable.
  Deal _withPatch(
    Deal d, {
    String? Function()? ownerId,
    String? Function()? campaignId,
    String? currency,
    DateTime? Function()? brandInvoiceSentAt,
    DateTime? Function()? brandInvoicePaidAt,
    DateTime? Function()? creatorPayoutDueAt,
    DateTime? Function()? creatorPayoutPaidAt,
    String? Function()? paymentMethod,
    String? Function()? paymentReference,
  }) {
    return Deal(
      id: d.id,
      brandId: d.brandId,
      influencerId: d.influencerId,
      stage: d.stage,
      brandPrice: d.brandPrice,
      influencerPayout: d.influencerPayout,
      deliverables: d.deliverables,
      deadline: d.deadline,
      contractUrl: d.contractUrl,
      notes: d.notes,
      workingDaysEstimate: d.workingDaysEstimate,
      campaignId: campaignId != null ? campaignId() : d.campaignId,
      ownerId: ownerId != null ? ownerId() : d.ownerId,
      currency: currency ?? d.currency,
      brandInvoiceSentAt: brandInvoiceSentAt != null
          ? brandInvoiceSentAt()
          : d.brandInvoiceSentAt,
      brandInvoicePaidAt: brandInvoicePaidAt != null
          ? brandInvoicePaidAt()
          : d.brandInvoicePaidAt,
      creatorPayoutDueAt: creatorPayoutDueAt != null
          ? creatorPayoutDueAt()
          : d.creatorPayoutDueAt,
      creatorPayoutPaidAt: creatorPayoutPaidAt != null
          ? creatorPayoutPaidAt()
          : d.creatorPayoutPaidAt,
      paymentMethod: paymentMethod != null ? paymentMethod() : d.paymentMethod,
      paymentReference:
          paymentReference != null ? paymentReference() : d.paymentReference,
      paymentTerms: d.paymentTerms,
      trackingLink: d.trackingLink,
      creatorContract: d.creatorContract,
      brandContract: d.brandContract,
      createdAt: d.createdAt,
      updatedAt: DateTime.now(),
    );
  }

  void _replace(String id, Deal Function(Deal) update) {
    final index = _deals.indexWhere((d) => d.id == id);
    if (index == -1) return;
    _deals[index] = update(_deals[index]);
  }
}
