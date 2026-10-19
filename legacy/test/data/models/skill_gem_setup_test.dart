import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/skill_gem_setup.dart';

void main() {
  group('gemRoleForSkillName', () {
    test('maps the keyword generator skill to its gem', () {
      expect(
        gemRoleForSkillName('keyword generator skill'),
        SkillGemRole.keywords,
      );
    });

    // The drafter and QA gems went with the old drafting path (decision
    // old-files), so their decks no longer map to any gem.
    test('the old drafter and QA decks have no gem', () {
      expect(gemRoleForSkillName('email drafter skill'), isNull);
      expect(gemRoleForSkillName('QA optimizer'), isNull);
    });

    test('ignores case and stray whitespace', () {
      expect(
        gemRoleForSkillName('  Keyword   Generator Skill '),
        SkillGemRole.keywords,
      );
    });

    test('is an exact table, not a fuzzy match', () {
      expect(gemRoleForSkillName('keyword notes'), isNull);
      expect(gemRoleForSkillName('reply drafter skill'), isNull);
      expect(gemRoleForSkillName('channel classifier skill'), isNull);
      expect(gemRoleForSkillName('WORKFLOW'), isNull);
      expect(gemRoleForSkillName(''), isNull);
    });
  });

  group('SkillGemRole', () {
    test('storage names round-trip and an unknown one is null', () {
      for (final role in SkillGemRole.values) {
        expect(SkillGemRole.fromName(role.storageName), role);
      }
      expect(SkillGemRole.fromName('martian'), isNull);
      expect(SkillGemRole.fromName('drafter'), isNull);
      expect(SkillGemRole.fromName('qa'), isNull);
      expect(SkillGemRole.fromName(null), isNull);
    });
  });

  group('defaultGemName', () {
    test('drops a trailing "skill" and capitalises', () {
      expect(defaultGemName('email drafter skill'), 'Email drafter');
      expect(defaultGemName('keyword generator skill'), 'Keyword generator');
      expect(defaultGemName('QA optimizer'), 'QA optimizer');
    });

    test('keeps a name that is nothing but "skill"', () {
      expect(defaultGemName('skill'), 'Skill');
      expect(defaultGemName('   '), '');
    });
  });

  group('SkillGemSetup.defaultsFor', () {
    final now = DateTime.utc(2026, 9, 29);

    test('names the gem after the skill and fills every field for each role',
        () {
      for (final role in SkillGemRole.values) {
        final setup = SkillGemSetup.defaultsFor(
          groupId: 'g1',
          skillName: 'keyword generator skill',
          role: role,
          now: now,
        );
        expect(setup.groupId, 'g1');
        expect(setup.role, role);
        expect(setup.name, 'Keyword generator');
        expect(setup.description.trim(), isNotEmpty);
        expect(setup.instructions.trim(), isNotEmpty);
        expect(setup.hasUrl, isFalse);
        expect(setup.syncedAt, isNull);
        expect(setup.isBlank, isFalse);
      }
    });

    test('the instructions are one short line, never the skill itself', () {
      for (final role in SkillGemRole.values) {
        final setup = SkillGemSetup.defaultsFor(
          groupId: 'g1',
          skillName: 'x',
          role: role,
          now: now,
        );
        expect(setup.instructions.length, lessThan(400));
      }
    });
  });

  group('SkillGemSetup', () {
    final base = SkillGemSetup.defaultsFor(
      groupId: 'g1',
      skillName: 'keyword generator skill',
      role: SkillGemRole.keywords,
      now: DateTime.utc(2026, 9, 29),
    );

    test('sameContentAs ignores surrounding whitespace only', () {
      expect(
        base.sameContentAs(
          name: '  ${base.name} ',
          description: base.description,
          instructions: '${base.instructions}\n',
        ),
        isTrue,
      );
      expect(
        base.sameContentAs(
          name: base.name,
          description: base.description,
          instructions: 'different',
        ),
        isFalse,
      );
    });

    test('isBlank is true only when all three fields are empty', () {
      final blank = base.copyWith(name: '', description: ' ', instructions: '');
      expect(blank.isBlank, isTrue);
      expect(blank.copyWith(name: 'x').isBlank, isFalse);
    });

    test('copyWith keeps the deck and creation instant', () {
      final changed = base.copyWith(
        url: 'https://gemini.google.com/gem/1',
        updatedAt: DateTime.utc(2027),
      );
      expect(changed.groupId, base.groupId);
      expect(changed.createdAt, base.createdAt);
      expect(changed.updatedAt, DateTime.utc(2027));
      expect(changed.hasUrl, isTrue);
    });
  });
}
