import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/features/search/application/search_keywords_controller.dart';

/// The pure half of the saved keyword box: what counts as a keyword, what is
/// still to run, and what happens when the box is edited between runs. The
/// persistence around it needs a real `SharedPreferences` and is exercised by
/// using the app; this is the part where the resume behaviour is decided.
void main() {
  group('keywords', () {
    test('one per non-blank line, trimmed, in order', () {
      const state = SearchKeywordsState(text: 'a\n  b  \n\n\nc\n');
      expect(state.keywords, ['a', 'b', 'c']);
    });

    test('dedupes, keeping the first occurrence', () {
      const state = SearchKeywordsState(text: 'a\nb\na');
      expect(state.keywords, ['a', 'b']);
    });

    test('an empty box has no keywords', () {
      expect(const SearchKeywordsState(text: '   \n\n').keywords, isEmpty);
    });
  });

  group('pending', () {
    test('is everything not already done, in the box order', () {
      const state = SearchKeywordsState(
        text: 'a\nb\nc\nd',
        completed: ['a', 'b'],
      );
      expect(state.pending, ['c', 'd']);
    });

    test('is the whole list when nothing is done', () {
      const state = SearchKeywordsState(text: 'a\nb');
      expect(state.pending, ['a', 'b']);
    });

    test('is empty once every keyword is done', () {
      const state = SearchKeywordsState(text: 'a\nb', completed: ['a', 'b']);
      expect(state.pending, isEmpty);
    });
  });

  group('wasInterrupted', () {
    test('defaults to false', () {
      expect(const SearchKeywordsState(text: 'a').wasInterrupted, isFalse);
    });

    test('copyWith can set it and leaves it alone when omitted', () {
      const state = SearchKeywordsState(text: 'a\nb', completed: ['a']);
      final flagged = state.copyWith(wasInterrupted: true);
      expect(flagged.wasInterrupted, isTrue);
      // An unrelated copy keeps the flag rather than resetting it.
      expect(flagged.copyWith(text: 'a\nb\nc').wasInterrupted, isTrue);
      // And it can be cleared again.
      expect(flagged.copyWith(wasInterrupted: false).wasInterrupted, isFalse);
    });

    test('pruning a stale done-marker preserves the flag', () {
      const state = SearchKeywordsState(
        text: 'a\nb',
        completed: ['a', 'gone'],
        wasInterrupted: true,
      );
      final pruned = state.copyWith(completed: state.completed);
      // `prune()` runs inside the notifier, but the copyWith path it uses must
      // not drop the flag — exercised here via the same copyWith it calls.
      expect(pruned.wasInterrupted, isTrue);
    });
  });

  group('hasResumableProgress', () {
    test('is true partway through a list', () {
      const state = SearchKeywordsState(text: 'a\nb\nc', completed: ['a']);
      expect(state.hasResumableProgress, isTrue);
    });

    test('is false before anything has run', () {
      expect(
        const SearchKeywordsState(text: 'a\nb\nc').hasResumableProgress,
        isFalse,
      );
    });

    test('is false once the list is finished', () {
      const state = SearchKeywordsState(text: 'a\nb', completed: ['a', 'b']);
      expect(state.hasResumableProgress, isFalse);
    });
  });
}
