import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/my_apps/my_app_entry.dart';
import 'package:gratovo_toolbox/core/my_apps/my_app_releases.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  group('MyAppsRegistry.parse', () {
    test('the shipped list reads cleanly', () {
      // The real asset, so a typo in it fails here rather than as a red
      // line in Settings on everyone's machine.
      final registry =
          MyAppsRegistry.parse(File('assets/my_apps.json').readAsStringSync());
      expect(registry.problems, isEmpty);
      final dhikr = registry.apps.single;
      expect(dhikr.id, 'dhikr_reminder');
      expect(dhikr.github!.repo, 'i-Light/dhikr_reminder');
      expect(dhikr.github!.isPrivate, isFalse);
      expect(dhikr.windows!.exe, isNotEmpty);
      expect(dhikr.android!.package, 'com.gratovo.dhikr_reminder');
      expect(dhikr.nameFor('ar'), 'Dhikr Reminder');
      expect(dhikr.descriptionFor('ar'), contains('الأذكار'));
    });

    test('every section is optional', () {
      final registry = MyAppsRegistry.parse(
        jsonEncode({
          'apps': [
            {'id': 'bare'},
          ],
        }),
      );
      final app = registry.apps.single;
      expect(app.nameFor('en'), 'bare');
      expect(app.descriptionFor('en'), isNull);
      expect(app.github, isNull);
      expect(app.windows, isNull);
      expect(app.android, isNull);
      expect(app.icon, 'apps');
    });

    test('reads a private, Play-listed app with an APK', () {
      final app = MyAppsRegistry.parse(
        jsonEncode({
          'apps': [
            {
              'id': 'notes',
              'name': {'en': 'Notes', 'ar': 'ملاحظات'},
              'icon': 'book',
              'github': {'repo': 'me/notes', 'private': true},
              'windows': {'exe': r'C:\Notes\notes.exe'},
              'android': {
                'package': 'com.me.notes',
                'playStore': true,
                'apk': true,
              },
            },
          ],
        }),
      ).apps.single;
      expect(app.nameFor('ar'), 'ملاحظات');
      expect(app.nameFor('fr'), 'Notes');
      expect(app.github!.isPrivate, isTrue);
      expect(app.windows!.exe, [r'C:\Notes\notes.exe']);
      expect(app.android!.playStore, isTrue);
      expect(app.android!.apk, isTrue);
      expect(
        app.android!.playStoreUrl.toString(),
        'https://play.google.com/store/apps/details?id=com.me.notes',
      );
    });

    test('a broken entry is reported, the others still load', () {
      final registry = MyAppsRegistry.parse(
        jsonEncode({
          'apps': [
            {'id': 'good'},
            {'name': 'no id'},
            {
              'id': 'bad-repo',
              'github': {'repo': 'not a slug'},
            },
            {
              'id': 'no-package',
              'android': {'playStore': true},
            },
            {'id': 'good'},
          ],
        }),
      );
      expect(registry.apps.map((a) => a.id), ['good']);
      expect(registry.problems, [
        'apps[1]: id is missing',
        'apps[2]: github.repo "not a slug" is not owner/name',
        'apps[3]: android.package is missing',
        'apps[4]: duplicate id "good"',
      ]);
    });

    test('an unknown icon falls back rather than failing', () {
      final app = MyAppsRegistry.parse(
        jsonEncode({
          'apps': [
            {'id': 'x', 'icon': 'rocket'},
          ],
        }),
      ).apps.single;
      expect(app.icon, 'apps');
    });

    test('invalid JSON is a problem, not a crash', () {
      final registry = MyAppsRegistry.parse('{"apps": [');
      expect(registry.apps, isEmpty);
      expect(registry.problems.single, startsWith('my_apps.json:'));
    });
  });

  group('expandWindowsEnv', () {
    test('expands without regard to case', () {
      expect(
        expandWindowsEnv(
          r'%LocalAppData%\Programs\App\app.exe',
          {'LOCALAPPDATA': r'C:\Users\me\AppData\Local'},
        ),
        r'C:\Users\me\AppData\Local\Programs\App\app.exe',
      );
    });

    test('leaves an unknown variable as written', () {
      expect(expandWindowsEnv(r'%NOPE%\app.exe', {}), r'%NOPE%\app.exe');
    });
  });

  group('MyAppReleases', () {
    Map<String, Object?> releaseJson() => {
          'tag_name': 'v0.1.1',
          'html_url': 'https://github.com/me/app/releases/tag/v0.1.1',
          'assets': [
            {
              'name': 'app-0.1.1-windows-x64.zip',
              'browser_download_url': 'https://dl/app.zip',
              'url': 'https://api/assets/1',
              'size': 10,
            },
            {
              'name': 'app-0.1.1-setup.exe',
              'browser_download_url': 'https://dl/app-setup.exe',
              'url': 'https://api/assets/2',
              'size': 20,
            },
            {
              'name': 'app-0.1.1.apk',
              'browser_download_url': 'https://dl/app.apk',
              'size': 30,
            },
          ],
        };

    test('finds the Windows installer and the APK', () async {
      final releases = MyAppReleases(
        client: MockClient((request) async {
          expect(request.url.path, '/repos/me/app/releases/latest');
          expect(request.headers.containsKey('Authorization'), isFalse);
          return http.Response(jsonEncode(releaseJson()), 200);
        }),
      );
      final result = await releases.latest('me/app');
      expect(result.problem, isNull);
      expect(result.release!.tag, 'v0.1.1');
      expect(result.release!.windowsInstaller!.name, 'app-0.1.1-setup.exe');
      expect(result.release!.windowsInstaller!.apiUrl, 'https://api/assets/2');
      expect(result.release!.apk!.url, 'https://dl/app.apk');
    });

    test('sends the token only when given one', () async {
      final releases = MyAppReleases(
        client: MockClient((request) async {
          expect(request.headers['Authorization'], 'Bearer t0k');
          return http.Response(jsonEncode(releaseJson()), 200);
        }),
      );
      expect(
          (await releases.latest('me/app', token: 't0k')).release, isNotNull);
    });

    test('names each failure', () async {
      Future<MyAppReleaseProblem?> problemFor(int status) async {
        final releases = MyAppReleases(
          client: MockClient((_) async => http.Response('{}', status)),
        );
        return (await releases.latest('me/app')).problem;
      }

      expect(await problemFor(404), MyAppReleaseProblem.notVisible);
      expect(await problemFor(401), MyAppReleaseProblem.tokenRejected);
      expect(await problemFor(500), MyAppReleaseProblem.unreachable);

      final offline = MyAppReleases(
        client: MockClient((_) async => throw const SocketException('down')),
      );
      expect(
        (await offline.latest('me/app')).problem,
        MyAppReleaseProblem.unreachable,
      );
    });
  });
}
