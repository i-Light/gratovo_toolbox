import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_writing_rules_repository.dart';

void main() {
  group('MockWritingRulesRepository', () {
    test('getAll returns the seeded rules', () async {
      final repo = MockWritingRulesRepository();
      final rules = await repo.getAll();
      expect(rules, isNotEmpty);
    });

    test('replace overwrites the whole list, preserving order', () async {
      final repo = MockWritingRulesRepository();
      await repo.replace(['second', 'first', 'third']);
      expect(await repo.getAll(), ['second', 'first', 'third']);
    });

    test('replace with an empty list clears every rule', () async {
      final repo = MockWritingRulesRepository();
      await repo.replace(const []);
      expect(await repo.getAll(), isEmpty);
    });

    test('getAll result is unmodifiable', () async {
      final repo = MockWritingRulesRepository();
      final rules = await repo.getAll();
      expect(() => rules.add('x'), throwsUnsupportedError);
    });
  });
}
