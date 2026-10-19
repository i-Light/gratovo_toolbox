import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';

/// Edits the team's shared outreach writing rules ("my own custom rules for
/// writing emails that I'll discover as I go" — a direct requirement from
/// the Q&A). The rules themselves are read through `writingRulesProvider`
/// (`data/providers/entity_providers.dart`); this class is only the write
/// side.
///
/// The list is tiny and order matters, so every edit rewrites the whole
/// list via `WritingRulesRepository.replace` and then invalidates
/// `writingRulesProvider`. Duplicates and blank entries are dropped.
class WritingRulesController {
  WritingRulesController(this._ref);

  final Ref _ref;

  List<String> get _current =>
      _ref.read(writingRulesProvider).asData?.value ?? const [];

  Future<void> add(String rule) async {
    final trimmed = rule.trim();
    if (trimmed.isEmpty || _current.contains(trimmed)) return;
    await _replace([..._current, trimmed]);
  }

  Future<void> remove(String rule) async {
    if (!_current.contains(rule)) return;
    await _replace(_current.where((r) => r != rule).toList());
  }

  Future<void> reorder(int oldIndex, int newIndex) async {
    final next = [..._current];
    if (oldIndex < 0 || oldIndex >= next.length) return;
    var target = newIndex;
    if (target > oldIndex) target -= 1;
    target = target.clamp(0, next.length - 1);
    next.insert(target, next.removeAt(oldIndex));
    await _replace(next);
  }

  Future<void> _replace(List<String> rules) async {
    // Dedupe defensively — a caller could pass a list that already has a
    // repeat, and the stored list is meant to be a set in list's clothing.
    final seen = <String>{};
    final deduped = [
      for (final rule in rules)
        if (rule.trim().isNotEmpty && seen.add(rule.trim())) rule.trim(),
    ];
    await _ref.read(writingRulesRepositoryProvider).replace(deduped);
    _ref.invalidate(writingRulesProvider);
  }
}

final writingRulesControllerProvider = Provider<WritingRulesController>(
  WritingRulesController.new,
);
