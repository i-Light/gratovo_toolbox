/// The team's accumulating rules for how outreach messages should be
/// written ("my own custom rules for writing emails that I'll discover as I
/// go" — a direct requirement from the Q&A). Fed into every AI draft
/// alongside the template and influencer context
/// (`core/ai/ai_provider.dart`'s `AiDraftContext.writingRules`).
///
/// Shared team-wide (backed by the `writing_rules` table) rather than one
/// device's SharedPreferences, so a rule one person discovers applies to
/// everyone's drafts. The list is tiny and order matters, so the write side
/// is a whole-list `replace` — the same shape as
/// `InfluencerRepository.updateContacts`.
abstract class WritingRulesRepository {
  /// Every rule, in display / apply order.
  Future<List<String>> getAll();

  /// Overwrites the stored list with [rules], in the given order.
  Future<void> replace(List<String> rules);
}
