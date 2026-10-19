/// A Deal's lifecycle. Two terminal states — [closed] (the deal completed
/// and paid out) and [lost] (it fell through) — are both "not active"; see
/// [Deal.isActive].
///
/// This is the ONLY place pipeline/engagement status lives (see the [Deal]
/// doc comment below) — Influencer only
/// tracks the shallow new/shortlisted/rejected sourcing gate. A single
/// influencer can have many Deals over time (each new outreach round is a
/// new Deal row, not an overwrite), which is exactly what lets the pipeline
/// "loop multiple times... without losing previous history."
enum DealStage {
  proposed,
  negotiating,
  agreed,
  contractSent,
  signed,
  live,
  closed,
  lost;

  bool get isTerminal => this == DealStage.closed || this == DealStage.lost;
}

/// Where one of a deal's two contracts stands.
enum ContractStatus {
  none,
  draft,
  sent,
  signed;

  static ContractStatus fromWire(Object? value) => ContractStatus.values
      .firstWhere((s) => s.name == value, orElse: () => ContractStatus.none);
}

/// The two contracts a deal has (decision contract-order): the brand's
/// contract is the template; the creator signs theirs first, the brand after.
enum ContractParty { creator, brand }

/// One side's contract: the link, where it stands, when it was signed.
class DealContract {
  const DealContract({
    this.url,
    this.status = ContractStatus.none,
    this.signedAt,
  });

  final String? url;
  final ContractStatus status;
  final DateTime? signedAt;
}

/// A deal's editable terms, saved as one unit from the deal page.
class DealTerms {
  const DealTerms({
    required this.brandPrice,
    required this.influencerPayout,
    required this.currency,
    this.deliverables,
    this.deadline,
    this.paymentTerms,
    this.trackingLink,
  });

  final double brandPrice;
  final double influencerPayout;
  final String currency;
  final String? deliverables;
  final DateTime? deadline;
  final String? paymentTerms;
  final String? trackingLink;
}

/// The course's order (decision contract-order): the brand's signature is
/// recorded only once the creator has signed.
bool canMarkBrandSigned(Deal deal) =>
    deal.creatorContract.status == ContractStatus.signed;

/// The brand-influencer join entity, and the central data-model decision of
/// this rebuild: a broker deal is a two-sided price negotiation (the brand
/// pays [brandPrice], the influencer receives [influencerPayout], the
/// spread the agency keeps is [margin]), and status/history belongs here —
/// not on [Influencer] — so re-engaging the same influencer for a new
/// campaign is a brand new [Deal] row, and nothing about the first
/// engagement is ever lost or overwritten.
class Deal {
  const Deal({
    required this.id,
    required this.brandId,
    required this.influencerId,
    required this.stage,
    required this.brandPrice,
    required this.influencerPayout,
    required this.createdAt,
    required this.updatedAt,
    this.deliverables,
    this.deadline,
    this.contractUrl,
    this.notes,
    this.workingDaysEstimate,
    this.campaignId,
    this.ownerId,
    this.currency = 'USD',
    this.brandInvoiceSentAt,
    this.brandInvoicePaidAt,
    this.creatorPayoutDueAt,
    this.creatorPayoutPaidAt,
    this.paymentMethod,
    this.paymentReference,
    this.paymentTerms,
    this.trackingLink,
    this.creatorContract = const DealContract(),
    this.brandContract = const DealContract(),
  });

  final String id;
  final String brandId;
  final String influencerId;
  final DealStage stage;

  /// What the brand pays, in the brand's currency (see [Brand.budget]'s
  /// same USD-for-now caveat).
  final double brandPrice;

  /// What the influencer actually receives. `brandPrice - influencerPayout`
  /// is the agency's cut — see [margin].
  final double influencerPayout;

  final String? deliverables;
  final DateTime? deadline;

  /// Link to the signed contract / attachment, once one exists. A plain URL
  /// string for now (e.g. a shared-drive link) rather than an uploaded
  /// blob — file storage in the shared backend is a later decision once the backend
  /// is actually wired up.
  final String? contractUrl;

  /// Negotiation/relationship notes specific to *this* deal round (as
  /// opposed to [Influencer.notes], which persists across every round).
  final String? notes;

  /// How many working days this round took/is taking, per the owner's ask
  /// to eventually infer this from reply timestamps. Manually entered for
  /// now — nothing populates it automatically until outreach reply
  /// tracking exists (Phase 3).
  final int? workingDaysEstimate;

  /// The campaign this deal was sourced under, if any — most deals have
  /// none; a campaign is an optional grouping, not a requirement to log a
  /// negotiation. See `lib/data/models/campaign.dart`.
  final String? campaignId;

  /// Who on the team owns this deal. Nullable: an unassigned deal is a
  /// normal, common state, not a data-entry gap to flag.
  final String? ownerId;

  /// ISO 4217 code. Defaults to `'USD'` rather than null so every amount on
  /// screen always has a currency to show beside it.
  final String currency;

  /// When the brand was invoiced and when that invoice was paid — two
  /// separate manual-entry timestamps, per the ledger-not-automation design
  /// (Path A): nobody's bank feed is wired up, so both are set by a person
  /// who checked.
  final DateTime? brandInvoiceSentAt;
  final DateTime? brandInvoicePaidAt;

  /// When the influencer's payout is due and when it actually went out —
  /// same manual-entry shape as the brand invoice pair above, tracked
  /// separately because the two sides of a deal rarely move together.
  final DateTime? creatorPayoutDueAt;
  final DateTime? creatorPayoutPaidAt;

  /// Free text — "wire", "PayPal", "Instapay" — rather than a fixed
  /// vocabulary, since a broker's actual payment rails vary far more than a
  /// short enum could keep up with.
  final String? paymentMethod;

  /// A wire reference, transaction id, or similar — whatever a bank
  /// statement will actually show, for reconciling the ledger against it
  /// later.
  final String? paymentReference;

  final DateTime createdAt;
  final DateTime updatedAt;

  /// Set per deal; there is no default (decision payment-terms).
  final String? paymentTerms;

  /// The brand's tracking link, for the 30-day report's clicks.
  final String? trackingLink;

  final DealContract creatorContract;
  final DealContract brandContract;

  /// The agency's cut on this deal.
  double get margin => brandPrice - influencerPayout;

  /// False once a deal has reached [DealStage.closed] or [DealStage.lost].
  /// Used everywhere "how many deals are still moving" is asked (e.g. the
  /// Dashboard's active-negotiations count) instead of re-deriving the same
  /// stage check in every call site.
  bool get isActive => !stage.isTerminal;

  bool get isWon => stage == DealStage.closed;

  /// [updatedAt] defaults to now — changing a deal's stage or notes is
  /// exactly the kind of edit that should bump it, so callers have to
  /// deliberately opt out (pass an explicit value) rather than deliberately
  /// opt in.
  Deal copyWith({DealStage? stage, String? notes, DateTime? updatedAt}) {
    return Deal(
      id: id,
      brandId: brandId,
      influencerId: influencerId,
      stage: stage ?? this.stage,
      brandPrice: brandPrice,
      influencerPayout: influencerPayout,
      deliverables: deliverables,
      deadline: deadline,
      contractUrl: contractUrl,
      notes: notes ?? this.notes,
      workingDaysEstimate: workingDaysEstimate,
      campaignId: campaignId,
      ownerId: ownerId,
      currency: currency,
      brandInvoiceSentAt: brandInvoiceSentAt,
      brandInvoicePaidAt: brandInvoicePaidAt,
      creatorPayoutDueAt: creatorPayoutDueAt,
      creatorPayoutPaidAt: creatorPayoutPaidAt,
      paymentMethod: paymentMethod,
      paymentReference: paymentReference,
      paymentTerms: paymentTerms,
      trackingLink: trackingLink,
      creatorContract: creatorContract,
      brandContract: brandContract,
      createdAt: createdAt,
      updatedAt: updatedAt ?? DateTime.now(),
    );
  }

  /// This deal with one or both contracts replaced.
  Deal copyWithContracts({DealContract? creator, DealContract? brand}) => Deal(
        id: id,
        brandId: brandId,
        influencerId: influencerId,
        stage: stage,
        brandPrice: brandPrice,
        influencerPayout: influencerPayout,
        deliverables: deliverables,
        deadline: deadline,
        contractUrl: contractUrl,
        notes: notes,
        workingDaysEstimate: workingDaysEstimate,
        campaignId: campaignId,
        ownerId: ownerId,
        currency: currency,
        brandInvoiceSentAt: brandInvoiceSentAt,
        brandInvoicePaidAt: brandInvoicePaidAt,
        creatorPayoutDueAt: creatorPayoutDueAt,
        creatorPayoutPaidAt: creatorPayoutPaidAt,
        paymentMethod: paymentMethod,
        paymentReference: paymentReference,
        paymentTerms: paymentTerms,
        trackingLink: trackingLink,
        creatorContract: creator ?? creatorContract,
        brandContract: brand ?? brandContract,
        createdAt: createdAt,
        updatedAt: updatedAt,
      );

  /// This deal with [terms] applied.
  Deal withTerms(DealTerms terms) => Deal(
        id: id,
        brandId: brandId,
        influencerId: influencerId,
        stage: stage,
        brandPrice: terms.brandPrice,
        influencerPayout: terms.influencerPayout,
        deliverables: terms.deliverables,
        deadline: terms.deadline,
        contractUrl: contractUrl,
        notes: notes,
        workingDaysEstimate: workingDaysEstimate,
        campaignId: campaignId,
        ownerId: ownerId,
        currency: terms.currency,
        brandInvoiceSentAt: brandInvoiceSentAt,
        brandInvoicePaidAt: brandInvoicePaidAt,
        creatorPayoutDueAt: creatorPayoutDueAt,
        creatorPayoutPaidAt: creatorPayoutPaidAt,
        paymentMethod: paymentMethod,
        paymentReference: paymentReference,
        paymentTerms: terms.paymentTerms,
        trackingLink: terms.trackingLink,
        creatorContract: creatorContract,
        brandContract: brandContract,
        createdAt: createdAt,
        updatedAt: DateTime.now(),
      );
}
