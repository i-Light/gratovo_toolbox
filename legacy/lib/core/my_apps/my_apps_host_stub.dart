import 'dart:typed_data';

import 'package:gratovo_toolbox/core/my_apps/my_app_entry.dart';
import 'package:gratovo_toolbox/core/update/github_release_source.dart';

/// Web build: a browser tab cannot look at the disk or start a program, so
/// the card offers only links.
class MyAppsHost {
  const MyAppsHost();

  bool get canRunPrograms => false;

  Future<String?> installedPath(MyAppWindows windows) async => null;

  Future<Uint8List?> iconPng(String exePath) async => null;

  Future<bool> launch(String path) async => false;

  Future<String?> download(
    ReleaseAsset asset, {
    required String tag,
    required String pageUrl,
    String? token,
    void Function(double progress)? onProgress,
  }) async =>
      null;

  Future<bool> runInstaller(String path) async => false;
}
