import 'package:gratovo_toolbox/core/ai/ai_provider.dart';
import 'package:gratovo_toolbox/core/ai/apply_template_tokens.dart';

/// The only [AiProvider] implementation that exists before Phase 4/5 wire
/// up a real hosted API. Doesn't call any AI model — it deterministically
/// fills `{{handle}}`/`{{recentVideoTitle}}` tokens in the selected
/// template (or writes a minimal generic draft if no template was
/// selected). This is what makes the Outreach page's "Generate draft"
/// button real and demoable today, and it's also the always-available
/// fallback once real providers exist (offline, no API key needed, never
/// fails).
///
/// [AiDraftContext.writingRules] is deliberately NOT applied here — this
/// provider doesn't understand free-text instructions, it only does literal
/// token substitution. A real LLM-backed provider is what actually reads
/// and follows the owner's accumulated writing rules; until one is
/// registered (Phase 4/5), those rules are recorded but not yet acted on.
class TemplateFillAiProvider implements AiProvider {
  @override
  String get id => 'template_fill';

  @override
  String get displayName => 'Template fill (no AI call)';

  @override
  Future<AiDraftResult> draftEmail(AiDraftContext context) async {
    final recentVideoTitle = context.lastVideoTitle ??
        (context.recentVideoTitles.isNotEmpty
            ? context.recentVideoTitles.first
            : 'your latest video');

    if (context.templateSubject != null && context.templateBody != null) {
      return AiDraftResult(
        subject: applyTemplateTokens(context.templateSubject!, context),
        body: applyTemplateTokens(context.templateBody!, context),
      );
    }

    final criteriaNote = context.relevanceCriteria.isNotEmpty
        ? ' — really liked how it covers ${context.relevanceCriteria.join(', ')}'
        : '';

    return AiDraftResult(
      subject: 'Quick collab idea for ${context.influencerHandle}',
      body: 'Hi ${context.influencerHandle} team,\n\n'
          "I'm reaching out from Gratovo about a possible paid collab. "
          'Caught your video "$recentVideoTitle"$criteriaNote.\n\n'
          'Would you be open to a quick chat?\n\n'
          'Best,\nGratovo',
    );
  }
}
