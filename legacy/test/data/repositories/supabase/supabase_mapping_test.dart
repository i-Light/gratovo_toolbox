import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

void main() {
  // Every one of these cases is drawn from the real data: subscriber counts
  // stored as strings by the old pipeline, publish dates absent on the 121
  // videos whose fetch failed, jsonb columns null on rows written before the
  // column existed. A mapper that throws on any of them takes down a whole
  // screen over one bad row.
  group('parseInt', () {
    test('reads numbers and numeric strings', () {
      expect(parseInt(482000), 482000);
      expect(parseInt('482000'), 482000);
      expect(parseInt('1,160'), 1160);
      expect(parseInt(2.9), 2);
    });

    test('returns null rather than throwing on anything unusable', () {
      for (final input in <Object?>[null, '', '   ', 'n/a', 'abc']) {
        expect(parseInt(input), isNull, reason: 'input: $input');
      }
    });
  });

  group('parseDate', () {
    test('reads the ISO form the pipeline writes, as a UTC instant', () {
      final parsed = parseDate('2026-08-21T18:29:13Z');
      expect(parsed, DateTime.utc(2026, 8, 21, 18, 29, 13));
      expect(parsed!.isUtc, isTrue);
    });

    test('an offset-bearing timestamp resolves to the right UTC instant', () {
      // 20:29 at +02:00 is 18:29 UTC.
      final parsed = parseDate('2026-08-21T20:29:13+02:00');
      expect(parsed, DateTime.utc(2026, 8, 21, 18, 29, 13));
      expect(parsed!.isUtc, isTrue);
    });

    test('a naive timestamp is assumed to already be UTC', () {
      final parsed = parseDate('2026-08-21T18:29:13');
      expect(parsed, DateTime.utc(2026, 8, 21, 18, 29, 13));
      expect(parsed!.isUtc, isTrue);
    });

    test('a local DateTime is normalised to UTC', () {
      final parsed = parseDate(DateTime(2026, 8, 21, 18, 29, 13));
      expect(parsed!.isUtc, isTrue);
      expect(
        parsed.difference(DateTime(2026, 8, 21, 18, 29, 13)),
        Duration.zero,
      );
    });

    test('null for missing or unparseable values', () {
      for (final input in <Object?>[null, '', 'not a date']) {
        expect(parseDate(input), isNull, reason: 'input: $input');
      }
    });
  });

  group('parseStringList', () {
    test('handles a text[] / jsonb array', () {
      expect(parseStringList(['a', 'b']), ['a', 'b']);
    });

    test('drops nulls and blanks instead of yielding empty entries', () {
      expect(parseStringList(['a', null, '', '  ', 'b']), ['a', 'b']);
    });

    test('wraps a bare string and empties anything else', () {
      expect(parseStringList('solo'), ['solo']);
      expect(parseStringList(null), isEmpty);
      expect(parseStringList(42), isEmpty);
    });
  });

  group('toIso', () {
    // Sending local time without an offset is the classic way to write a
    // timestamp three hours off in a UTC+3 team.
    test('always converts to UTC', () {
      final local = DateTime(2026, 8, 25, 12);
      expect(toIso(local), endsWith('Z'));
      expect(DateTime.parse(toIso(local)).isUtc, isTrue);
    });
  });

  group('parseString', () {
    test('treats blank as absent', () {
      expect(parseString(''), isNull);
      expect(parseString('   '), isNull);
      expect(parseString('x'), 'x');
    });

    test('replaces a lone surrogate left by an upstream truncation', () {
      // '🎮' is U+1F3AE = high D83C + low DFAE. A name clipped after the high
      // half is what makes Flutter throw "string is not well-formed UTF-16".
      final clipped = 'Gamer ${String.fromCharCode(0xD83C)}';
      expect(parseString(clipped), 'Gamer �');
    });

    test('leaves a well-formed emoji string untouched', () {
      expect(parseString('Gamer 🎮 Zone'), 'Gamer 🎮 Zone');
    });
  });

  group('scrubUtf16', () {
    test('returns a clean string identically', () {
      const s = 'plain ascii and 🎮 émojis 日本語';
      expect(identical(scrubUtf16(s), s), isTrue);
    });

    test('replaces a stray low surrogate', () {
      expect(scrubUtf16('a${String.fromCharCode(0xDFAE)}b'), 'a�b');
    });

    test('replaces a high surrogate at end of string', () {
      expect(scrubUtf16('end${String.fromCharCode(0xD83C)}'), 'end�');
    });

    test('keeps a valid pair even when an earlier unit was repaired', () {
      final input = '${String.fromCharCode(0xDFAE)}ok 🎮';
      expect(scrubUtf16(input), '�ok 🎮');
    });
  });
}
