import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/ai/ai_provider.dart';
import 'package:gratovo_toolbox/core/ai/apply_template_tokens.dart';

void main() {
  const context = AiDraftContext(
    influencerHandle: '@creator',
    influencerName: 'Jane Creator',
    recentVideoTitles: ['Older upload'],
    lastVideoTitle: 'My newest video',
    lastVideoDate: '14 Aug 2026',
    subscriberCount: '1,234,567',
    country: 'Germany',
  );

  test('fills every known token', () {
    final out = applyTemplateTokens(
      'Hi {{name}} ({{handle}}) — loved "{{lastVideoTitle}}" from '
      '{{lastVideoDate}}. {{subscriberCount}} subs in {{country}}.',
      context,
    );
    expect(
      out,
      'Hi Jane Creator (@creator) — loved "My newest video" from '
      '14 Aug 2026. 1,234,567 subs in Germany.',
    );
  });

  test('recentVideoTitle and lastVideoTitle are interchangeable', () {
    expect(
      applyTemplateTokens('{{recentVideoTitle}}', context),
      'My newest video',
    );
  });

  test('falls back to the handle for {{name}} when no name is set', () {
    const noName = AiDraftContext(influencerHandle: '@x');
    expect(applyTemplateTokens('{{name}}', noName), '@x');
  });

  test('known tokens with no value collapse to empty', () {
    const bare = AiDraftContext(influencerHandle: '@x');
    expect(applyTemplateTokens('[{{country}}]', bare), '[]');
  });

  test('unknown tokens are left untouched', () {
    expect(applyTemplateTokens('{{unknown}}', context), '{{unknown}}');
  });

  test('uses the first recent title when lastVideoTitle is absent', () {
    const fromList = AiDraftContext(
      influencerHandle: '@x',
      recentVideoTitles: ['From the list'],
    );
    expect(
        applyTemplateTokens('{{lastVideoTitle}}', fromList), 'From the list');
  });
}
