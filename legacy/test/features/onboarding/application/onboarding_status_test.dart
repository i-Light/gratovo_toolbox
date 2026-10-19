import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/time/device_time_zone.dart';
import 'package:gratovo_toolbox/features/onboarding/application/onboarding_status.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;

class _StubGmailGateway implements GmailGateway {
  _StubGmailGateway(this.result);

  final GmailStatus result;

  @override
  Future<GmailOutcome<GmailStatus>> status() async =>
      GmailOutcome.success(result);

  @override
  Future<GmailOutcome<String>> connect() async =>
      const GmailOutcome.success('');
  @override
  Future<GmailOutcome<bool>> disconnect({String? account}) async =>
      const GmailOutcome.success(true);
  @override
  Future<GmailOutcome<GmailSendReceipt>> send(GmailSendRequest request) =>
      throw UnimplementedError();
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

ProviderContainer _container({
  GmailStatus mailbox = GmailStatus.unconfigured,
  String deviceZone = 'UTC',
  AppCapabilities capabilities = _mobileCapabilities,
}) {
  final container = ProviderContainer(overrides: [
    supabaseBootProvider.overrideWithValue(
      const SupabaseBoot(
        config: SupabaseConfig(url: '', anonKey: ''),
        error: 'no server configured in this test',
      ),
    ),
    gmailGatewayProvider.overrideWithValue(_StubGmailGateway(mailbox)),
    deviceTimeZoneProvider.overrideWith((ref) async => deviceZone),
    capabilitiesProvider.overrideWithValue(capabilities),
  ]);
  addTearDown(container.dispose);
  return container;
}

void main() {
  setUpAll(tzdata.initializeTimeZones);
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('sign-in step follows isSignedInProvider', () async {
    final container = _container();
    // No Supabase client configured -> nobody can be signed in.
    expect(
      container.read(onboardingStepDoneProvider(OnboardingStepId.signIn)),
      isFalse,
    );
  });

  test(
      'the pipeline step reads done off this platform, with no pipeline '
      'or interpreter needed to answer', () async {
    final container = _container(capabilities: _mobileCapabilities);
    expect(
      container.read(
        onboardingStepDoneProvider(OnboardingStepId.pythonEnvironment),
      ),
      isTrue,
    );
  });

  test('mailbox step follows gmailStatusProvider.canSend', () async {
    final notConnected = _container(mailbox: GmailStatus.unconfigured);
    await notConnected.read(gmailStatusProvider.future);
    expect(
      notConnected.read(onboardingStepDoneProvider(OnboardingStepId.mailbox)),
      isFalse,
    );

    final connected = _container(
      mailbox: const GmailStatus(
        configured: true,
        accounts: [
          GmailAccountStatus(account: 'a@b.com', connected: true),
        ],
      ),
    );
    await connected.read(gmailStatusProvider.future);
    expect(
      connected.read(onboardingStepDoneProvider(OnboardingStepId.mailbox)),
      isTrue,
    );
  });

  test(
      'time zone step is done only once the display zone matches the '
      'device zone', () async {
    SharedPreferences.setMockInitialValues({});
    final matching = _container(deviceZone: 'Africa/Cairo');
    matching.read(
      onboardingStepDoneProvider(OnboardingStepId.timeZone),
    );
    await matching.read(deviceTimeZoneProvider.future);
    await pumpEventQueue();
    expect(
      matching.read(onboardingStepDoneProvider(OnboardingStepId.timeZone)),
      isTrue,
    );

    SharedPreferences.setMockInitialValues(
      {'gratovo.display.timezone': 'UTC'},
    );
    final mismatched = _container(deviceZone: 'Asia/Tokyo');
    mismatched.read(onboardingStepDoneProvider(OnboardingStepId.timeZone));
    await mismatched.read(deviceTimeZoneProvider.future);
    await pumpEventQueue();
    expect(
      mismatched.read(onboardingStepDoneProvider(OnboardingStepId.timeZone)),
      isFalse,
    );
  });
}
