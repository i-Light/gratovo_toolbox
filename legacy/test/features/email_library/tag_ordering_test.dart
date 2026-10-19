import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/email_tag.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/tag_ordering.dart';

EmailTag _tag(String id, String label, {int order = 0}) => EmailTag(
      id: id,
      kind: EmailTagKind.niche,
      label: label,
      sortOrder: order,
    );

void main() {
  final fitness = _tag('a', 'Fitness', order: 0);
  final gaming = _tag('b', 'Gaming', order: 1);
  final saas = _tag('c', 'SaaS', order: 2);
  final tags = [fitness, gaming, saas];

  group('orderSelectedFirst', () {
    test('lifts the selected tags to the front, order otherwise intact', () {
      expect(
        orderSelectedFirst(tags, {'c'}).map((t) => t.id),
        ['c', 'a', 'b'],
      );
    });

    test('two selected tags keep their relative order', () {
      // The property that stops a row reshuffling itself when an unrelated
      // chip is tapped.
      expect(
        orderSelectedFirst(tags, {'c', 'a'}).map((t) => t.id),
        ['a', 'c', 'b'],
      );
    });

    test('nothing selected is the list unchanged', () {
      expect(orderSelectedFirst(tags, const {}), same(tags));
    });

    test('an id that no longer exists is simply not there', () {
      expect(
        orderSelectedFirst(tags, {'deleted'}).map((t) => t.id),
        ['a', 'b', 'c'],
      );
    });
  });

  group('filterTagsByQuery', () {
    test('matches a substring, case-insensitively', () {
      expect(filterTagsByQuery(tags, 'fit').map((t) => t.id), ['a']);
      expect(filterTagsByQuery(tags, 'SAAS').map((t) => t.id), ['c']);
      expect(filterTagsByQuery(tags, 'a').map((t) => t.id), ['b', 'c']);
    });

    test('a blank query means no filter, not no matches', () {
      expect(filterTagsByQuery(tags, ''), same(tags));
      expect(filterTagsByQuery(tags, '   '), same(tags));
    });

    test('no match is an empty list', () {
      expect(filterTagsByQuery(tags, 'crypto'), isEmpty);
    });
  });

  group('compareEmailTags', () {
    test('sortOrder wins, then the label case-insensitively', () {
      final unsorted = [
        _tag('x', 'zebra', order: 0),
        _tag('y', 'Alpha', order: 1),
        _tag('z', 'alpha', order: 0),
      ];
      expect(
        ([...unsorted]..sort(compareEmailTags)).map((t) => t.id),
        ['z', 'x', 'y'],
      );
    });
  });
}
