import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/github/github_token_provider.dart';
import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/update/app_version.dart';
import 'package:gratovo_toolbox/core/update/github_release_source.dart';
import 'package:gratovo_toolbox/core/update/update_controller.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/settings/application/github_account_controller.dart';
import 'package:gratovo_toolbox/features/settings/application/settings_attention_controller.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show Session, User;

UpdateState _updateReady() => const UpdateState(
      phase: UpdatePhase.readyToInstall,
      release: UpdateRelease(
        version: AppVersion(1, 6, 2),
        tag: 'v1.6.2',
        archive: ReleaseAsset(
          name: 'a.zip',
          url: 'https://example.invalid/a.zip',
        ),
        releasePageUrl: 'https://example.invalid',
      ),
      kind: UpdateKind.minor,
      stagedArchivePath: r'C:\temp\a.zip',
    );

/// A healthy GitHub setup: the shared built-in token, and it works. The
/// default because it is what a correctly built app looks like — the tests
/// that care about GitHub say so explicitly.
const _healthyGithub = GithubAccount(
  source: GithubTokenSource.shared,
  access: GithubReleaseAccess.granted,
);

class _StubGithubController extends GithubAccountController {
  _StubGithubController(this._state);

  final GithubAccount _state;

  @override
  GithubAccount build() => _state;
}

ProviderContainer _container({
  UpdateState update = const UpdateState(phase: UpdatePhase.upToDate),
  GmailStatus gmail = GmailStatus.unconfigured,
  Session? session,
  GithubAccount github = _healthyGithub,
}) {
  final container = ProviderContainer(
    overrides: [
      updateProvider.overrideWith(() => _StubUpdateController(update)),
      gmailStatusProvider.overrideWith((ref) async => gmail),
      githubAccountProvider.overrideWith(() => _StubGithubController(github)),
      // Reaching the real one would boot Supabase; the session is only read
      // here for its expiry.
      currentSessionProvider.overrideWithValue(session),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

class _StubUpdateController extends UpdateController {
  _StubUpdateController(this._state);

  final UpdateState _state;

  @override
  UpdateState build() => _state;
}

void main() {
  test('nothing wrong means no badge', () async {
    final container = _container();
    await container.read(gmailStatusProvider.future);

    expect(container.read(settingsAttentionProvider).isEmpty, isTrue);
  });

  test('an update waiting lights the badge, but not as an error', () async {
    final container = _container(update: _updateReady());
    await container.read(gmailStatusProvider.future);

    final attention = container.read(settingsAttentionProvider);
    expect(attention.has(SettingsAttentionReason.updateAvailable), isTrue);
    expect(attention.isUrgent, isFalse);
    expect(attention.level, AttentionLevel.info);
    // The update belongs to the General card, where the version is.
    expect(
      attention.levelFor(SettingsAttentionTarget.general),
      AttentionLevel.info,
    );
    expect(attention.levelFor(SettingsAttentionTarget.mailbox), isNull);
  });

  test('a mailbox Google is refusing is an urgent badge', () async {
    final container = _container(
      gmail: const GmailStatus(
        configured: true,
        accounts: [
          GmailAccountStatus(account: 'a@example.com', connected: true),
          GmailAccountStatus(account: 'b@example.com', connected: false),
        ],
      ),
    );
    await container.read(gmailStatusProvider.future);

    final attention = container.read(settingsAttentionProvider);
    expect(attention.has(SettingsAttentionReason.credentialRejected), isTrue);
    expect(attention.isUrgent, isTrue);
    // Outlined on the mailbox card specifically, not on the page at large.
    expect(
      attention.levelFor(SettingsAttentionTarget.mailbox),
      AttentionLevel.urgent,
    );
    expect(attention.levelFor(SettingsAttentionTarget.aiProviders), isNull);
    expect(attention.levelFor(SettingsAttentionTarget.general), isNull);
  });

  test('a machine with no mailbox set up is not needing attention', () async {
    final container = _container(gmail: GmailStatus.unconfigured);
    await container.read(gmailStatusProvider.future);

    expect(container.read(settingsAttentionProvider).isEmpty, isTrue);
  });

  test('every mailbox connected is not a badge', () async {
    final container = _container(
      gmail: const GmailStatus(
        configured: true,
        accounts: [
          GmailAccountStatus(account: 'a@example.com', connected: true)
        ],
      ),
    );
    await container.read(gmailStatusProvider.future);

    expect(container.read(settingsAttentionProvider).isEmpty, isTrue);
  });

  test('reasons accumulate across sources', () async {
    final container = _container(
      update: _updateReady(),
      gmail: const GmailStatus(
        configured: true,
        accounts: [
          GmailAccountStatus(account: 'b@example.com', connected: false)
        ],
      ),
    );
    await container.read(gmailStatusProvider.future);

    final attention = container.read(settingsAttentionProvider);
    expect(attention.reasons, {
      SettingsAttentionReason.updateAvailable,
      SettingsAttentionReason.credentialRejected,
    });
    // A real fault outranks news when the two coincide — but each card still
    // carries only its own reason, so two cards light up differently.
    expect(attention.isUrgent, isTrue);
    expect(attention.level, AttentionLevel.urgent);
    expect(
      attention.levelFor(SettingsAttentionTarget.general),
      AttentionLevel.info,
    );
    expect(
      attention.levelFor(SettingsAttentionTarget.mailbox),
      AttentionLevel.urgent,
    );
  });

  group('the Supabase session', () {
    /// A session with [secondsFromNow] left on its access token. Supabase mints
    /// these with roughly an hour to live.
    Session sessionExpiring(int secondsFromNow) {
      // `expiresAt` is normally decoded from the access token's `exp` claim;
      // it is a plain late field, so a test can set it directly rather than
      // minting a real signed JWT to say one number.
      return Session(
        accessToken: 'not-a-real-jwt',
        tokenType: 'bearer',
        user: User(
          id: 'u',
          appMetadata: const {},
          userMetadata: const {},
          aud: 'authenticated',
          createdAt: DateTime.now().toIso8601String(),
        ),
      )..expiresAt = DateTime.now()
              .add(Duration(seconds: secondsFromNow))
              .millisecondsSinceEpoch ~/
          1000;
    }

    test('a normal one-hour session is not a warning', () async {
      // The regression this exists for: an earlier threshold of three days
      // meant every healthy session — they all live about an hour — lit the
      // Account card permanently with "Expiring soon".
      final container = _container(session: sessionExpiring(3600));
      await container.read(gmailStatusProvider.future);

      expect(container.read(settingsAttentionProvider).isEmpty, isTrue);
    });

    test('a session minutes from expiry is still not a warning', () async {
      // Mid-refresh is the ordinary state, not a problem.
      final container = _container(session: sessionExpiring(60));
      await container.read(gmailStatusProvider.future);

      expect(container.read(settingsAttentionProvider).isEmpty, isTrue);
    });

    test('a session just past expiry is given room to refresh', () async {
      final container = _container(session: sessionExpiring(-60));
      await container.read(gmailStatusProvider.future);

      expect(container.read(settingsAttentionProvider).isEmpty, isTrue);
    });

    test('a session that stayed expired is a real fault', () async {
      // Past the grace period the refresh has genuinely stopped, and the next
      // sync will fail.
      final container = _container(session: sessionExpiring(-3600));
      await container.read(gmailStatusProvider.future);

      final attention = container.read(settingsAttentionProvider);
      expect(
        attention.levelFor(SettingsAttentionTarget.account),
        AttentionLevel.urgent,
      );
    });
  });

  group('GitHub, which is how updates arrive at all', () {
    test('a build with no token at all is a fault worth saying', () async {
      // It can never find an update. Silent by nature — a private repo 404s
      // rather than complaining — so the badge is the only thing that says it.
      final container = _container(
        github: const GithubAccount(source: GithubTokenSource.none),
      );
      await container.read(gmailStatusProvider.future);

      expect(
        container
            .read(settingsAttentionProvider)
            .levelFor(SettingsAttentionTarget.github),
        AttentionLevel.urgent,
      );
    });

    test('an expired shared token badges even though nobody signed in',
        () async {
      final container = _container(
        github: const GithubAccount(
          source: GithubTokenSource.shared,
          access: GithubReleaseAccess.tokenRejected,
        ),
      );
      await container.read(gmailStatusProvider.future);

      expect(
        container
            .read(settingsAttentionProvider)
            .levelFor(SettingsAttentionTarget.github),
        AttentionLevel.urgent,
      );
    });

    test('a working shared token is quiet', () async {
      final container = _container();
      await container.read(gmailStatusProvider.future);

      expect(
        container
            .read(settingsAttentionProvider)
            .levelFor(SettingsAttentionTarget.github),
        isNull,
      );
    });
  });
}
