import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';

void main() {
  group('AccessLevel.fromWire', () {
    test('maps the two granted levels', () {
      expect(AccessLevel.fromWire('full'), AccessLevel.full);
      expect(AccessLevel.fromWire('basic'), AccessLevel.basic);
    });

    // The single most important behaviour in this file. Anything unrecognised
    // — null, a typo, a level added to the database but not yet to this enum —
    // must fall to the LEAST privileged value. If this ever regresses to
    // defaulting to `full`, a client-side glitch silently reveals email bodies
    // and prices. (The server would still refuse the data; this keeps the UI
    // from promising something it cannot deliver, and from ever being the
    // weak link if the two are wired differently in future.)
    test('defaults to unauthorized for anything unrecognised', () {
      for (final input in [null, '', 'FULL', 'admin', 'owner', 'Basic']) {
        expect(AccessLevel.fromWire(input), AccessLevel.unauthorized,
            reason: 'input: $input');
      }
    });

    test('only full sees sensitive data', () {
      expect(AccessLevel.full.seesSensitiveData, isTrue);
      expect(AccessLevel.basic.seesSensitiveData, isFalse);
      expect(AccessLevel.unauthorized.seesSensitiveData, isFalse);
      expect(AccessLevel.basic.isAuthorized, isTrue);
      expect(AccessLevel.unauthorized.isAuthorized, isFalse);
    });
  });

  group('color round-trip', () {
    test('parses #RRGGBB and returns it unchanged', () {
      final color = TeamMember.parseColor('#EF4444');
      expect(TeamMember.colorToHex(color), '#EF4444');
    });

    test('tolerates a missing leading hash and lower case', () {
      expect(TeamMember.colorToHex(TeamMember.parseColor('10b981')), '#10B981');
    });

    // A malformed color is cosmetic. Falling back beats throwing, because a
    // throw here would take a teammate's presence off the screen entirely
    // rather than just showing it in the wrong shade.
    test('falls back instead of throwing on junk', () {
      for (final input in [null, '', 'nope', '#12', '#GGGGGG']) {
        expect(TeamMember.parseColor(input), const Color(0xFF3B82F6),
            reason: 'input: $input');
      }
    });
  });

  group('fromRow', () {
    test('reads a complete row', () {
      final member = TeamMember.fromRow({
        'id': 'abc',
        'display_name': 'Moustafa',
        'color': '#8B5CF6',
        'role': 'full',
      });
      expect(member.displayName, 'Moustafa');
      expect(member.accessLevel, AccessLevel.full);
      expect(TeamMember.colorToHex(member.color), '#8B5CF6');
    });

    test('survives a row with nothing but an id', () {
      final member =
          TeamMember.fromRow({'id': 'abc', 'display_name': null, 'role': null});
      expect(member.displayName, 'No Nickname');
      expect(member.accessLevel, AccessLevel.unauthorized);
    });
  });
}
