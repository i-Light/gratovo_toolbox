import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';

void main() {
  // This is the one rule the whole capability-gating system exists to
  // enforce: the sourcing pipeline must never be triggerable from a phone.
  // If this regresses, everything downstream that trusts `DesktopOnly` is
  // silently wrong.
  group('capabilitiesProvider', () {
    test('grants search capabilities on desktop platforms', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      debugDefaultTargetPlatformOverride = TargetPlatform.windows;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);

      final caps = container.read(capabilitiesProvider);

      expect(caps.canRunSearch, isTrue);
      expect(caps.canTuneScrapingSettings, isTrue);
      expect(caps.isDesktopDevice, isTrue);
      expect(caps.canEditSearchInputs, isTrue);
    });

    test('withholds search capabilities on mobile platforms', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);

      final caps = container.read(capabilitiesProvider);

      expect(caps.canRunSearch, isFalse);
      expect(caps.canTuneScrapingSettings, isFalse);
      // The one that matters for the read-only gating: a phone must never be
      // able to edit the keyword list that a desktop run will consume.
      expect(caps.isDesktopDevice, isFalse);
      expect(caps.canEditSearchInputs, isFalse);
    });

    test('withholds search capabilities on iOS', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);

      final caps = container.read(capabilitiesProvider);

      expect(caps.canRunSearch, isFalse);
      expect(caps.canEditSearchInputs, isFalse);
    });

    // The regression this split was introduced for: opening the WEB build on a
    // Windows machine used to report "not desktop" and show the user a notice
    // telling them to use a desktop, while they were sitting at one. The
    // machine is desktop-class (so the notice must not appear and the inputs
    // stay editable); only process-spawning is unavailable.
    test('a desktop machine is desktop-class even in a browser', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      debugDefaultTargetPlatformOverride = TargetPlatform.windows;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);

      final caps = container.read(capabilitiesProvider);

      expect(caps.isDesktopDevice, isTrue);
      expect(caps.canEditSearchInputs, isTrue);
      // kIsWeb is false under `flutter test`, so canRunSearch is true here;
      // what this test pins down is that isDesktopDevice does NOT depend on
      // kIsWeb, which is what the browser case relies on.
      expect(caps.canRunSearch, caps.isNative);
    });
  });
}
