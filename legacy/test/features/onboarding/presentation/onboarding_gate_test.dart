import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/time/device_time_zone.dart';
import 'package:gratovo_toolbox/features/onboarding/application/onboarding_preferences.dart';
import 'package:gratovo_toolbox/features/onboarding/presentation/onboarding_gate.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;

/// Only `status()` is exercised through `OnboardingGate` — see the sibling
/// fake in onboarding_wizard_screen_test.dart for why the rest are stubs.
class _UnconfiguredGmailGateway implements GmailGateway {
  @override
  Future<GmailOutcome<GmailStatus>> status() async =>
      const GmailOutcome.success(GmailStatus.unconfigured);

  @override
  Future<GmailOutcome<String>> connect() async =>
      const GmailOutcome.success('');

  @override
  Future<GmailOutcome<bool>> disconnect({String? account}) async =>
      const GmailOutcome.success(true);

  @override
  Future<GmailOutcome<GmailSendReceipt>> send(GmailSendRequest request) {
    throw UnimplementedError();
  }

  @override
  Future<GmailOutcome<GmailSweep>> runDue({
    bool checkOnly = false,
    String? conversationKey,
    int? limit,
    String? account,
  }) async =>
      const GmailOutcome.success(GmailSweep.empty);

  @override
  Future<GmailOutcome<int>> acknowledge(List<String> messageIds) async =>
      const GmailOutcome.success(0);

  @override
  Future<GmailOutcome<int>> cancelFollowUps(String conversationKey) async =>
      const GmailOutcome.success(0);

  @override
  Future<GmailOutcome<String>> sendTest({String? to, String? account}) async =>
      const GmailOutcome.success('');
}

const _mobileCapabilities = AppCapabilities(
  isDesktopDevice: false,
  isNative: true,
  canRunSearch: false,
  canEditSearchInputs: false,
  canTuneScrapingSettings: false,
);

/// A fixed stand-in for [OnboardingCompletionNotifier] that skips the
/// `shared_preferences` load and starts already marked complete — for the
/// "the wizard already ran" scenario below.
class _AlreadyCompleted extends OnboardingCompletionNotifier {
  @override
  bool build() => true;
}

Widget _harness(Widget child, {bool alreadyCompleted = false}) {
  return ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      gmailGatewayProvider.overrideWithValue(_UnconfiguredGmailGateway()),
      deviceTimeZoneProvider.overrideWith((ref) async => 'UTC'),
      capabilitiesProvider.overrideWithValue(_mobileCapabilities),
      if (alreadyCompleted)
        onboardingCompletedProvider.overrideWith(_AlreadyCompleted.new),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: child,
    ),
  );
}

/// Tall enough that the wizard's "Continue to the app" button is on-screen
/// without scrolling — see the sibling helper in
/// onboarding_wizard_screen_test.dart.
void _sizeTo(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

void main() {
  setUpAll(tzdata.initializeTimeZones);
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('shows the wizard, not the child, the first time it runs',
      (tester) async {
    await tester.pumpWidget(
      _harness(const OnboardingGate(child: Text('the app shell'))),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text("Let's get this machine set up"), findsOneWidget);
    expect(find.text('the app shell'), findsNothing);
  });

  testWidgets('shows the child instead once onboarding is already complete',
      (tester) async {
    await tester.pumpWidget(
      _harness(
        const OnboardingGate(child: Text('the app shell')),
        alreadyCompleted: true,
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('the app shell'), findsOneWidget);
    expect(find.text("Let's get this machine set up"), findsNothing);
  });

  testWidgets('finishing the wizard swaps straight to the child',
      (tester) async {
    _sizeTo(tester, const Size(1000, 2600));
    await tester.pumpWidget(
      _harness(const OnboardingGate(child: Text('the app shell'))),
    );
    await tester.pumpAndSettle();
    expect(find.text('the app shell'), findsNothing);

    await tester.tap(find.text('Continue to the app'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('the app shell'), findsOneWidget);
    expect(find.text("Let's get this machine set up"), findsNothing);
  });
}
