import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:window_manager/window_manager.dart';

/// Whether the app window is pinned above all other windows.
abstract final class AlwaysOnTopStore {
  static bool get isAvailable =>
      !kIsWeb && (Platform.isWindows || Platform.isMacOS || Platform.isLinux);

  static Future<bool> isEnabled() async {
    if (!isAvailable) return false;
    return windowManager.isAlwaysOnTop();
  }

  static Future<void> enable() async {
    if (!isAvailable) return;
    await windowManager.setAlwaysOnTop(true);
  }

  static Future<void> disable() async {
    if (!isAvailable) return;
    await windowManager.setAlwaysOnTop(false);
  }
}
