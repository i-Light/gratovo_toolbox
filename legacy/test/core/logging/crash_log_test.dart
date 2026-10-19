import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/logging/crash_log.dart';

void main() {
  late Directory dir;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('crash_log_test');
  });

  tearDown(() async {
    if (dir.existsSync()) await dir.delete(recursive: true);
  });

  test('an entry carries the error, its context and the stack', () {
    final log = CrashLog.open(dir.path)!;
    log.record(
      'Bad state: no element',
      StackTrace.fromString('#0 somewhere (file.dart:1)'),
      context: 'building _Row',
      library: 'widgets library',
    );

    final text = File(log.path).readAsStringSync();
    expect(text, contains('library=widgets library'));
    expect(text, contains('while building _Row'));
    expect(text, contains('Bad state: no element'));
    expect(text, contains('#0 somewhere (file.dart:1)'));
  });

  test('a widget throwing on every frame cannot grow the file forever', () {
    final log = CrashLog.open(dir.path)!;
    final stack = StackTrace.fromString('x' * 4096);
    for (var i = 0; i < 400; i++) {
      log.record('boom $i', stack);
    }

    final live = File(log.path);
    final previous = File('${log.path}.1');
    expect(previous.existsSync(), isTrue);
    expect(live.lengthSync(), lessThan(1024 * 1024));
    expect(live.readAsStringSync(), contains('boom 399'));
  });

  test('a directory that cannot be written is not a launch failure', () {
    // A file where the directory should be: createSync on its "parent" fails.
    final blocker = File('${dir.path}${Platform.pathSeparator}blocker')
      ..writeAsStringSync('');
    expect(
        CrashLog.open('${blocker.path}${Platform.pathSeparator}sub'), isNull);
  });
}
