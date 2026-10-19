import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/aws/aws_identity_check.dart';
import 'package:gratovo_toolbox/features/settings/application/credential_health_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

ProviderContainer _container() {
  final container = ProviderContainer();
  addTearDown(container.dispose);
  return container;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('CredentialHealthNotifier', () {
    test('records a rejection and persists it', () async {
      final container = _container();
      container.read(credentialHealthProvider);
      await pumpEventQueue();

      await container
          .read(credentialHealthProvider.notifier)
          .report(CredentialArea.aiProvider, CredentialOutcome.rejected);

      expect(
        container
            .read(credentialHealthProvider)[CredentialArea.aiProvider]!
            .isRejected,
        isTrue,
      );
      final prefs = await SharedPreferences.getInstance();
      expect(
          prefs.getString('gratovo.credentials.health'), contains('rejected'));
    });

    test('a rejection survives a restart', () async {
      final first = _container();
      first.read(credentialHealthProvider);
      await pumpEventQueue();
      await first
          .read(credentialHealthProvider.notifier)
          .report(CredentialArea.awsGateway, CredentialOutcome.rejected);

      // A second container reads the same mock prefs — the restart.
      final second = _container();
      second.read(credentialHealthProvider);
      await pumpEventQueue();

      expect(
        second
            .read(credentialHealthProvider)[CredentialArea.awsGateway]!
            .isRejected,
        isTrue,
      );
    });

    test('a later success clears the rejection', () async {
      final container = _container();
      container.read(credentialHealthProvider);
      await pumpEventQueue();
      final notifier = container.read(credentialHealthProvider.notifier);

      await notifier.report(
          CredentialArea.aiProvider, CredentialOutcome.rejected);
      await notifier.report(CredentialArea.aiProvider, CredentialOutcome.ok);

      expect(
        container
            .read(credentialHealthProvider)[CredentialArea.aiProvider]!
            .isRejected,
        isFalse,
      );
    });

    test('replacing a credential forgets the old verdict', () async {
      final container = _container();
      container.read(credentialHealthProvider);
      await pumpEventQueue();
      final notifier = container.read(credentialHealthProvider.notifier);

      await notifier.report(
          CredentialArea.awsGateway, CredentialOutcome.rejected);
      await notifier.clear(CredentialArea.awsGateway);

      expect(
        container.read(credentialHealthProvider)[CredentialArea.awsGateway],
        isNull,
      );
    });

    test('a verdict reported before the load lands is not overwritten by it',
        () async {
      SharedPreferences.setMockInitialValues({
        'gratovo.credentials.health':
            '{"aiProvider":{"outcome":"rejected","at":"2020-01-01T00:00:00.000"}}',
      });
      final container = _container();
      // Reported in the same turn the notifier is built, before _loadPersisted
      // completes — the fresh answer has to win over the stored one.
      container.read(credentialHealthProvider);
      await container
          .read(credentialHealthProvider.notifier)
          .report(CredentialArea.aiProvider, CredentialOutcome.ok);
      await pumpEventQueue();

      expect(
        container
            .read(credentialHealthProvider)[CredentialArea.aiProvider]!
            .isRejected,
        isFalse,
      );
    });
  });

  group('AwsIdentityCheck.classify', () {
    test('200 is a good credential', () {
      expect(
        AwsIdentityCheck.classify(200, '<GetCallerIdentityResponse/>'),
        AwsIdentityResult.valid,
      );
    });

    test('403 is a refused credential', () {
      expect(
        AwsIdentityCheck.classify(403, 'SignatureDoesNotMatch'),
        AwsIdentityResult.rejected,
      );
    });

    test('400 with a credential error code is a refused credential', () {
      expect(
        AwsIdentityCheck.classify(400, '<Code>InvalidClientTokenId</Code>'),
        AwsIdentityResult.rejected,
      );
    });

    test('throttling and 5xx say nothing about the credential', () {
      // The important half: these must not be recorded as rejections, or the
      // badge lights up over AWS having a bad minute.
      expect(
        AwsIdentityCheck.classify(503, 'ServiceUnavailable'),
        AwsIdentityResult.unknown,
      );
      expect(
        AwsIdentityCheck.classify(400, '<Code>Throttling</Code>'),
        AwsIdentityResult.unknown,
      );
    });

    test('an empty key pair is inconclusive, not a rejection', () async {
      expect(
        await const AwsIdentityCheck()
            .check(accessKeyId: '', secretAccessKey: ''),
        AwsIdentityResult.unknown,
      );
    });
  });
}
