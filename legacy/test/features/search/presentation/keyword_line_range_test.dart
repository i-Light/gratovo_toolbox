import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/keyword_input.dart';

/// What the keyword box highlights, and where. Getting this wrong draws the
/// pill on the wrong line — which reads as the run being somewhere it is not,
/// a worse outcome than no highlight at all.
void main() {
  group('keywordLineRange', () {
    test('finds the line and covers exactly the keyword', () {
      const text = 'first keyword\nsecond keyword\nthird';
      final range = keywordLineRange(text, 'second keyword');
      expect(range, isNotNull);
      expect(text.substring(range!.start, range.end), 'second keyword');
    });

    test('matches trimmed, and skips the leading whitespace', () {
      const text = 'a\n    padded keyword   \nb';
      final range = keywordLineRange(text, 'padded keyword');
      expect(range, isNotNull);
      expect(text.substring(range!.start, range.end), 'padded keyword');
    });

    test('matches the first line', () {
      const text = 'top\nbottom';
      expect(keywordLineRange(text, 'top'), const TextRange(start: 0, end: 3));
    });

    test('returns null when no line matches', () {
      expect(keywordLineRange('a\nb', 'c'), isNull);
    });

    test('returns null for an empty keyword', () {
      expect(keywordLineRange('a\nb', '   '), isNull);
    });

    test('a partial match is not a match — lines are whole keywords', () {
      expect(keywordLineRange('budget travel guide', 'budget travel'), isNull);
    });
  });
}
