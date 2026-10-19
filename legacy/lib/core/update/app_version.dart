import 'package:flutter/foundation.dart';

/// How big a jump sits between the running build and an available release.
/// The whole point of the distinction is consent: a patch is a fix to the
/// version already approved and running, so it installs itself; anything
/// that moves the minor or major is a different piece of software and waits
/// for a deliberate press of Update in Settings.
enum UpdateKind {
  /// Same `major.minor`, higher patch — 1.4.2 -> 1.4.8. Installs unattended.
  patch,

  /// Same major, higher minor — 1.5.5 -> 1.6.2. Downloads, then waits.
  minor,

  /// Higher major — 1.9.0 -> 2.0.0. Treated exactly like [minor]: staged,
  /// never installed without a press. A major bump is if anything the last
  /// release anyone should get in their sleep.
  major,
}

/// A `major.minor.patch` version, parsed from either a pubspec-style string
/// ("1.2.2+13" — the build number after `+` is ignored, it orders nothing
/// that `patch` doesn't already order) or a release tag ("v1.2.2").
///
/// Deliberately not a full semver implementation: this project's versions are
/// produced by `scripts/bump_version.ps1` and always have exactly the three
/// numeric parts, so pre-release and build-metadata precedence rules would be
/// unreachable code guarding a case that can't arise. Anything that doesn't
/// match that shape parses to null and is treated as "no usable release",
/// which is the safe answer for input arriving over the network.
@immutable
class AppVersion implements Comparable<AppVersion> {
  const AppVersion(this.major, this.minor, this.patch);

  final int major;
  final int minor;
  final int patch;

  static final _pattern = RegExp(r'^v?(\d+)\.(\d+)\.(\d+)');

  /// Returns null rather than throwing: the two callers are a GitHub payload
  /// and `PackageInfo`, and neither one failing should be an exception —
  /// it should be a silent "can't tell, so don't offer an update".
  static AppVersion? tryParse(String? raw) {
    if (raw == null) return null;
    final match = _pattern.firstMatch(raw.trim());
    if (match == null) return null;
    return AppVersion(
      int.parse(match.group(1)!),
      int.parse(match.group(2)!),
      int.parse(match.group(3)!),
    );
  }

  @override
  int compareTo(AppVersion other) {
    if (major != other.major) return major.compareTo(other.major);
    if (minor != other.minor) return minor.compareTo(other.minor);
    return patch.compareTo(other.patch);
  }

  bool operator >(AppVersion other) => compareTo(other) > 0;
  bool operator <(AppVersion other) => compareTo(other) < 0;

  /// What kind of jump it is from [this] to [candidate], or null when
  /// [candidate] isn't actually newer. Downgrades return null too: a release
  /// older than what's running is not an update, and re-installing it
  /// backwards on a timer would be a very bad surprise.
  UpdateKind? kindOfUpgradeTo(AppVersion candidate) {
    if (candidate <= this) return null;
    if (candidate.major != major) return UpdateKind.major;
    if (candidate.minor != minor) return UpdateKind.minor;
    return UpdateKind.patch;
  }

  bool operator >=(AppVersion other) => compareTo(other) >= 0;
  bool operator <=(AppVersion other) => compareTo(other) <= 0;

  @override
  bool operator ==(Object other) =>
      other is AppVersion &&
      other.major == major &&
      other.minor == minor &&
      other.patch == patch;

  @override
  int get hashCode => Object.hash(major, minor, patch);

  @override
  String toString() => '$major.$minor.$patch';
}
