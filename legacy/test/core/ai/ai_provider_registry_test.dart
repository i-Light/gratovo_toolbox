import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/ai/ai_provider_registry.dart';
import 'package:gratovo_toolbox/core/ai/anthropic_api_provider.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';

import '../../support/fake_gemini_bridge.dart';

void main() {
  group('aiProvidersProvider', () {
    // Drafting through Gemini moved to the Comms queue (decision old-files),
    // so a running bridge no longer adds a "Gemini (browser)" provider here.
    test('is the template fill alone, even where the bridge runs', () {
      final container = ProviderContainer(overrides: [
        geminiBridgeProvider.overrideWithValue(FakeGeminiBridge()),
      ]);
      addTearDown(container.dispose);
      final ids = container.read(aiProvidersProvider).map((p) => p.id).toList();
      expect(ids, ['template_fill']);
      expect(ids, isNot(contains('gemini-browser')));
      expect(
        container.read(aiProvidersProvider).whereType<AnthropicApiProvider>(),
        isEmpty,
      );
    });

    test('the default selection is the template fill', () {
      final container = ProviderContainer(overrides: [
        geminiBridgeProvider.overrideWithValue(FakeGeminiBridge()),
      ]);
      addTearDown(container.dispose);
      expect(container.read(selectedAiProviderProvider).id, 'template_fill');
    });
  });
}
