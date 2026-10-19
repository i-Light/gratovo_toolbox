import 'dart:developer' as developer;
import 'dart:io';
import 'dart:typed_data';

import 'package:gratovo_toolbox/core/my_apps/my_app_entry.dart';
import 'package:gratovo_toolbox/core/update/app_version.dart';
import 'package:gratovo_toolbox/core/update/github_release_source.dart';
import 'package:gratovo_toolbox/core/update/update_installer.dart';

/// Finds, starts and installs the owner's other Windows apps.
///
/// Windows only: the registry describes Windows programs (`windows.exe`),
/// and there is nothing comparable to start on macOS or Linux yet.
class MyAppsHost {
  const MyAppsHost();

  bool get canRunPrograms => Platform.isWindows;

  /// The first listed path that exists, expanded, or null.
  Future<String?> installedPath(MyAppWindows windows) async {
    if (!canRunPrograms) return null;
    for (final raw in windows.exe) {
      // The list is written with forward slashes (no JSON escaping to get
      // wrong); Windows paths are handed out with its own separator.
      final path =
          expandWindowsEnv(raw, Platform.environment).replaceAll('/', r'\');
      if (await File(path).exists()) return path;
    }
    return null;
  }

  /// The program's own icon as PNG bytes, or null when it cannot be read.
  ///
  /// Asked of Windows itself (the shell's associated icon, through
  /// PowerShell) and kept in the temp folder, so the ~1s cost is paid once
  /// per install; a newer .exe replaces the cached picture.
  Future<Uint8List?> iconPng(String exePath) async {
    if (!canRunPrograms) return null;
    try {
      final dir = Directory('${Directory.systemTemp.path}\\gratovo_my_apps');
      await dir.create(recursive: true);
      final name = exePath.replaceAll(RegExp('[^A-Za-z0-9]'), '_');
      final png = File('${dir.path}\\$name.png');
      if (!await png.exists() ||
          (await png.lastModified())
              .isBefore(await File(exePath).lastModified())) {
        // Paths travel in the environment, so no quoting can go wrong.
        final result = await Process.run(
          'powershell',
          const [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Add-Type -AssemblyName System.Drawing;'
                r'$i=[System.Drawing.Icon]::ExtractAssociatedIcon($env:GR_EXE);'
                r'$i.ToBitmap().Save($env:GR_OUT,'
                '[System.Drawing.Imaging.ImageFormat]::Png)',
          ],
          environment: {'GR_EXE': exePath, 'GR_OUT': png.path},
        );
        if (result.exitCode != 0 || !await png.exists()) return null;
      }
      return await png.readAsBytes();
    } catch (error, stackTrace) {
      _log('Could not read the icon of $exePath.', error, stackTrace);
      return null;
    }
  }

  /// Started detached, from its own folder, so it outlives this app and
  /// finds the DLLs and data it keeps beside itself.
  Future<bool> launch(String path) async {
    try {
      await Process.start(
        path,
        const [],
        workingDirectory: File(path).parent.path,
        mode: ProcessStartMode.detached,
      );
      return true;
    } catch (error, stackTrace) {
      _log('Could not start $path.', error, stackTrace);
      return false;
    }
  }

  /// The updater's own download (temp folder, `.part` then rename, the
  /// private-repo redirect handled by hand), pointed at another repo's asset.
  Future<String?> download(
    ReleaseAsset asset, {
    required String tag,
    required String pageUrl,
    String? token,
    void Function(double progress)? onProgress,
  }) {
    final release = UpdateRelease(
      // Only the asset is used; the version is for this app's own updates.
      version: AppVersion.tryParse(tag) ?? const AppVersion(0, 0, 0),
      tag: tag,
      releasePageUrl: pageUrl,
      installer: asset,
    );
    return const UpdateInstaller().download(
      release,
      token: token,
      onProgress: onProgress,
    );
  }

  /// Hands the downloaded setup to Windows. The installer shows its own
  /// wizard; this does not wait for it.
  Future<bool> runInstaller(String path) async {
    try {
      await Process.start(path, const [], mode: ProcessStartMode.detached);
      return true;
    } catch (error, stackTrace) {
      _log('Could not start the installer $path.', error, stackTrace);
      return false;
    }
  }

  static void _log(String message, Object error, StackTrace stackTrace) {
    developer.log(
      message,
      name: 'gratovo.my_apps',
      level: 900,
      error: error,
      stackTrace: stackTrace,
    );
  }
}
