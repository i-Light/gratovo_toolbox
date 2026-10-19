@TestOn('windows')
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/my_apps/my_app_entry.dart';
import 'package:gratovo_toolbox/core/my_apps/my_apps_host_io.dart';

void main() {
  late Directory dir;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('my_apps_host');
  });

  tearDown(() async {
    await dir.delete(recursive: true);
  });

  test(
      'finds the first listed path that exists, env-expanded, '
      'written with forward slashes', () async {
    final exe = File('${dir.path}/App/app.exe');
    await exe.create(recursive: true);
    final relative = dir.path.substring(Directory.systemTemp.path.length + 1);

    final found = await const MyAppsHost().installedPath(
      MyAppWindows(
        exe: [
          '%TEMP%/does-not-exist/app.exe',
          '%TEMP%/$relative/App/app.exe',
        ],
      ),
    );
    expect(
      found?.toLowerCase(),
      exe.path.replaceAll('/', Platform.pathSeparator).toLowerCase(),
      reason: 'TEMP must be where systemTemp points for this test to mean '
          'anything',
    );
  });

  test('nothing listed exists: not installed', () async {
    final found = await const MyAppsHost().installedPath(
      MyAppWindows(exe: ['${dir.path}/nope.exe']),
    );
    expect(found, isNull);
  });
}
