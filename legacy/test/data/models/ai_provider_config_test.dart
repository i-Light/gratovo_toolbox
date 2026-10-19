import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/ai_provider_config.dart';

void main() {
  group('AiProviderConfig', () {
    test('copyWith changes only the fields passed', () {
      const original = AiProviderConfig(
        id: 'aiprov_1',
        displayName: 'Work Claude',
        apiKey: 'sk-ant-old',
        model: 'claude-sonnet-4-5',
      );
      final updated = original.copyWith(apiKey: 'sk-ant-new');

      expect(updated.id, original.id);
      expect(updated.displayName, original.displayName);
      expect(updated.model, original.model);
      expect(updated.apiKey, 'sk-ant-new');
    });

    test('toJson/fromJson round-trips every field', () {
      const original = AiProviderConfig(
        id: 'aiprov_2',
        displayName: 'Personal key',
        apiKey: 'sk-ant-abc123',
        model: 'claude-opus-4-1',
      );

      final restored = AiProviderConfig.fromJson(original.toJson());

      expect(restored.id, original.id);
      expect(restored.displayName, original.displayName);
      expect(restored.apiKey, original.apiKey);
      expect(restored.model, original.model);
    });
  });
}
