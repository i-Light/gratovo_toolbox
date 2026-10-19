import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What this build/platform is allowed to do.
///
/// There are two genuinely different questions here, and conflating them was
/// the cause of the "this is only available on desktop" notice appearing on
/// actual desktop machines:
///
///   * **Is this a desktop-class device?** — a Windows/macOS/Linux machine,
///     whether the app is running natively or in a browser tab on it. This
///     governs whether the keyword box and search settings are editable, and
///     whether the desktop-only notice makes any sense to show at all.
///
///   * **Can this build launch the Python scraper?** — only a NATIVE desktop
///     build can spawn a process. A browser tab on the very same Windows PC
///     cannot, no matter how capable the machine is.
///
/// The old code only had the second, so opening the web build on a desktop PC
/// told the user "this is only available on desktop" while they were sitting
/// at a desktop. Now the notice is shown only on phones and tablets, and a
/// desktop browser gets an accurate message about needing the installed app.
///
/// Read this via [capabilitiesProvider] and gate UI with `DesktopOnly`
/// (capability_gate.dart) rather than checking platform flags directly in
/// feature code — keeps platform detection in exactly one place.
class AppCapabilities {
  const AppCapabilities({
    required this.isDesktopDevice,
    required this.isNative,
    required this.canRunSearch,
    required this.canEditSearchInputs,
    required this.canTuneScrapingSettings,
  });

  /// Windows / macOS / Linux — including a browser running on one of them.
  /// On Flutter web this is derived from the browser's reported platform, so
  /// Chrome on Windows correctly reports `true`.
  final bool isDesktopDevice;

  /// A native (non-browser) build, which is what process spawning requires.
  final bool isNative;

  /// Can this build actually launch the local Python search process?
  final bool canRunSearch;

  /// Can the user type keywords and change per-run search settings?
  ///
  /// Desktop-class only, but NOT restricted to native: someone on a desktop
  /// browser can legitimately prepare a keyword list and settings for the
  /// machine that will run the search. Phones cannot — the inputs are
  /// read-only there, which is what stops a half-typed keyword list on a
  /// phone from overwriting a real one.
  final bool canEditSearchInputs;

  /// Can this build edit the pacing/proxy/threshold tunables the scraper
  /// reads? Native desktop only — these change how the local process behaves,
  /// so editing them anywhere else is meaningless.
  final bool canTuneScrapingSettings;
}

final capabilitiesProvider = Provider<AppCapabilities>((ref) {
  const desktopPlatforms = {
    TargetPlatform.windows,
    TargetPlatform.macOS,
    TargetPlatform.linux,
  };

  final isDesktopDevice = desktopPlatforms.contains(defaultTargetPlatform);
  const isNative = !kIsWeb;

  return AppCapabilities(
    isDesktopDevice: isDesktopDevice,
    isNative: isNative,
    canRunSearch: isNative && isDesktopDevice,
    canEditSearchInputs: isDesktopDevice,
    canTuneScrapingSettings: isNative && isDesktopDevice,
  );
});
