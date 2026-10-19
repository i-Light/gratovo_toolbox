import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// The version this binary was actually compiled with, straight out of
/// `pubspec.yaml`'s `version:` line -- not a hand-maintained copy of it, so
/// this can never drift from what somebody is really running.
///
/// Lives in core/ rather than beside the About row that first displayed it:
/// `UpdateController` needs the running version to compare against the
/// latest release, and a core service reaching into a settings widget file
/// for a provider is the wrong direction.
final packageInfoProvider = FutureProvider<PackageInfo>((ref) {
  return PackageInfo.fromPlatform();
});
