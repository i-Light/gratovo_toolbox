import 'package:gratovo_toolbox/core/update/github_release_source.dart';
import 'package:gratovo_toolbox/core/update/update_plan.dart';

/// Web/no-io build: there is no install directory to swap, so every call is
/// a no-op that reports failure. `UpdateController` never gets as far as
/// calling these because [canSelfUpdate] is false, but they exist so the
/// controller needs no conditional imports of its own.
class UpdateInstaller {
  const UpdateInstaller();

  bool get canSelfUpdate => false;

  String get installDirPath => '';

  String get pathSeparator => '/';

  Future<bool> canWriteTo(String dir) async => false;

  Future<String?> download(
    UpdateRelease release, {
    String? token,
    void Function(double progress)? onProgress,
  }) async =>
      null;

  Future<bool> install(
    String downloadedPath, {
    required UpdatePlan plan,
    bool allowElevation = true,
  }) async =>
      false;

  Future<void> quitForUpdate() async {}
}
