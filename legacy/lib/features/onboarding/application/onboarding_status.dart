import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/time/device_time_zone.dart';
import 'package:gratovo_toolbox/core/time/display_time_zone_controller.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/settings/application/aws_gateway_credentials_controller.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';

/// The five things the wizard checks on, in the order it shows them.
enum OnboardingStepId { signIn, pythonEnvironment, mailbox, timeZone, aws }

/// Whether one step is already resolved, composed entirely from providers
/// that already exist elsewhere in the app — this file adds no detection of
/// its own, only reads what those already expose. See each provider's own
/// doc comment below for what "done" means for that step and why.
final onboardingStepDoneProvider =
    Provider.family<bool, OnboardingStepId>((ref, id) {
  return switch (id) {
    OnboardingStepId.signIn => ref.watch(_signInDoneProvider),
    OnboardingStepId.pythonEnvironment =>
      ref.watch(_pythonEnvironmentDoneProvider),
    OnboardingStepId.mailbox => ref.watch(_mailboxDoneProvider),
    OnboardingStepId.timeZone => ref.watch(_timeZoneDoneProvider),
    OnboardingStepId.aws => ref.watch(_awsDoneProvider),
  };
});

/// Step 1 — read straight off `isSignedInProvider`
/// (`core/supabase/supabase_client_provider.dart`), the same signal
/// `app_redirect.dart` uses to decide whether anyone but the login screen is
/// reachable at all. In practice this step is only ever seen already done:
/// the wizard is shown from inside the signed-in app shell, so reaching it at
/// all means `app_redirect.dart` already let a signed-in, authorized session
/// through. It stays in the list anyway, both because the brief asks for it
/// and because a session that drops mid-session is exactly the case where
/// seeing "not signed in" here, rather than nothing, is the honest state.
final _signInDoneProvider = Provider<bool>((ref) {
  return ref.watch(isSignedInProvider);
});

/// Step 2 — reuses [ScraperProcess.resolvePaths], the same lookup
/// `PythonEnvironmentCard`'s controller and every pipeline launch already go
/// through; nothing here re-derives where the pipeline or interpreter live.
///
/// `resolvePaths` never returns null on a native desktop build — with
/// nothing configured it still answers with its best guess at the installed
/// layout (see its own doc comment in `scraper_process_io.dart`), which is
/// deliberate: there is no cheap way to know the guess is *right* without
/// actually starting the interpreter, and that is exactly what
/// `pipelineWarmupProvider` already does, expensively, in the background.
/// This step is content to ask the cheap question — "does this platform have
/// a pipeline location at all" — and let the embedded `PythonEnvironmentCard`
/// be where someone corrects a wrong guess. Not applicable off desktop, so it
/// reads done there.
final _pythonEnvironmentDoneProvider = Provider<bool>((ref) {
  final capabilities = ref.watch(capabilitiesProvider);
  if (!capabilities.canRunSearch) return true;
  final env = ref.watch(pythonEnvironmentProvider);
  final override = env.projectRootOverride.trim();
  final paths = ScraperProcess.resolvePaths(
    projectRootOverride: override.isEmpty ? null : override,
  );
  return paths != null;
});

/// Step 3 — reuses `gmailStatusProvider` (`gmail_gateway.dart`), the same
/// status `OutreachMailboxCard` renders from. Loading or failed counts as not
/// done rather than throwing a third state at the step tile.
final _mailboxDoneProvider = Provider<bool>((ref) {
  return ref.watch(gmailStatusProvider).value?.canSend ?? false;
});

/// Step 4 — reuses `displayTimeZoneProvider` and `deviceTimeZoneProvider`
/// (`core/time/`), the same pair `TimeZoneSection` reads to decide whether to
/// offer its "use device zone" button. A zone is technically always *set* —
/// it defaults to the device zone or UTC — so "done" here means the display
/// zone matches the device's own, i.e. nothing here disagrees with reality;
/// a mismatch (someone travelling, or a zone carried over from another
/// machine) is what "pending" flags, with the same fix `TimeZoneSection`
/// already offers.
final _timeZoneDoneProvider = Provider<bool>((ref) {
  final current = ref.watch(displayTimeZoneProvider);
  final device = ref.watch(deviceTimeZoneProvider).value;
  return device != null && device == current;
});

/// Step 5 — reuses `awsGatewayCredentialsControllerProvider`
/// (`aws_gateway_credentials_controller.dart`), the same row `AwsAccountsCard`
/// loads and saves. Loading or an error counts as not done, same as the
/// mailbox step above; `isBlank` is the same check the repository already
/// uses to mean "nothing saved yet".
final _awsDoneProvider = Provider<bool>((ref) {
  final state = ref.watch(awsGatewayCredentialsControllerProvider);
  return state.value?.current.isBlank == false;
});

/// Whether every step already reads done — purely informational (e.g. for a
/// "you're all set" summary); finishing the wizard never requires this.
final onboardingAllStepsDoneProvider = Provider<bool>((ref) {
  return OnboardingStepId.values
      .every((id) => ref.watch(onboardingStepDoneProvider(id)));
});
