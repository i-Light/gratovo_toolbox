@TestOn('windows')
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/update/update_installer_io.dart';

void main() {
  group('command-line quoting for the elevated relaunch', () {
    test('a path with a space is one argument', () {
      expect(
        UpdateInstaller.quoteForCommandLine(r'C:\Program Files\Gratovo'),
        r'"C:\Program Files\Gratovo"',
      );
    });

    test('a plain token is left alone', () {
      expect(UpdateInstaller.quoteForCommandLine('-NoProfile'), '-NoProfile');
      expect(UpdateInstaller.quoteForCommandLine('12345'), '12345');
    });

    test('an embedded quote is escaped', () {
      expect(UpdateInstaller.quoteForCommandLine('a"b'), r'"a\"b"');
    });

    test('empty becomes an empty quoted string', () {
      expect(UpdateInstaller.quoteForCommandLine(''), '""');
    });
  });

  group('trailing separators on the target dir', () {
    test('are stripped so the closing quote survives', () {
      expect(
        UpdateInstaller.stripTrailingSeparators(r'C:\Program Files\Gratovo\'),
        r'C:\Program Files\Gratovo',
      );
      expect(
        UpdateInstaller.stripTrailingSeparators(r'C:\Program Files\Gratovo\\'),
        r'C:\Program Files\Gratovo',
      );
    });

    test('a drive root keeps its separator', () {
      expect(UpdateInstaller.stripTrailingSeparators(r'C:\'), r'C:\');
    });
  });
}
