import 'package:gratovo_toolbox/data/models/deal.dart';

/// How the UI reads deals — the brand-influencer join records that carry
/// all pipeline/negotiation status (see deal.dart's doc comment on why
/// status lives here and not on Influencer). See
/// influencer_repository.dart's doc comment for the mock/Supabase swap
/// pattern this follows.
abstract class DealRepository {
  Future<List<Deal>> getAll();

  Future<Deal?> getById(String id);

  /// Every deal ever run with this influencer, in reverse-chronological
  /// order — an influencer's full engagement history, exactly what makes
  /// "looped multiple times without losing history" true in the UI.
  Future<List<Deal>> getByInfluencer(String influencerId);

  Future<List<Deal>> getByBrand(String brandId);

  /// Starts a deal (fix #6). An empty [Deal.id] gets a fresh one; the saved
  /// deal comes back.
  Future<Deal> create(Deal deal);

  /// Replaces the deal's terms — price, payout, currency, deliverables,
  /// deadline, payment terms, tracking link — as one unit. The caller logs
  /// what changed.
  Future<void> updateTerms(String id, DealTerms terms);

  /// Records one side's contract: its link, where it stands, when it was
  /// signed. The order rule lives in [canMarkBrandSigned], for the screen.
  Future<void> updateContract(
    String id,
    ContractParty party,
    DealContract contract,
  );

  /// Moves a deal to a new stage. This is the one write path that matters
  /// most in the whole app — see deal.dart's doc comment: a Deal's stage is
  /// the single source of truth for pipeline status, so this is the only
  /// place that status ever changes.
  Future<void> updateStage(String id, DealStage stage);

  Future<void> updateNotes(String id, String notes);

  /// Sets the manually-entered [Deal.workingDaysEstimate]. The one and only
  /// write path for that field — nothing else in the app may set it,
  /// including the auto-suggested estimate's "use this" action, which calls
  /// this exact method rather than writing the field on the caller's behalf.
  /// [workingDays] null clears it.
  Future<void> updateWorkingDaysEstimate(String id, int? workingDays);

  /// Assigns or unassigns who on the team owns this deal. Null clears it.
  Future<void> updateOwner(String id, String? ownerId);

  /// Groups this deal under a campaign, or ungroups it. Null clears it.
  Future<void> updateCampaign(String id, String? campaignId);

  /// Replaces every manual payment-tracking field at once — the Finance
  /// page's one form covers all of them together, so there is one write
  /// rather than seven. Pass the full set each time; a field left null is
  /// written as cleared, not left alone.
  Future<void> updatePayment(
    String id, {
    required String currency,
    DateTime? brandInvoiceSentAt,
    DateTime? brandInvoicePaidAt,
    DateTime? creatorPayoutDueAt,
    DateTime? creatorPayoutPaidAt,
    String? paymentMethod,
    String? paymentReference,
  });
}
