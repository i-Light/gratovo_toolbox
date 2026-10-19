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
import 'package:gratovo_toolbox/features/onboarding/presentation/onboarding_wizard_screen.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/outreach_mailbox_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/python_environment_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/time_zone_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;

/// A [GmailGateway] fixed to whatever `--status` should answer, so mailbox
/// step tests never touch a real Python interpreter — see
/// `_FakeGmailGateway` in outreach_compose_gmail_test.dart for the sibling
/// pattern; this one only needs `status()` to vary between tests.
class _FixedGmailGateway implements GmailGateway {
  _FixedGmailGateway(this.status_);

  final GmailStatus status_;

  @override
  Future<GmailOutcome<GmailStatus>> status() async =>
      GmailOutcome.success(status_);

  @override
  Future<GmailOutcome<String>> connect() async =>
      const GmailOutcome.success('mailbox@gratovo.test');

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

const _unconfiguredMailbox = GmailStatus.unconfigured;
const _connectedMailbox = GmailStatus(
  configured: true,
  accounts: [
    GmailAccountStatus(account: 'mailbox@gratovo.test', connected: true)
  ],
);

Widget _harness(
  Widget child, {
  GmailStatus mailbox = _unconfiguredMailbox,
  AppCapabilities? capabilities,
  String deviceZone = 'Asia/Tokyo',
}) {
  return ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      gmailGatewayProvider.overrideWithValue(_FixedGmailGateway(mailbox)),
      deviceTimeZoneProvider.overrideWith((ref) async => deviceZone),
      if (capabilities != null)
        capabilitiesProvider.overrideWithValue(capabilities),
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

const _mobileCapabilities = AppCapabilities(
  isDesktopDevice: false,
  isNative: true,
  canRunSearch: false,
  canEditSearchInputs: false,
  canTuneScrapingSettings: false,
);

const _desktopCapabilities = AppCapabilities(
  isDesktopDevice: true,
  isNative: true,
  canRunSearch: true,
  canEditSearchInputs: true,
  canTuneScrapingSettings: true,
);

/// Tall enough that every step card — including the ones whose embedded
/// Settings widget is expanded — fits without scrolling, so `tester.tap`
/// hits an on-screen target instead of a point past the render tree's edge.
void _sizeTo(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

void main() {
  setUpAll(tzdata.initializeTimeZones);
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
      'shows all four steps and the not-signed-in / not-connected '
      'defaults, with no real pipeline, mailbox or network present',
      (tester) async {
    _sizeTo(tester, const Size(1000, 2600));
    await tester.pumpWidget(_harness(
      const OnboardingWizardScreen(),
      capabilities: _mobileCapabilities,
    ));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text("Let's get this machine set up"), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Python & pipeline'), findsOneWidget);
    // Two: the step's own title and the embedded OutreachMailboxCard's own
    // header, which share the same name deliberately (see its doc comment).
    expect(find.text('Outreach mailbox'), findsNWidgets(2));
    expect(find.text('Time zone'), findsOneWidget);

    // Nobody is signed in (the boot override leaves the client null) and the
    // fixture mailbox is unconfigured, so both read pending.
    expect(find.text('Not signed in on this machine yet.'), findsOneWidget);
    expect(find.text('No mailbox connected yet.'), findsOneWidget);
    expect(find.byType(OutreachMailboxCard), findsOneWidget);

    // Not applicable off desktop — reads done from the very first frame
    // (nothing async has to resolve first, unlike sign-in or the mailbox), so
    // its card starts folded like any other done step. Nothing to edit
    // inline, so it stays folded until someone opens it on purpose.
    expect(find.byType(PythonEnvironmentCard), findsNothing);
    await tester.tap(find.text('Python & pipeline'));
    await tester.pumpAndSettle();
    expect(
      find.text("Searching isn't run from this build, so there's nothing to "
          'check here.'),
      findsOneWidget,
    );
    expect(find.byType(PythonEnvironmentCard), findsNothing);
  });

  testWidgets('a connected mailbox reads done and folds its card away',
      (tester) async {
    _sizeTo(tester, const Size(1000, 2600));
    await tester.pumpWidget(_harness(
      const OnboardingWizardScreen(),
      capabilities: _mobileCapabilities,
      mailbox: _connectedMailbox,
    ));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(
      find.text('A mailbox is connected and ready to send.'),
      findsOneWidget,
    );
    expect(find.text('No mailbox connected yet.'), findsNothing);
  });

  testWidgets('a time zone matching this device reads done', (tester) async {
    _sizeTo(tester, const Size(1000, 2600));
    await tester.pumpWidget(_harness(
      const OnboardingWizardScreen(),
      capabilities: _mobileCapabilities,
      deviceZone: 'Africa/Cairo',
    ));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(
      find.text("Matches this device's own time zone."),
      findsOneWidget,
    );
  });

  testWidgets(
      'a time zone that does not match the device reads pending and '
      'offers the same picker Settings uses', (tester) async {
    _sizeTo(tester, const Size(1000, 2600));
    SharedPreferences.setMockInitialValues(
      {'gratovo.display.timezone': 'UTC'},
    );
    await tester.pumpWidget(_harness(
      const OnboardingWizardScreen(),
      capabilities: _mobileCapabilities,
      deviceZone: 'Asia/Tokyo',
    ));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(
      find.text("Doesn't match this device's time zone."),
      findsOneWidget,
    );
    expect(find.byType(TimeZoneSection), findsOneWidget);
  });

  testWidgets(
      'on a desktop build, the pipeline step offers the same fields '
      'Settings does', (tester) async {
    _sizeTo(tester, const Size(1000, 2600));
    await tester.pumpWidget(_harness(
      const OnboardingWizardScreen(),
      capabilities: _desktopCapabilities,
    ));
    await tester.pumpAndSettle();

    // This step reads done even on desktop (a pipeline location is always
    // found — see onboarding_status.dart), so its card starts folded like
    // any other done step. Tapping the header opens it back up, the same way
    // opening a folded, otherwise-fine card in Settings does — the fields are
    // still there to override a wrong guess.
    await tester.tap(find.text('Python & pipeline'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byType(PythonEnvironmentCard), findsOneWidget);
  });

  testWidgets('"Continue to the app" marks onboarding complete', (
    tester,
  ) async {
    _sizeTo(tester, const Size(1000, 2600));
    late WidgetRef capturedRef;
    await tester.pumpWidget(_harness(
      Consumer(
        builder: (context, ref, _) {
          capturedRef = ref;
          return const OnboardingWizardScreen();
        },
      ),
      capabilities: _mobileCapabilities,
    ));
    await tester.pumpAndSettle();

    expect(capturedRef.read(onboardingCompletedProvider), isFalse);

    await tester.tap(find.text('Continue to the app'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(capturedRef.read(onboardingCompletedProvider), isTrue);
  });
}
