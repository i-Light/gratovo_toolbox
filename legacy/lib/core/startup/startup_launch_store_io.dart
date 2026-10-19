import 'dart:io';

import 'package:win32_registry/win32_registry.dart';

/// Desktop implementation of the launch-at-login toggle.
///
/// Windows: a value under the current user's Run key — the same mechanism
/// `launch_at_startup` used, written directly against a current
/// `win32_registry` instead of through that (unmaintained, `win32`-5.x-
/// pinned) package.
///
/// Linux: a `.desktop` file in `~/.config/autostart/`.
///
/// macOS: not wired up yet — needs a small native `SMAppService` hook via
/// a platform channel, the one part pure Dart can't do. [isAvailable] is
/// false there until that's added.
class StartupLaunchStore {
  StartupLaunchStore._();

  static const _runKeyPath = r'Software\Microsoft\Windows\CurrentVersion\Run';

  static String? _appName;
  static String? _appPath;

  static bool get isAvailable => Platform.isWindows || Platform.isLinux;

  static void setup({required String appName, required String appPath}) {
    _appName = appName;
    _appPath = appPath;
  }

  static Future<bool> isEnabled() async {
    if (Platform.isWindows) return _windowsIsEnabled();
    if (Platform.isLinux) return _linuxDesktopFile().existsSync();
    return false;
  }

  static Future<bool> enable() async {
    if (Platform.isWindows) return _windowsSetEnabled(true);
    if (Platform.isLinux) return _linuxEnable();
    return false;
  }

  static Future<bool> disable() async {
    if (Platform.isWindows) return _windowsSetEnabled(false);
    if (Platform.isLinux) return _linuxDisable();
    return false;
  }

  // --- Windows ---

  static bool _windowsIsEnabled() {
    final key = CURRENT_USER.open(_runKeyPath);
    final value = key.getString(_appName ?? '');
    key.close();
    return value != null;
  }

  static bool _windowsSetEnabled(bool enabled) {
    final appName = _appName;
    final appPath = _appPath;
    if (appName == null || appPath == null) return false;
    final key = CURRENT_USER.open(
      _runKeyPath,
      config: const RegistryOpenConfig(access: RegistryAccess.readWrite),
    );
    if (enabled) {
      key.setValue(appName, RegistryValue.string('"$appPath"'));
    } else {
      key.removeValue(appName);
    }
    key.close();
    return true;
  }

  // --- Linux ---

  static File _linuxDesktopFile() {
    final home = Platform.environment['HOME'] ?? '';
    final name = (_appName ?? 'app').replaceAll(' ', '_');
    return File('$home/.config/autostart/$name.desktop');
  }

  static Future<bool> _linuxEnable() async {
    final appPath = _appPath;
    if (appPath == null) return false;
    final file = _linuxDesktopFile();
    await file.create(recursive: true);
    await file.writeAsString(
      '[Desktop Entry]\n'
      'Type=Application\n'
      'Name=${_appName ?? 'App'}\n'
      'Exec=$appPath\n'
      'X-GNOME-Autostart-enabled=true\n',
    );
    return true;
  }

  static Future<bool> _linuxDisable() async {
    final file = _linuxDesktopFile();
    if (file.existsSync()) await file.delete();
    return true;
  }
}
