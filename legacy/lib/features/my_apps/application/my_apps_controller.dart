import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/my_apps/my_app_entry.dart';
import 'package:gratovo_toolbox/core/my_apps/my_app_releases.dart';
import 'package:gratovo_toolbox/core/my_apps/my_apps_host.dart';

/// The bundled list. An asset rather than a file on disk: it reaches every
/// teammate with the normal update and works offline. See docs/MY_APPS.md.
const myAppsAssetPath = 'assets/my_apps.json';

final myAppsRegistryProvider = FutureProvider<MyAppsRegistry>((ref) async {
  final source = await rootBundle.loadString(myAppsAssetPath);
  return MyAppsRegistry.parse(source);
});

/// Seams for widget tests: the disk/process side and the GitHub side.
final myAppsHostProvider = Provider<MyAppsHost>((ref) => const MyAppsHost());

final myAppReleasesProvider =
    Provider<MyAppReleases>((ref) => const MyAppReleases());

/// Where this app is installed on this computer, or null. Invalidated by the
/// card's refresh button and after an installer has been started.
/// The installed program's own icon, or null (not installed, unreadable) —
/// the card then keeps the icon named in the registry.
final myAppIconProvider =
    FutureProvider.family<Uint8List?, String>((ref, id) async {
  final path = await ref.watch(myAppInstalledPathProvider(id).future);
  if (path == null) return null;
  return ref.read(myAppsHostProvider).iconPng(path);
});

final myAppInstalledPathProvider =
    FutureProvider.family<String?, String>((ref, id) async {
  final registry = await ref.watch(myAppsRegistryProvider.future);
  final windows = registry.apps.where((a) => a.id == id).firstOrNull?.windows;
  if (windows == null) return null;
  return ref.read(myAppsHostProvider).installedPath(windows);
});
