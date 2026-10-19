import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/skill_group.dart';
import 'package:gratovo_toolbox/data/models/skill_section.dart';
import 'package:gratovo_toolbox/features/skills/application/skill_markdown.dart';

void main() {
  final now = DateTime.utc(2026, 9, 20);

  SkillGroup makeGroup(String name, {String id = 'g1'}) => SkillGroup(
        id: id,
        name: name,
        createdAt: now,
        updatedAt: now,
      );

  SkillSection makeSection(
    String groupId,
    String heading,
    String body, {
    String? id,
    int position = 0,
    bool teamOnly = false,
  }) =>
      SkillSection(
        id: id ?? '$groupId-$heading',
        groupId: groupId,
        heading: heading,
        body: body,
        position: position,
        teamOnly: teamOnly,
        createdAt: now,
        updatedAt: now,
      );

  group('slugifyForMention', () {
    test('folds case and punctuation into underscores', () {
      expect(slugifyForMention('Step 2'), 'step_2');
      expect(slugifyForMention('WORKFLOW'), 'workflow');
      expect(slugifyForMention('  spaced -- out  '), 'spaced_out');
    });

    test('never returns empty', () {
      expect(slugifyForMention('!!!'), 'section');
      expect(slugifyForMention(''), 'section');
    });
  });

  group('mentionTokenFor', () {
    test('joins the slugified group and heading with a double underscore', () {
      final g = makeGroup('Workflow');
      final s = makeSection(g.id, 'Step 2', '');
      expect(mentionTokenFor(g, s), 'workflow__step_2');
    });
  });

  group('buildReferenceIndex / mentionSuggestionsExcluding', () {
    test('indexes every card across every group by its token', () {
      final g1 = makeGroup('Workflow', id: 'g1');
      final g2 = makeGroup('QA', id: 'g2');
      final s1 = makeSection('g1', 'Step 2', 'body one');
      final s2 = makeSection('g2', 'Checklist', 'body two');
      final index = buildReferenceIndex({
        g1: [s1],
        g2: [s2],
      });
      expect(index.keys, containsAll(['workflow__step_2', 'qa__checklist']));
      expect(index['workflow__step_2']!.section, s1);
    });

    test('excludes only the given token, not the rest of the library', () {
      final g = makeGroup('Workflow');
      final index = buildReferenceIndex({
        g: [makeSection('g1', 'A', ''), makeSection('g1', 'B', '')],
      });
      final suggestions = mentionSuggestionsExcluding(index, 'workflow__a');
      expect(suggestions, ['workflow__b']);
    });
  });

  group('resolveSkillReferences', () {
    late Map<String, SkillReferenceTarget> index;
    setUp(() {
      final g = makeGroup('Workflow');
      index = buildReferenceIndex({
        g: [
          makeSection('g1', 'Step 1', 'Do the first thing.'),
          makeSection(
              'g1', 'Step 2', 'Do the second thing, see @workflow__step_1.'),
        ],
      });
    });

    test('a single @ mention resolves to the target heading only', () {
      final resolved = resolveSkillReferences(
        'As covered in @workflow__step_1, continue.',
        index,
      );
      expect(resolved, 'As covered in Step 1, continue.');
    });

    test('a double @@ mention transcludes the full referenced body', () {
      final resolved = resolveSkillReferences(
        'Full text: @@workflow__step_1',
        index,
      );
      expect(resolved, 'Full text: Do the first thing.');
    });

    test('an unknown token is left as literal text', () {
      final resolved = resolveSkillReferences('See @nope_here.', index);
      expect(resolved, 'See @nope_here.');
    });

    test('an email-address-shaped token is not treated as a mention', () {
      final resolved =
          resolveSkillReferences('Contact sam@workflow__step_1.', index);
      expect(resolved, 'Contact sam@workflow__step_1.');
    });

    test('transclusion recurses through a chain of @@ references', () {
      final g = makeGroup('Chain');
      final chained = buildReferenceIndex({
        g: [
          makeSection('g1', 'A', 'root text'),
          makeSection('g1', 'B', 'wraps @@chain__a'),
          makeSection('g1', 'C', 'wraps @@chain__b'),
        ],
      });
      final resolved = resolveSkillReferences('@@chain__c', chained);
      expect(resolved, 'wraps wraps root text');
    });

    test('a genuine @@ cycle renders a marker instead of recursing forever',
        () {
      final g = makeGroup('Loop');
      final cyclic = buildReferenceIndex({
        g: [
          makeSection('g1', 'A', 'points at @@loop__b'),
          makeSection('g1', 'B', 'points back at @@loop__a'),
        ],
      });
      final resolved = resolveSkillReferences('@@loop__a', cyclic);
      expect(resolved, contains('circular reference'));
    });
  });

  group('buildSkillMarkdown', () {
    test('skips unnamed and team-only cards from the exported file', () {
      final g = makeGroup('Workflow');
      final sections = [
        makeSection('g1', 'Intro', 'Read this first.', position: 0),
        makeSection('g1', '', 'A card with no name yet.', position: 1),
        makeSection('g1', 'Team notes', 'Internal only.',
            position: 2, teamOnly: true),
      ];
      final index = buildReferenceIndex({g: sections});
      final markdown = buildSkillMarkdown(g, sections, index);

      expect(markdown, contains('# Workflow'));
      expect(markdown, contains('# Intro'));
      expect(markdown, contains('Read this first.'));
      expect(markdown, isNot(contains('A card with no name yet.')));
      expect(markdown, isNot(contains('Team notes')));
      expect(markdown, isNot(contains('Internal only.')));
    });

    test('transcludes across a reference in the exported text', () {
      final g = makeGroup('Workflow');
      final sections = [
        makeSection('g1', 'Rule', 'Never do X.', position: 0),
        makeSection('g1', 'Step', 'Follow the rule: @@workflow__rule',
            position: 1),
      ];
      final index = buildReferenceIndex({g: sections});
      final markdown = buildSkillMarkdown(g, sections, index);
      expect(markdown, contains('Follow the rule: Never do X.'));
    });
  });

  group('parseSkillMarkdownSections (the import path)', () {
    test('splits on ## headings, drops the title and bare --- rules', () {
      const content = '''
# The critique loop

Some lead-in prose.

---

## Step 1: capture

Capture text.

---

## Step 2: read

Read text.
''';
      final parsed = parseSkillMarkdownSections(content);
      expect(parsed.map((s) => s.heading),
          ['Intro', 'Step 1: capture', 'Step 2: read']);
      expect(parsed[0].body, 'Some lead-in prose.');
      expect(parsed[1].body, 'Capture text.');
      expect(parsed[2].body, 'Read text.');
    });

    test('a # section keeps its ## and ### subsections in one card', () {
      const content = '''
# email drafter

## Intro

Lead-in.

# THE PROCEDURE

```
# not a heading, it is a shell comment
```

# PART 0: HOW YOU OPERATE

---

## 0.1 What you receive

Data.

## 0.2 What you output

Emails.

# PART 3: POWER DYNAMICS

### 3.1 Never apologize

No.
''';
      final parsed =
          parseSkillMarkdownSections(content, title: 'email drafter');
      expect(parsed.map((s) => s.heading), [
        'Intro',
        'THE PROCEDURE',
        'PART 0: HOW YOU OPERATE',
        'PART 3: POWER DYNAMICS',
      ]);
      expect(parsed[0].body, 'Lead-in.');
      expect(parsed[1].body, contains('# not a heading'));
      expect(parsed[2].body, startsWith('## 0.1 What you receive'));
      expect(parsed[2].body, contains('## 0.2 What you output'));
      expect(parsed[3].body, startsWith('### 3.1 Never apologize'));
    });

    test('a first # that is not the title stays a card', () {
      final parsed = parseSkillMarkdownSections(
        '# One\n\nx\n\n# Two\n\ny\n',
        title: 'Something else',
      );
      expect(parsed.map((s) => s.heading), ['One', 'Two']);
    });

    test('a file with no heading at all becomes one Intro card', () {
      final parsed = parseSkillMarkdownSections('# Title\n\njust prose\n');
      expect(parsed, hasLength(1));
      expect(parsed.single.heading, 'Intro');
      expect(parsed.single.body, 'just prose');
    });

    test('round-trips through buildSkillMarkdown for a re-export', () {
      const original = '''
# Roundtrip

---

## One

first body
''';
      final g = makeGroup('Roundtrip');
      final parsed = parseSkillMarkdownSections(original);
      final sections = [
        for (var i = 0; i < parsed.length; i++)
          makeSection('g1', parsed[i].heading, parsed[i].body, position: i),
      ];
      final index = buildReferenceIndex({g: sections});
      final rebuilt = buildSkillMarkdown(g, sections, index);
      expect(rebuilt, contains('# One'));
      expect(rebuilt, contains('first body'));
    });
  });

  group('totalWordCount', () {
    test('sums every card, including unnamed and team-only ones', () {
      final sections = [
        makeSection('g1', 'A', 'one two three', position: 0),
        makeSection('g1', '', 'four five', position: 1),
        makeSection('g1', 'C', 'six', position: 2, teamOnly: true),
      ];
      expect(totalWordCount(sections), 6);
    });
  });
}
