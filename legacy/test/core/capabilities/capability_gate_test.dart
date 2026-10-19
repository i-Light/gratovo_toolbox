import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/capabilities/capability_gate.dart';

void main() {
  Future<void> pumpGate(
    WidgetTester tester, {
    required AppCapabilities capabilities,
    bool Function(AppCapabilities)? requires,
  }) {
    return tester.pumpWidget(
      ProviderScope(
        overrides: [capabilitiesProvider.overrideWithValue(capabilities)],
        child: MaterialApp(
          home: DesktopOnly(
            requires: requires,
            fallback: const Text('fallback'),
            child: const Text('gated content'),
          ),
        ),
      ),
    );
  }

  testWidgets('shows the child when the capability is allowed', (
    tester,
  ) async {
    await pumpGate(
      tester,
      capabilities: const AppCapabilities(
        isDesktopDevice: true,
        isNative: true,
        canRunSearch: true,
        canEditSearchInputs: true,
        canTuneScrapingSettings: true,
      ),
    );

    expect(find.text('gated content'), findsOneWidget);
    expect(find.text('fallback'), findsNothing);
  });

  testWidgets('shows the fallback when the capability is disallowed', (
    tester,
  ) async {
    await pumpGate(
      tester,
      capabilities: const AppCapabilities(
        isDesktopDevice: false,
        isNative: true,
        canRunSearch: false,
        canEditSearchInputs: false,
        canTuneScrapingSettings: false,
      ),
    );

    expect(find.text('gated content'), findsNothing);
    expect(find.text('fallback'), findsOneWidget);
  });

  testWidgets('honors a custom requires callback over the default', (
    tester,
  ) async {
    // canRunSearch is true but the gate below asks about a different
    // capability — the default (canRunSearch) must not leak through.
    await pumpGate(
      tester,
      capabilities: const AppCapabilities(
        isDesktopDevice: true,
        isNative: true,
        canRunSearch: true,
        canEditSearchInputs: true,
        canTuneScrapingSettings: false,
      ),
      requires: (caps) => caps.canTuneScrapingSettings,
    );

    expect(find.text('fallback'), findsOneWidget);
  });
}
