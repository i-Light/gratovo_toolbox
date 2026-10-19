import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/startup/boot_timeline.dart';

void main() {
  test('one line: when, first frame, then each step in order', () {
    final timeline = BootTimeline()
      ..mark('window')
      ..mark('timeZones');
    final line = timeline.describe(
      firstFrameMs: 812,
      at: DateTime(2026, 9, 30, 9, 12, 3),
    );
    expect(
      line,
      matches(RegExp(
          r'^2026-09-30T09:12:03\.000 firstFrame=812ms window=\d+ timeZones=\d+$')),
    );
  });

  test('each mark is the time since the previous one', () async {
    final timeline = BootTimeline();
    await Future<void>.delayed(const Duration(milliseconds: 30));
    timeline.mark('slow');
    timeline.mark('instant');
    final line = timeline.describe(firstFrameMs: 0);
    final slow = int.parse(RegExp(r'slow=(\d+)').firstMatch(line)!.group(1)!);
    final instant =
        int.parse(RegExp(r'instant=(\d+)').firstMatch(line)!.group(1)!);
    expect(slow, greaterThanOrEqualTo(25));
    expect(instant, lessThan(slow));
  });

  test('the log keeps the newest fifty launches', () {
    final dir = Directory.systemTemp.createTempSync('gratovo_boot');
    addTearDown(() => dir.deleteSync(recursive: true));
    for (var i = 0; i < 60; i++) {
      BootTimeline.append(dir.path, 'launch $i');
    }
    final lines =
        File('${dir.path}/${BootTimeline.fileName}').readAsLinesSync();
    expect(lines, hasLength(50));
    expect(lines.first, 'launch 10');
    expect(lines.last, 'launch 59');
  });

  test('an unwritable directory is not an error', () {
    // A path under a file cannot be created as a directory.
    final dir = Directory.systemTemp.createTempSync('gratovo_boot_file');
    addTearDown(() => dir.deleteSync(recursive: true));
    final blocker = File('${dir.path}/blocker')..writeAsStringSync('x');
    expect(() => BootTimeline.append(blocker.path, 'line'), returnsNormally);
  });
}
