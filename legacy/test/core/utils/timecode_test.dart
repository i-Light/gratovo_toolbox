import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/utils/timecode.dart';

void main() {
  group('formatTimecode', () {
    test('drops the hour below an hour, the way a player does', () {
      expect(formatTimecode(0), '0:00');
      expect(formatTimecode(9), '0:09');
      expect(formatTimecode(330), '5:30');
      expect(formatTimecode(3599), '59:59');
    });

    test('pads the minutes once there is an hour to pad against', () {
      expect(formatTimecode(3600), '1:00:00');
      expect(formatTimecode(3930), '1:05:30');
      expect(formatTimecode(45296), '12:34:56');
    });

    test('nothing recorded stays nothing', () {
      expect(formatTimecode(null), isNull);
      expect(formatTimecode(-1), isNull);
    });
  });

  group('parseTimecode', () {
    test('accepts the three shapes people actually type', () {
      expect(parseTimecode('90'), 90);
      expect(parseTimecode('5:30'), 330);
      expect(parseTimecode('1:05:30'), 3930);
      expect(parseTimecode('  1:05:30  '), 3930);
    });

    test('an empty field is not an error', () {
      expect(parseTimecode(''), isNull);
      expect(parseTimecode('   '), isNull);
      expect(parseTimecode(null), isNull);
    });

    test('rejects rather than normalises an out-of-range component', () {
      // 5:90 is a typo, and quietly turning it into 6:30 would store a number
      // that is not the one that was read off the player.
      expect(parseTimecode('5:90'), isNull);
      expect(parseTimecode('1:60:00'), isNull);
      expect(parseTimecode('1:00:99'), isNull);
    });

    test('rejects anything that is not a timecode', () {
      expect(parseTimecode('abc'), isNull);
      expect(parseTimecode('1:2:3:4'), isNull);
      expect(parseTimecode('-5'), isNull);
      expect(parseTimecode('1:-5'), isNull);
    });

    test('round-trips whatever formatTimecode produced', () {
      for (final seconds in [0, 9, 330, 3599, 3600, 3930, 45296]) {
        expect(parseTimecode(formatTimecode(seconds)), seconds);
      }
    });
  });

  group('timecodedVideoUrl', () {
    test('adds t= to a YouTube link', () {
      expect(
        timecodedVideoUrl('https://www.youtube.com/watch?v=abc123', 3930),
        'https://www.youtube.com/watch?v=abc123&t=3930s',
      );
      expect(
        timecodedVideoUrl('https://youtu.be/abc123', 42),
        'https://youtu.be/abc123?t=42s',
      );
    });

    test('replaces an existing t= rather than appending a second one', () {
      expect(
        timecodedVideoUrl('https://youtu.be/abc?t=10s', 99),
        'https://youtu.be/abc?t=99s',
      );
    });

    test('leaves a non-YouTube host untouched', () {
      const url = 'https://vimeo.com/12345';
      expect(timecodedVideoUrl(url, 120), url);
    });

    test('no timecode means the plain URL, no URL means nothing', () {
      expect(
        timecodedVideoUrl('https://youtu.be/abc', null),
        'https://youtu.be/abc',
      );
      expect(
          timecodedVideoUrl('https://youtu.be/abc', 0), 'https://youtu.be/abc');
      expect(timecodedVideoUrl('', 30), isNull);
      expect(timecodedVideoUrl(null, 30), isNull);
    });
  });
}
