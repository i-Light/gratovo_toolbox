import 'package:gratovo_toolbox/data/repositories/writing_rules_repository.dart';

/// In-memory [WritingRulesRepository], seeded with a couple of example
/// rules so the card and the AI draft context are never empty in mock mode.
class MockWritingRulesRepository implements WritingRulesRepository {
  final List<String> _rules = [
    'Keep it under 120 words.',
    'Reference their most recent upload by name.',
    'No exclamation marks in the subject line.',
  ];

  @override
  Future<List<String>> getAll() async => List.unmodifiable(_rules);

  @override
  Future<void> replace(List<String> rules) async {
    _rules
      ..clear()
      ..addAll(rules);
  }
}
