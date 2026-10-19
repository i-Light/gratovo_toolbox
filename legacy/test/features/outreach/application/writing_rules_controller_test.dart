import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_writing_rules_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/writing_rules_controller.dart';

ProviderContainer _container(MockWritingRulesRepository repo) {
  final container = ProviderContainer(
    overrides: [
      writingRulesRepositoryProvider.overrideWithValue(repo),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

Future<(ProviderContainer, WritingRulesController)> _ready(
  MockWritingRulesRepository repo,
) async {
  final container = _container(repo);
  await container.read(writingRulesProvider.future);
  return (container, container.read(writingRulesControllerProvider));
}

void main() {
  test('add appends a trimmed rule and persists it', () async {
    final repo = MockWritingRulesRepository();
    await repo.replace(const []);
    final (container, controller) = await _ready(repo);

    await controller.add('  Always mention rates.  ');

    expect(await repo.getAll(), ['Always mention rates.']);
    expect(
      await container.read(writingRulesProvider.future),
      ['Always mention rates.'],
    );
  });

  test('add ignores blanks and exact duplicates', () async {
    final repo = MockWritingRulesRepository();
    await repo.replace(const ['One']);
    final (_, controller) = await _ready(repo);

    await controller.add('   ');
    await controller.add('One');

    expect(await repo.getAll(), ['One']);
  });

  test('remove drops the matching rule', () async {
    final repo = MockWritingRulesRepository();
    await repo.replace(const ['One', 'Two', 'Three']);
    final (_, controller) = await _ready(repo);

    await controller.remove('Two');

    expect(await repo.getAll(), ['One', 'Three']);
  });

  test('reorder moves a rule to a new position', () async {
    final repo = MockWritingRulesRepository();
    await repo.replace(const ['A', 'B', 'C']);
    final (_, controller) = await _ready(repo);

    await controller.reorder(0, 3); // A to the end

    expect(await repo.getAll(), ['B', 'C', 'A']);
  });
}
