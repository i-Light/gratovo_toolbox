import 'package:gratovo_toolbox/core/ai/ai_provider.dart';

/// Literal `{{token}}` substitution over a template string, using the
/// values already assembled on [AiDraftContext]. Shared by
/// `TemplateFillAiProvider` (the offline "Generate draft") and any future
/// "preview filled" affordance so both expand exactly the same set.
///
/// Unknown tokens are left untouched — a template author sees `{{foo}}`
/// survive to the draft rather than silently vanishing. Known tokens with
/// no value collapse to an empty string.
String applyTemplateTokens(String text, AiDraftContext context) {
  final recentTitle = context.lastVideoTitle ??
      (context.recentVideoTitles.isNotEmpty
          ? context.recentVideoTitles.first
          : 'your latest video');

  final replacements = <String, String>{
    '{{handle}}': context.influencerHandle,
    '{{name}}': context.influencerName ?? context.influencerHandle,
    '{{recentVideoTitle}}': recentTitle,
    '{{lastVideoTitle}}': recentTitle,
    '{{lastVideoDate}}': context.lastVideoDate ?? '',
    '{{subscriberCount}}': context.subscriberCount ?? '',
    '{{country}}': context.country ?? '',
  };

  var result = text;
  replacements.forEach((token, value) {
    result = result.replaceAll(token, value);
  });
  return result;
}
