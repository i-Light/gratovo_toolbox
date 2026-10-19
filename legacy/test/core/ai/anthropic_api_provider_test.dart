import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/ai/ai_provider.dart';
import 'package:gratovo_toolbox/core/ai/anthropic_api_provider.dart';
import 'package:gratovo_toolbox/data/models/ai_provider_config.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const _config = AiProviderConfig(
  id: 'aiprov_test',
  displayName: 'Test Claude',
  apiKey: 'sk-ant-test-key',
  model: 'claude-sonnet-4-5',
);

const _context = AiDraftContext(influencerHandle: '@TestChannel');

void main() {
  group('AnthropicApiProvider', () {
    test('id is namespaced by the config id; displayName passes through', () {
      final provider = AnthropicApiProvider(config: _config);
      expect(provider.id, 'anthropic:aiprov_test');
      expect(provider.displayName, 'Test Claude');
    });

    test('throws before making a request when the API key is blank', () async {
      var requestMade = false;
      final client = MockClient((request) async {
        requestMade = true;
        return http.Response('{}', 200);
      });
      final provider = AnthropicApiProvider(
        config: _config.copyWith(apiKey: ''),
        client: client,
      );

      await expectLater(
        () => provider.draftEmail(_context),
        throwsA(isA<AiProviderException>()),
      );
      expect(requestMade, isFalse);
    });

    test('sends the API key, model, and a JSON body to the Messages API',
        () async {
      http.Request? captured;
      final client = MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'content': [
              {
                'text': jsonEncode({
                  'subject': 'Quick collab idea',
                  'body': 'Hi there!',
                }),
              },
            ],
          }),
          200,
        );
      });
      final provider = AnthropicApiProvider(config: _config, client: client);

      final result = await provider.draftEmail(_context);

      expect(result.subject, 'Quick collab idea');
      expect(result.body, 'Hi there!');
      expect(captured, isNotNull);
      expect(captured!.headers['x-api-key'], 'sk-ant-test-key');
      expect(captured!.headers['anthropic-version'], isNotEmpty);
      final sentBody = jsonDecode(captured!.body) as Map<String, dynamic>;
      expect(sentBody['model'], 'claude-sonnet-4-5');
    });

    test('throws AiProviderException on a non-200 response', () async {
      final client = MockClient(
        (request) async => http.Response('unauthorized', 401),
      );
      final provider = AnthropicApiProvider(config: _config, client: client);

      await expectLater(
        () => provider.draftEmail(_context),
        throwsA(
          isA<AiProviderException>().having(
            (e) => e.message,
            'message',
            contains('401'),
          ),
        ),
      );
    });

    test('throws AiProviderException when the response has no content',
        () async {
      final client = MockClient(
        (request) async => http.Response(jsonEncode({'content': []}), 200),
      );
      final provider = AnthropicApiProvider(config: _config, client: client);

      await expectLater(
        () => provider.draftEmail(_context),
        throwsA(isA<AiProviderException>()),
      );
    });

    test(
        'falls back to the raw text as the body when the model does not '
        'return valid JSON', () async {
      final client = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'content': [
              {'text': 'Sure, here is a draft: Hi there, would you like...'},
            ],
          }),
          200,
        );
      });
      final provider = AnthropicApiProvider(config: _config, client: client);

      final result = await provider.draftEmail(_context);

      expect(result.subject, isEmpty);
      expect(result.body, contains('Hi there'));
    });
  });
}
