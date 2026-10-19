import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/update/app_version.dart';
import 'package:gratovo_toolbox/core/update/github_release_source.dart';
import 'package:gratovo_toolbox/core/update/update_controller.dart';
import 'package:gratovo_toolbox/core/update/update_installer.dart';
import 'package:gratovo_toolbox/core/update/update_plan.dart';
import 'package:gratovo_toolbox/core/update/update_sync_gate.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// A release payload shaped like the one `release.yml` produces: one `.zip`
/// asset named after the staged folder.
Map<String, dynamic> _releaseJson(
  String tag, {
  String assetName = 'gratovo_toolbox-9.9.9-windows-x64.zip',
  bool draft = false,
  bool prerelease = false,
  List<Map<String, dynamic>>? assets,
}) {
  return {
    'tag_name': tag,
    'draft': draft,
    'prerelease': prerelease,
    'html_url': 'https://github.com/$kUpdateRepoSlug/releases/tag/$tag',
    'body': 'notes',
    'assets': assets ??
        [
          {
            'name': assetName,
            'browser_download_url': 'https://example.invalid/$assetName',
            'size': 1234,
          },
        ],
  };
}

class _FakeSource extends GithubReleaseSource {
  _FakeSource(this.release);

  final UpdateRelease? release;
  int calls = 0;

  @override
  Future<UpdateRelease?> fetchLatest() async {
    calls++;
    return release;
  }
}

class _FakeInstaller extends UpdateInstaller {
  _FakeInstaller({
    this.silent = true,
    this.downloadSucceeds = true,
    this.installSucceeds = true,
  });

  bool silent;
  bool downloadSucceeds;
  bool installSucceeds;

  int downloads = 0;
  int installs = 0;
  bool quit = false;
  bool? lastAllowElevation;
  String? lastToken;
  UpdatePlan? lastPlan;

  @override
  bool get canSelfUpdate => true;

  @override
  String get installDirPath => r'C:\Program Files\Gratovo IMA ToolBox';

  @override
  String get pathSeparator => r'\';

  @override
  Future<bool> canWriteTo(String dir) async => silent;

  @override
  Future<String?> download(
    UpdateRelease release, {
    String? token,
    void Function(double progress)? onProgress,
  }) async {
    downloads++;
    lastToken = token;
    if (!downloadSucceeds) return null;
    onProgress?.call(1);
    return r'C:\temp\update.zip';
  }

  @override
  Future<bool> install(
    String downloadedPath, {
    required UpdatePlan plan,
    bool allowElevation = true,
  }) async {
    installs++;
    lastPlan = plan;
    lastAllowElevation = allowElevation;
    return installSucceeds;
  }

  @override
  Future<void> quitForUpdate() async => quit = true;
}

/// A sync gate that reports whatever the test wants. The default — drains
/// instantly — is the ordinary case: nothing queued, nothing in flight.
class _FakeGate implements UpdateSyncGate {
  _FakeGate({this.drains = true});

  bool drains;
  int calls = 0;

  @override
  Future<bool> drain({Duration timeout = kUpdateSyncDrainTimeout}) async {
    calls++;
    return drains;
  }
}

ProviderContainer _container(
  _FakeSource source,
  _FakeInstaller installer, {
  _FakeGate? gate,
}) {
  final container = ProviderContainer(
    overrides: [
      updateProvider.overrideWith(
        () => UpdateController(
          source: source,
          installer: installer,
          syncGate: gate ?? _FakeGate(),
        ),
      ),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

/// Lets the startup check, the download and the install chain settle. The
/// controller's restart grace is real wall-clock time, so anything that ends
/// in a quit is driven explicitly rather than waited on here.
Future<void> _settle() => pumpEventQueue(times: 50);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    PackageInfo.setMockInitialValues(
      appName: 'gratovo_toolbox',
      packageName: 'com.gratovo.toolbox',
      version: '1.4.2',
      buildNumber: '13',
      buildSignature: '',
    );
  });

  group('AppVersion', () {
    test('parses pubspec and tag spellings, ignoring the build number', () {
      expect(AppVersion.tryParse('1.2.2+13').toString(), '1.2.2');
      expect(AppVersion.tryParse('v1.2.2').toString(), '1.2.2');
      expect(AppVersion.tryParse('  1.2.2  ').toString(), '1.2.2');
    });

    test('refuses anything that is not three numbers', () {
      expect(AppVersion.tryParse(null), isNull);
      expect(AppVersion.tryParse(''), isNull);
      expect(AppVersion.tryParse('1.2'), isNull);
      expect(AppVersion.tryParse('latest'), isNull);
    });

    test('orders by major, then minor, then patch', () {
      expect(AppVersion.tryParse('1.10.0')! > AppVersion.tryParse('1.9.9')!,
          isTrue);
      expect(AppVersion.tryParse('2.0.0')! > AppVersion.tryParse('1.99.99')!,
          isTrue);
      expect(AppVersion.tryParse('1.4.8')! > AppVersion.tryParse('1.4.2')!,
          isTrue);
    });

    test('classifies the jump the way the install rule needs', () {
      final current = AppVersion.tryParse('1.4.2')!;
      expect(
        current.kindOfUpgradeTo(AppVersion.tryParse('1.4.8')!),
        UpdateKind.patch,
      );
      expect(
        current.kindOfUpgradeTo(AppVersion.tryParse('1.6.2')!),
        UpdateKind.minor,
      );
      expect(
        current.kindOfUpgradeTo(AppVersion.tryParse('2.0.0')!),
        UpdateKind.major,
      );
    });

    test('same or older is never an upgrade', () {
      final current = AppVersion.tryParse('1.4.2')!;
      expect(current.kindOfUpgradeTo(AppVersion.tryParse('1.4.2')!), isNull);
      expect(current.kindOfUpgradeTo(AppVersion.tryParse('1.4.1')!), isNull);
      expect(current.kindOfUpgradeTo(AppVersion.tryParse('0.9.9')!), isNull);
    });
  });

  group('GithubReleaseSource.parse', () {
    test('reads the version and the .zip asset out of a release', () {
      final release = GithubReleaseSource.parse(_releaseJson('v1.4.8'))!;
      expect(release.version.toString(), '1.4.8');
      expect(release.tag, 'v1.4.8');
      expect(release.sizeBytes, 1234);
      expect(release.downloadUrl, endsWith('.zip'));
    });

    test('skips drafts and pre-releases', () {
      expect(
        GithubReleaseSource.parse(_releaseJson('v1.4.8', draft: true)),
        isNull,
      );
      expect(
        GithubReleaseSource.parse(_releaseJson('v1.4.8', prerelease: true)),
        isNull,
      );
    });

    test('an installer-only release is an update, via the installer', () {
      final release = GithubReleaseSource.parse(
        _releaseJson('v1.4.8', assets: [
          {
            'name': 'gratovo_toolbox-1.4.8-setup.exe',
            'browser_download_url': 'https://example.invalid/setup.exe',
            'size': 10,
          },
        ]),
      )!;
      expect(release.hasInstaller, isTrue);
      expect(release.archive, isNull);
      expect(UpdatePlan.artifactFor(release), UpdateArtifact.installer);
    });

    test('the installer is preferred when a release carries both', () {
      final release = GithubReleaseSource.parse(
        _releaseJson('v1.4.8', assets: [
          {
            'name': 'gratovo_toolbox-1.4.8-windows-x64.zip',
            'browser_download_url': 'https://example.invalid/a.zip',
            'size': 10,
          },
          {
            'name': 'gratovo_toolbox-1.4.8-setup.exe',
            'browser_download_url': 'https://example.invalid/setup.exe',
            'size': 20,
          },
        ]),
      )!;
      expect(UpdatePlan.artifactFor(release), UpdateArtifact.installer);
      expect(release.preferredAsset!.name, endsWith('setup.exe'));
      expect(release.archive, isNotNull, reason: 'the zip is still recorded');
    });

    test('a release with no usable artifact is not an update', () {
      expect(
        GithubReleaseSource.parse(_releaseJson('v1.4.8', assets: [])),
        isNull,
      );
      expect(
        GithubReleaseSource.parse(
          _releaseJson('v1.4.8', assets: [
            {
              'name': 'release-notes.txt',
              'browser_download_url': 'https://example.invalid/n.txt',
              'size': 10,
            },
          ]),
        ),
        isNull,
      );
    });

    test('an unparseable tag is not an update', () {
      expect(GithubReleaseSource.parse(_releaseJson('nightly')), isNull);
    });
  });

  group('UpdateController', () {
    test('a patch installs itself and quits', () async {
      final installer = _FakeInstaller();
      final source =
          _FakeSource(GithubReleaseSource.parse(_releaseJson('v1.4.8')));
      final container = _container(source, installer);
      container.read(updateProvider);
      await _settle();

      expect(container.read(updateProvider).kind, UpdateKind.patch);
      expect(installer.downloads, 1);
      expect(installer.installs, 1);
      // The automatic path must not be allowed to raise a UAC prompt.
      expect(installer.lastAllowElevation, isFalse);
      expect(container.read(updateProvider).phase, UpdatePhase.installing);
    });

    test('a minor downloads but waits for a press', () async {
      final installer = _FakeInstaller();
      final source =
          _FakeSource(GithubReleaseSource.parse(_releaseJson('v1.6.2')));
      final container = _container(source, installer);
      container.read(updateProvider);
      await _settle();

      final state = container.read(updateProvider);
      expect(state.kind, UpdateKind.minor);
      expect(state.phase, UpdatePhase.readyToInstall);
      expect(state.canInstallNow, isTrue);
      expect(installer.downloads, 1);
      expect(installer.installs, 0, reason: 'must wait for the Update button');
    });

    test('a major waits too', () async {
      final installer = _FakeInstaller();
      final source =
          _FakeSource(GithubReleaseSource.parse(_releaseJson('v2.0.0')));
      final container = _container(source, installer);
      container.read(updateProvider);
      await _settle();

      expect(container.read(updateProvider).kind, UpdateKind.major);
      expect(container.read(updateProvider).phase, UpdatePhase.readyToInstall);
      expect(installer.installs, 0);
    });

    test('a patch that would need admin rights waits for a press', () async {
      final installer = _FakeInstaller(silent: false);
      final source =
          _FakeSource(GithubReleaseSource.parse(_releaseJson('v1.4.8')));
      final container = _container(source, installer);
      container.read(updateProvider);
      await _settle();

      final state = container.read(updateProvider);
      expect(state.kind, UpdateKind.patch);
      expect(state.phase, UpdatePhase.readyToInstall);
      expect(installer.installs, 0, reason: 'no surprise UAC prompt');
      expect(state.canInstallNow, isTrue);
    });

    test('nothing newer leaves no update and no badge', () async {
      final installer = _FakeInstaller();
      final source =
          _FakeSource(GithubReleaseSource.parse(_releaseJson('v1.4.2')));
      final container = _container(source, installer);
      container.read(updateProvider);
      await _settle();

      final state = container.read(updateProvider);
      expect(state.phase, UpdatePhase.upToDate);
      expect(state.hasUpdate, isFalse);
      expect(installer.downloads, 0);
    });

    test('an unreachable GitHub is not an update and not an error', () async {
      final installer = _FakeInstaller();
      final source = _FakeSource(null);
      final container = _container(source, installer);
      container.read(updateProvider);
      await _settle();

      final state = container.read(updateProvider);
      expect(state.phase, UpdatePhase.upToDate);
      expect(state.hasUpdate, isFalse);
      expect(state.lastCheck, isNotNull);
    });

    test('a failed download clears the badge instead of advertising it',
        () async {
      final installer = _FakeInstaller(downloadSucceeds: false);
      final source =
          _FakeSource(GithubReleaseSource.parse(_releaseJson('v1.6.2')));
      final container = _container(source, installer);
      container.read(updateProvider);
      await _settle();

      final state = container.read(updateProvider);
      expect(state.phase, UpdatePhase.upToDate);
      expect(state.hasUpdate, isFalse);
      expect(state.canInstallNow, isFalse);
    });

    test('an install that cannot start keeps the download for a retry',
        () async {
      final installer = _FakeInstaller(silent: false, installSucceeds: false);
      final source =
          _FakeSource(GithubReleaseSource.parse(_releaseJson('v1.6.2')));
      final container = _container(source, installer);
      container.read(updateProvider);
      await _settle();

      await container.read(updateProvider.notifier).installNow();

      final state = container.read(updateProvider);
      expect(state.phase, UpdatePhase.readyToInstall);
      expect(state.canInstallNow, isTrue);
      expect(installer.quit, isFalse);
    });

    test('a staged download is not re-checked or re-downloaded', () async {
      final installer = _FakeInstaller();
      final source =
          _FakeSource(GithubReleaseSource.parse(_releaseJson('v1.6.2')));
      final container = _container(source, installer);
      container.read(updateProvider);
      await _settle();

      expect(source.calls, 1);
      await container.read(updateProvider.notifier).check();
      expect(source.calls, 1, reason: 'the staged .zip is still good');
      expect(installer.downloads, 1);
    });

    test('a manual press is allowed to raise the elevation prompt', () async {
      final installer = _FakeInstaller(silent: false);
      final source =
          _FakeSource(GithubReleaseSource.parse(_releaseJson('v1.6.2')));
      final container = _container(source, installer);
      container.read(updateProvider);
      await _settle();

      // Not awaited: installNow sleeps out the restart grace before quitting,
      // and the elevation flag is set well before that.
      unawaited(container.read(updateProvider.notifier).installNow());
      await pumpEventQueue();

      expect(installer.lastAllowElevation, isTrue);
    });
  });

  group('http wiring', () {
    test('a non-200 from GitHub yields no release', () async {
      final source = GithubReleaseSource(
        client: MockClient(
          (_) async => http.Response('{"message":"Not Found"}', 404),
        ),
      );
      expect(await source.fetchLatest(), isNull);
    });

    test('a 200 is parsed into a release', () async {
      final source = GithubReleaseSource(
        client: MockClient(
          (_) async => http.Response(jsonEncode(_releaseJson('v1.4.8')), 200),
        ),
      );
      expect((await source.fetchLatest())!.version.toString(), '1.4.8');
    });
  });

  group('UpdatePlan', () {
    UpdateRelease release(String v) =>
        GithubReleaseSource.parse(_releaseJson('v$v'.replaceAll(r'$v', v)))!;

    UpdatePlan plan(String version, UpdateKind kind, {String? dir}) =>
        UpdatePlan.decide(
          release: release(version),
          kind: kind,
          currentInstallDir: dir ?? r'C:\Program Files\Gratovo IMA ToolBox',
          pathSeparator: r'\',
        );

    test('a patch replaces the build it patches', () {
      final p = plan('1.4.8', UpdateKind.patch);
      expect(p.inPlace, isTrue);
      expect(p.targetDir, r'C:\Program Files\Gratovo IMA ToolBox');
    });

    test('a minor goes into its own folder beside the old one', () {
      final p = plan('1.6.2', UpdateKind.minor);
      expect(p.inPlace, isFalse);
      expect(p.targetDir, r'C:\Program Files\Gratovo IMA ToolBox 1.6.2');
    });

    test('a major goes side by side too', () {
      final p = plan('2.0.0', UpdateKind.major);
      expect(p.inPlace, isFalse);
      expect(p.targetDir, r'C:\Program Files\Gratovo IMA ToolBox 2.0.0');
    });

    test('versions do not pile up in the folder name', () {
      // Upgrading a side-by-side install again must replace the version in the
      // leaf, not append to it.
      final p = plan(
        '1.7.0',
        UpdateKind.minor,
        dir: r'C:\Program Files\Gratovo IMA ToolBox 1.6.2',
      );
      expect(p.targetDir, r'C:\Program Files\Gratovo IMA ToolBox 1.7.0');
    });

    test('a trailing separator on the install dir is not doubled', () {
      final p = plan(
        '1.6.2',
        UpdateKind.minor,
        dir: r'C:\Program Files\Gratovo IMA ToolBox\',
      );
      expect(p.targetDir, r'C:\Program Files\Gratovo IMA ToolBox 1.6.2');
    });
  });

  group('sync drain', () {
    test('an install waits for replication and then proceeds', () async {
      final installer = _FakeInstaller();
      final gate = _FakeGate();
      final source =
          _FakeSource(GithubReleaseSource.parse(_releaseJson('v1.6.2')));
      final container = _container(source, installer, gate: gate);
      container.read(updateProvider);
      await _settle();

      unawaited(container.read(updateProvider.notifier).installNow());
      await pumpEventQueue();

      expect(gate.calls, 1, reason: 'drained before quitting');
      expect(installer.installs, 1);
    });

    test('a sync that will not drain asks instead of quitting', () async {
      final installer = _FakeInstaller();
      final gate = _FakeGate(drains: false);
      final source =
          _FakeSource(GithubReleaseSource.parse(_releaseJson('v1.6.2')));
      final container = _container(source, installer, gate: gate);
      container.read(updateProvider);
      await _settle();

      await container.read(updateProvider.notifier).installNow();

      expect(
        container.read(updateProvider).phase,
        UpdatePhase.awaitingConfirmation,
      );
      expect(installer.installs, 0, reason: 'nothing quits behind their back');
      expect(installer.quit, isFalse);
    });

    test('insisting through the confirmation skips the drain', () async {
      final installer = _FakeInstaller();
      final gate = _FakeGate(drains: false);
      final source =
          _FakeSource(GithubReleaseSource.parse(_releaseJson('v1.6.2')));
      final container = _container(source, installer, gate: gate);
      container.read(updateProvider);
      await _settle();
      await container.read(updateProvider.notifier).installNow();

      unawaited(
        container.read(updateProvider.notifier).installNow(force: true),
      );
      await pumpEventQueue();

      expect(installer.installs, 1);
      expect(gate.calls, 1, reason: 'the forced call does not drain again');
    });

    test('cancelling keeps the download staged', () async {
      final installer = _FakeInstaller();
      final gate = _FakeGate(drains: false);
      final source =
          _FakeSource(GithubReleaseSource.parse(_releaseJson('v1.6.2')));
      final container = _container(source, installer, gate: gate);
      container.read(updateProvider);
      await _settle();
      await container.read(updateProvider.notifier).installNow();

      container.read(updateProvider.notifier).cancelConfirmation();

      final state = container.read(updateProvider);
      expect(state.phase, UpdatePhase.readyToInstall);
      expect(state.canInstallNow, isTrue);
      expect(installer.installs, 0);
    });

    test('an unattended patch stands down rather than interrupting a sync',
        () async {
      final installer = _FakeInstaller();
      final gate = _FakeGate(drains: false);
      final source =
          _FakeSource(GithubReleaseSource.parse(_releaseJson('v1.4.8')));
      final container = _container(source, installer, gate: gate);
      container.read(updateProvider);
      await _settle();

      final state = container.read(updateProvider);
      expect(state.kind, UpdateKind.patch);
      expect(state.phase, UpdatePhase.readyToInstall,
          reason:
              'staged, not forced through, and not a dialog nobody asked for');
      expect(installer.installs, 0);
    });
  });
}
