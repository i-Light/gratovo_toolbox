import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/ai/ai_provider.dart';
import 'package:gratovo_toolbox/core/ai/template_fill_ai_provider.dart';

void main() {
  group('TemplateFillAiProvider', () {
    final provider = TemplateFillAiProvider();

    test('has a stable id and a human-readable display name', () {
      expect(provider.id, 'template_fill');
      expect(provider.displayName, isNotEmpty);
    });

    test('fills {{handle}} and {{recentVideoTitle}} tokens from a template',
        () async {
      final result = await provider.draftEmail(
        const AiDraftContext(
          influencerHandle: '@TechWithTaha',
          templateSubject: 'Quick collab idea for {{handle}}',
          templateBody: 'Loved "{{recentVideoTitle}}" — {{handle}} team, '
              "let's talk.",
          recentVideoTitles: ['Unboxing the newest flagship'],
        ),
      );

      expect(result.subject, 'Quick collab idea for @TechWithTaha');
      expect(
        result.body,
        'Loved "Unboxing the newest flagship" — @TechWithTaha team, '
        "let's talk.",
      );
    });

    test(
        'falls back to "your latest video" when no recent video titles are '
        'given', () async {
      final result = await provider.draftEmail(
        const AiDraftContext(
          influencerHandle: '@NoVideosYet',
          templateSubject: 'Hi {{handle}}',
          templateBody: 'Re: {{recentVideoTitle}}',
        ),
      );

      expect(result.subject, 'Hi @NoVideosYet');
      expect(result.body, 'Re: your latest video');
    });

    test('writes a generic draft when no template is selected', () async {
      final result = await provider.draftEmail(
        const AiDraftContext(
          influencerHandle: '@WanderlustWithSara',
          recentVideoTitles: ['A week in the Alps'],
          relevanceCriteria: ['travel gear mentions'],
        ),
      );

      expect(result.subject, contains('@WanderlustWithSara'));
      expect(result.body, contains('A week in the Alps'));
      expect(result.body, contains('travel gear mentions'));
    });

    test('a template is only used when both subject and body are present',
        () async {
      final result = await provider.draftEmail(
        const AiDraftContext(
          influencerHandle: '@PartialTemplate',
          templateSubject: 'Subject only, no body',
        ),
      );

      // No templateBody was given, so this should fall through to the
      // generic draft rather than crash on a null body.
      expect(result.subject, contains('@PartialTemplate'));
    });
  });
}
