/// A task an AI provider can be asked to do. Only [emailDraft] exists
/// today; the enum exists so a future task (e.g. summarizing a channel, or
/// drafting a contract note) can pick its own provider independently, per
/// the owner's explicit requirement that provider choice be configurable
/// per task, not just once globally.
enum AiTask {
  emailDraft;
}

/// Everything an [AiProvider] needs to draft an outreach email. Assembled
/// by the Outreach screen from the influencer's recent videos and
/// relevance criteria (Influencer Profile, Phase 2), the selected template
/// (if any), and the owner's own accumulating writing rules
/// (`features/outreach/application/writing_rules_controller.dart`).
class AiDraftContext {
  const AiDraftContext({
    required this.influencerHandle,
    this.influencerName,
    this.templateSubject,
    this.templateBody,
    this.recentVideoTitles = const [],
    this.relevanceCriteria = const [],
    this.writingRules = const [],
    this.lastVideoTitle,
    this.lastVideoDate,
    this.subscriberCount,
    this.country,
  });

  final String influencerHandle;

  /// The influencer's real name when known, for the `{{name}}` token.
  final String? influencerName;
  final String? templateSubject;
  final String? templateBody;
  final List<String> recentVideoTitles;
  final List<String> relevanceCriteria;
  final List<String> writingRules;

  /// Preformatted extras for the richer template tokens — assembled by the
  /// compose controller so the AI layer never touches `Influencer`,
  /// `Video`, `intl`, or the timezone subsystem. All optional; a missing
  /// value renders its token as an empty string.
  final String? lastVideoTitle;
  final String? lastVideoDate;
  final String? subscriberCount;
  final String? country;
}

class AiDraftResult {
  const AiDraftResult({required this.subject, required this.body});

  final String subject;
  final String body;
}

/// Pluggable AI backend for drafting outreach content. The whole point of
/// this interface — per the owner's explicit "never lock me into one AI
/// vendor" requirement — is that the Outreach screen only ever depends on
/// this, never on a specific vendor's SDK/HTTP client. `TemplateFillAiProvider`
/// (the only implementation that exists today) doesn't call any AI API at
/// all; Phase 4's Settings "AI Providers" section is where real hosted
/// providers (Claude, an OpenAI-compatible endpoint, eventually a local
/// model) get registered and made selectable per user, per task — see
/// ai_provider_registry.dart.
abstract class AiProvider {
  String get id;
  String get displayName;

  Future<AiDraftResult> draftEmail(AiDraftContext context);
}
