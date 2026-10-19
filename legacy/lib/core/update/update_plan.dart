import 'package:flutter/foundation.dart';
import 'package:gratovo_toolbox/core/update/app_version.dart';
import 'package:gratovo_toolbox/core/update/github_release_source.dart';

/// Which kind of artifact an update is being applied from.
enum UpdateArtifact {
  /// The Inno Setup `-setup.exe`. Preferred when a release carries one: it
  /// registers the app, writes the Start-menu and desktop shortcuts, and
  /// leaves an entry in Add/Remove Programs, none of which unzipping does.
  installer,

  /// The `-windows-x64.zip`. The fallback, and what every release has
  /// carried so far.
  archive,
}

/// Where an update is going and how it gets there — decided before anything
/// is downloaded, so the same decision can be shown to the user, logged, and
/// tested without touching the disk.
///
/// The two rules it encodes:
///
/// **A patch replaces the build it patches.** 1.4.2 -> 1.4.8 is a fix to the
/// version already installed and running, so it goes into the same folder.
/// Keeping a separate copy of every patch would turn a week of bugfixes into
/// a disk full of near-identical installs.
///
/// **A minor or major is installed beside the old one, not over it.** It gets
/// its own versioned folder and the previous install is left exactly as it
/// was, to be deleted by hand whenever the new one has proved itself. Nothing
/// in this app deletes a working install of itself.
///
/// The two can coexist because the data they share does not live in either
/// folder: `ScraperProcess.userDataDir()` is a fixed
/// `%LOCALAPPDATA%\Gratovo IMA ToolBox\data`, and `shared_preferences` and
/// `flutter_secure_storage` key off the app's identity rather than the path it
/// was launched from. An old install left on disk is therefore inert — it is
/// not consulted, it does not shadow anything, and it costs nothing but the
/// space.
@immutable
class UpdatePlan {
  const UpdatePlan({
    required this.release,
    required this.kind,
    required this.artifact,
    required this.targetDir,
    required this.inPlace,
  });

  final UpdateRelease release;
  final UpdateKind kind;
  final UpdateArtifact artifact;

  /// The folder the new build will end up in.
  final String targetDir;

  /// Whether [targetDir] is the folder the running app is in. True for a
  /// patch, false for the side-by-side minor/major install.
  final bool inPlace;

  /// Chooses the artifact: the installer when the release carries one, the
  /// .zip otherwise.
  static UpdateArtifact artifactFor(UpdateRelease release) =>
      release.hasInstaller ? UpdateArtifact.installer : UpdateArtifact.archive;

  /// Works out where [release] should land given the folder the running build
  /// is in.
  ///
  /// [currentInstallDir] is a path, not a `Directory`, so this stays a pure
  /// function — it is the one piece of the update that is worth being able to
  /// test exhaustively, and it should not need a filesystem to do it.
  static UpdatePlan decide({
    required UpdateRelease release,
    required UpdateKind kind,
    required String currentInstallDir,
    required String pathSeparator,
  }) {
    final artifact = artifactFor(release);
    if (kind == UpdateKind.patch) {
      return UpdatePlan(
        release: release,
        kind: kind,
        artifact: artifact,
        targetDir: currentInstallDir,
        inPlace: true,
      );
    }

    final trimmed = currentInstallDir.endsWith(pathSeparator)
        ? currentInstallDir.substring(0, currentInstallDir.length - 1)
        : currentInstallDir;
    final cut = trimmed.lastIndexOf(pathSeparator);
    final parent = cut <= 0 ? trimmed : trimmed.substring(0, cut);
    final leaf = cut < 0 ? trimmed : trimmed.substring(cut + 1);

    return UpdatePlan(
      release: release,
      kind: kind,
      artifact: artifact,
      targetDir:
          '$parent$pathSeparator${_versionedLeaf(leaf, release.version)}',
      inPlace: false,
    );
  }

  /// `Gratovo IMA ToolBox` -> `Gratovo IMA ToolBox 1.6.2`.
  ///
  /// A leaf that already ends in a version has it replaced rather than
  /// appended, so upgrading 1.5.0 -> 1.6.0 -> 1.7.0 gives three sibling
  /// folders and not `ToolBox 1.5.0 1.6.0 1.7.0`.
  static String _versionedLeaf(String leaf, AppVersion version) {
    final base = leaf.replaceFirst(RegExp(r'[ _-]v?\d+\.\d+\.\d+$'), '');
    return '${base.isEmpty ? leaf : base} $version';
  }
}
