import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/aws/aws_identity_check.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/aws_gateway_credentials.dart';
import 'package:gratovo_toolbox/data/repositories/aws_gateway_credentials_repository.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_aws_gateway_credentials_repository.dart';
import 'package:gratovo_toolbox/features/settings/application/credential_health_controller.dart';

/// Null when signed out or the backend is unreachable -- there is nothing
/// mock-backed to fall back to here (unlike `repository_providers.dart`'s
/// repositories) because there is nothing to show without a real account:
/// "my AWS credentials" has no meaning for nobody in particular.
final awsGatewayCredentialsRepositoryProvider =
    Provider<AwsGatewayCredentialsRepository?>((ref) {
  final client = ref.watch(supabaseClientProvider);
  final userId = ref.watch(currentSessionProvider)?.user.id;
  if (client == null || userId == null) return null;
  return SupabaseAwsGatewayCredentialsRepository(client, userId);
});

/// The signed-in person's own AWS credentials row plus its save history.
class AwsGatewayCredentialsState {
  const AwsGatewayCredentialsState({
    required this.current,
    required this.history,
  });

  final AwsGatewayCredentials current;
  final List<AwsGatewayCredentialVersion> history;
}

/// Loads the signed-in person's own row and history, and saves edits to it.
///
/// There is deliberately no "edit someone else's" method -- see
/// [AwsGatewayCredentialsRepository]'s doc comment.
class AwsGatewayCredentialsController
    extends AsyncNotifier<AwsGatewayCredentialsState> {
  @override
  Future<AwsGatewayCredentialsState> build() async {
    final repo = ref.watch(awsGatewayCredentialsRepositoryProvider);
    if (repo == null) {
      return AwsGatewayCredentialsState(
        current: AwsGatewayCredentials.blank(''),
        history: const [],
      );
    }
    final current = await repo.getMine();
    final history = await repo.getMyHistory();
    return AwsGatewayCredentialsState(current: current, history: history);
  }

  Future<void> save({
    required String accessKeyId,
    required String secretAccessKey,
    required String defaultRegions,
  }) async {
    final repo = ref.read(awsGatewayCredentialsRepositoryProvider);
    if (repo == null) return;
    await repo.saveMine(
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
      defaultRegions: defaultRegions,
    );
    // A freshly saved pair has no history worth keeping — whatever the old one
    // did says nothing about this one — so the recorded verdict is dropped
    // before the new pair is checked.
    await ref
        .read(credentialHealthProvider.notifier)
        .clear(CredentialArea.awsGateway);
    ref.invalidateSelf();
    await future;
    await verify();
  }

  /// Asks AWS whether the stored key pair is currently good, and records the
  /// answer for the Settings badge.
  ///
  /// The credentials themselves are only ever used by the pipeline's Python
  /// side, which means nothing in the app would otherwise ever find out they
  /// had stopped working — the first sign would be a scraping run failing for
  /// reasons nobody connects to a key rotated weeks earlier. This is the app
  /// asking directly, so it can say so on the Accounts card instead.
  ///
  /// Returns what AWS said. An inconclusive answer (offline, throttled, 5xx)
  /// leaves the previous verdict alone rather than overwriting it with a
  /// guess.
  Future<AwsIdentityResult> verify() async {
    final credentials = state.value?.current;
    if (credentials == null) return AwsIdentityResult.unknown;

    final result = await const AwsIdentityCheck().check(
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    );
    final health = ref.read(credentialHealthProvider.notifier);
    switch (result) {
      case AwsIdentityResult.valid:
        await health.report(CredentialArea.awsGateway, CredentialOutcome.ok);
      case AwsIdentityResult.rejected:
        await health.report(
            CredentialArea.awsGateway, CredentialOutcome.rejected);
      case AwsIdentityResult.unknown:
        break;
    }
    return result;
  }
}

final awsGatewayCredentialsControllerProvider = AsyncNotifierProvider<
    AwsGatewayCredentialsController, AwsGatewayCredentialsState>(
  AwsGatewayCredentialsController.new,
);
