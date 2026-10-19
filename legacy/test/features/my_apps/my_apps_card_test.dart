import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/github/github_token_provider.dart';
import 'package:gratovo_toolbox/core/my_apps/my_app_entry.dart';
import 'package:gratovo_toolbox/core/my_apps/my_app_releases.dart';
import 'package:gratovo_toolbox/core/my_apps/my_apps_host.dart';
import 'package:gratovo_toolbox/core/native/url_launcher_provider.dart';
import 'package:gratovo_toolbox/core/update/github_release_source.dart';
import 'package:gratovo_toolbox/features/my_apps/application/my_apps_controller.dart';
import 'package:gratovo_toolbox/features/my_apps/presentation/my_apps_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

class _FakeHost implements MyAppsHost {
  _FakeHost({this.canRunPrograms = true, this.installed});

  @override
  final bool canRunPrograms;

  /// What [installedPath] answers; tests flip it to simulate an install.
  String? installed;

  final launched = <String>[];
  final downloads = <({String asset, String? token})>[];
  final installers = <String>[];

  @override
  Future<String?> installedPath(MyAppWindows windows) async => installed;

  @override
  Future<Uint8List?> iconPng(String exePath) async => null;

  @override
  Future<bool> launch(String path) async {
    launched.add(path);
    return true;
  }

  @override
  Future<String?> download(
    ReleaseAsset asset, {
    required String tag,
    required String pageUrl,
    String? token,
    void Function(double progress)? onProgress,
  }) async {
    downloads.add((asset: asset.name, token: token));
    onProgress?.call(0.5);
    onProgress?.call(1);
    return 'C:/tmp/${asset.name}';
  }

  @override
  Future<bool> runInstaller(String path) async {
    installers.add(path);
    return true;
  }
}

class _FakeReleases implements MyAppReleases {
  _FakeReleases(this.result);

  final MyAppReleaseResult result;
  final calls = <({String repo, String? token})>[];

  @override
  Future<MyAppReleaseResult> latest(String repo, {String? token}) async {
    calls.add((repo: repo, token: token));
    return result;
  }
}

const _release = MyAppRelease(
  tag: 'v0.1.1',
  pageUrl: 'https://github.com/me/app/releases/tag/v0.1.1',
  windowsInstaller: ReleaseAsset(
    name: 'app-0.1.1-setup.exe',
    url: 'https://dl/app-setup.exe',
  ),
  apk: ReleaseAsset(name: 'app.apk', url: 'https://dl/app.apk'),
);

MyAppsRegistry _registry({
  bool private = false,
  bool playStore = false,
  bool apk = false,
  bool windows = true,
}) =>
    MyAppsRegistry.parse(
      jsonEncode({
        'apps': [
          {
            'id': 'app',
            'name': 'The App',
            'description': {'en': 'Does things.'},
            'github': {'repo': 'me/app', 'private': private},
            if (windows)
              'windows': {
                'exe': ['%LOCALAPPDATA%/Programs/App/app.exe'],
              },
            'android': {
              'package': 'com.me.app',
              'playStore': playStore,
              'apk': apk,
            },
          },
        ],
      }),
    );

Future<List<Uri>> _pump(
  WidgetTester tester, {
  required _FakeHost host,
  _FakeReleases? releases,
  MyAppsRegistry? registry,
}) async {
  tester.view.physicalSize = const Size(900, 1200);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final opened = <Uri>[];
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        myAppsRegistryProvider
            .overrideWith((ref) async => registry ?? _registry()),
        myAppsHostProvider.overrideWithValue(host),
        myAppReleasesProvider.overrideWithValue(
          releases ?? _FakeReleases((release: _release, problem: null)),
        ),
        githubTokenProvider.overrideWith(
          (ref) async =>
              (token: 'personal', source: GithubTokenSource.personal),
        ),
        urlLauncherProvider.overrideWithValue((uri) async {
          opened.add(uri);
          return true;
        }),
      ],
      child: const MaterialApp(
        localizationsDelegates: [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: SingleChildScrollView(child: MyAppsCard())),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return opened;
}

String _status(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const Key('my-app-status-app'))).data!;

void main() {
  testWidgets('an installed app says so and opens', (tester) async {
    final host = _FakeHost(installed: r'C:\Programs\App\app.exe');
    await _pump(tester, host: host);

    expect(find.text('The App'), findsOneWidget);
    expect(find.text('Does things.'), findsOneWidget);
    expect(_status(tester), 'Installed on this computer');
    expect(find.byKey(const Key('my-app-install-app')), findsNothing);

    await tester.tap(find.byKey(const Key('my-app-open-app')));
    await tester.pumpAndSettle();
    expect(host.launched, [r'C:\Programs\App\app.exe']);
  });

  testWidgets(
      'install downloads the public release anonymously, starts the '
      'installer, and offers Open once the app appears', (tester) async {
    final host = _FakeHost();
    final releases = _FakeReleases((release: _release, problem: null));
    await _pump(tester, host: host, releases: releases);

    expect(_status(tester), 'Not installed on this computer');
    await tester.tap(find.byKey(const Key('my-app-install-app')));
    await tester.pump();
    await tester.pump();

    expect(releases.calls, [(repo: 'me/app', token: null)]);
    expect(host.downloads, [(asset: 'app-0.1.1-setup.exe', token: null)]);
    expect(host.installers, ['C:/tmp/app-0.1.1-setup.exe']);
    expect(_status(tester), startsWith('The installer is open.'));
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('my-app-install-app')))
          .onPressed,
      isNull,
    );

    host.installed = r'C:\Programs\App\app.exe';
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('my-app-open-app')), findsOneWidget);
    expect(_status(tester), 'Installed on this computer');
  });

  testWidgets('a private repository is read with the signed-in token',
      (tester) async {
    final host = _FakeHost();
    final releases = _FakeReleases((release: _release, problem: null));
    await _pump(
      tester,
      host: host,
      releases: releases,
      registry: _registry(private: true),
    );

    expect(find.byIcon(Icons.lock_outline), findsOneWidget);
    await tester.tap(find.byKey(const Key('my-app-install-app')));
    await tester.pump();
    await tester.pump();
    expect(releases.calls.single.token, 'personal');
    expect(host.downloads.single.token, 'personal');
    // Let the post-install watch run out.
    host.installed = 'x';
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
  });

  testWidgets('a repository GitHub will not show downloads nothing',
      (tester) async {
    final host = _FakeHost();
    await _pump(
      tester,
      host: host,
      releases: _FakeReleases(
        (release: null, problem: MyAppReleaseProblem.notVisible),
      ),
      registry: _registry(private: true),
    );

    await tester.tap(find.byKey(const Key('my-app-install-app')));
    await tester.pumpAndSettle();
    expect(host.downloads, isEmpty);
    expect(host.installers, isEmpty);
    // Back to idle: the button can be pressed again.
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('my-app-install-app')))
          .onPressed,
      isNotNull,
    );
    await tester.pump(const Duration(seconds: 10));
  });

  testWidgets('a release without a Windows installer opens its page instead',
      (tester) async {
    final host = _FakeHost();
    final opened = await _pump(
      tester,
      host: host,
      releases: _FakeReleases((
        release: const MyAppRelease(tag: 'v1', pageUrl: 'https://page'),
        problem: null,
      )),
    );

    await tester.tap(find.byKey(const Key('my-app-install-app')));
    await tester.pumpAndSettle();
    expect(host.downloads, isEmpty);
    expect(opened, [Uri.parse('https://page')]);
    await tester.pump(const Duration(seconds: 10));
  });

  testWidgets('links: GitHub everywhere, Google Play when listed',
      (tester) async {
    final opened = await _pump(
      tester,
      host: _FakeHost(installed: 'x'),
      registry: _registry(playStore: true),
    );

    await tester.tap(find.byKey(const Key('my-app-github-app')));
    await tester.tap(find.byKey(const Key('my-app-play-app')));
    await tester.pumpAndSettle();
    expect(opened, [
      Uri.parse('https://github.com/me/app'),
      Uri.parse('https://play.google.com/store/apps/details?id=com.me.app'),
    ]);
  });

  testWidgets('without program support there is no Open, Install or status',
      (tester) async {
    await _pump(tester, host: _FakeHost(canRunPrograms: false, installed: 'x'));

    expect(find.byKey(const Key('my-app-open-app')), findsNothing);
    expect(find.byKey(const Key('my-app-install-app')), findsNothing);
    expect(find.byKey(const Key('my-app-status-app')), findsNothing);
    expect(find.byKey(const Key('my-app-github-app')), findsOneWidget);
  });

  testWidgets('on Android an APK release is one tap away', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    try {
      final opened = await _pump(
        tester,
        host: _FakeHost(canRunPrograms: false),
        registry: _registry(apk: true, windows: false),
      );
      await tester.tap(find.byKey(const Key('my-app-apk-app')));
      await tester.pumpAndSettle();
      expect(opened, [Uri.parse('https://dl/app.apk')]);
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  testWidgets('entries the list could not read are shown', (tester) async {
    await _pump(
      tester,
      host: _FakeHost(),
      registry: MyAppsRegistry.parse('{"apps": [{"name": "no id"}]}'),
    );
    expect(find.textContaining('apps[0]: id is missing'), findsOneWidget);
    expect(find.textContaining('No apps listed yet'), findsOneWidget);
  });
}
