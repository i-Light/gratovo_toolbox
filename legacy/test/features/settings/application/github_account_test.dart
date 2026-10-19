import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/github/github_auth.dart';
import 'package:gratovo_toolbox/core/github/github_token_provider.dart';
import 'package:gratovo_toolbox/core/github/shared_release_token.dart';
import 'package:gratovo_toolbox/core/update/github_release_source.dart';
import 'package:gratovo_toolbox/features/settings/application/github_account_controller.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// A stand-in for the keystore. The real one needs a platform channel, and
/// what these tests are about is the decision made from the token, not where
/// it is kept.
class _FakeAuth extends GithubAuth {
  _FakeAuth({
    this.token,
    this.configured = true,
    this.pollOutcome,
    this.pollGate,
  });

  String? token;
  final bool configured;

  /// What [pollForToken] does: null grants `'personal'`, a failure throws it.
  final GithubAuthFailure? pollOutcome;

  /// If set, [pollForToken] waits on this before answering, so a test can
  /// land a refresh in the middle of a sign-in.
  final Completer<void>? pollGate;

  @override
  bool get isConfigured => configured;

  @override
  Future<String?> readToken() async => token;

  @override
  Future<void> writeToken(String value) async => token = value;

  @override
  Future<void> signOut() async => token = null;

  @override
  Future<GithubDeviceCode> requestDeviceCode() async => const GithubDeviceCode(
        deviceCode: 'dev',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        interval: Duration.zero,
        expiresIn: Duration(minutes: 15),
      );

  @override
  Future<String> pollForToken(GithubDeviceCode code) async {
    if (pollGate != null) await pollGate!.future;
    if (pollOutcome != null) throw GithubAuthException(pollOutcome!);
    token = 'personal';
    return 'personal';
  }
}

ProviderContainer _container(
  GithubAuth auth,
  http.Client client, {
  String? shared,
}) {
  final container = ProviderContainer(
    overrides: [
      githubAccountProvider.overrideWith(
        () => GithubAccountController(
          auth: auth,
          client: client,
          sharedToken: () => shared,
        ),
      ),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

/// Answers `/user` and `/repos/.../releases` with the given statuses.
MockClient _api({
  int userStatus = 200,
  int releasesStatus = 200,
  String login = 'someone',
}) =>
    MockClient(
      _apiHandler(
          userStatus: userStatus, releasesStatus: releasesStatus, login: login),
    );

Future<http.Response> Function(http.Request) _apiHandler({
  int userStatus = 200,
  int releasesStatus = 200,
  String login = 'someone',
}) {
  return (request) async {
    if (request.url.path == '/user') {
      return http.Response(
        jsonEncode({'login': login, 'avatar_url': 'https://example.invalid/a'}),
        userStatus,
      );
    }
    if (request.url.path.endsWith('/releases')) {
      return http.Response('[]', releasesStatus);
    }
    return http.Response('{}', 404);
  };
}

void main() {
  test('nobody signed in is not an error', () async {
    final container = _container(_FakeAuth(), _api());
    await container.read(githubAccountProvider.notifier).refresh();

    final account = container.read(githubAccountProvider);
    expect(account.isSignedIn, isFalse);
    expect(account.needsRepoAccess, isFalse);
    expect(account.failure, isNull);
  });

  test('a signed-in account with access reports granted', () async {
    final container = _container(_FakeAuth(token: 'tok'), _api());
    await container.read(githubAccountProvider.notifier).refresh();

    final account = container.read(githubAccountProvider);
    expect(account.login, 'someone');
    expect(account.access, GithubReleaseAccess.granted);
    expect(account.needsRepoAccess, isFalse);
  });

  test('a 404 on releases means this account was never added to the repo',
      () async {
    // The case the whole card exists for: sign-in works perfectly, and the
    // updates silently never arrive.
    final container = _container(
      _FakeAuth(token: 'tok'),
      _api(releasesStatus: 404, login: 'teammate'),
    );
    await container.read(githubAccountProvider.notifier).refresh();

    final account = container.read(githubAccountProvider);
    expect(account.isSignedIn, isTrue);
    expect(account.login, 'teammate');
    expect(account.access, GithubReleaseAccess.denied);
    expect(account.needsRepoAccess, isTrue,
        reason: 'the fix is on GitHub, and the card has to say so');
  });

  test('a revoked token reads as rejected, not as missing access', () async {
    final container = _container(
      _FakeAuth(token: 'stale'),
      _api(userStatus: 401, releasesStatus: 401),
    );
    await container.read(githubAccountProvider.notifier).refresh();

    expect(
      container.read(githubAccountProvider).access,
      GithubReleaseAccess.tokenRejected,
    );
  });

  test('being offline is not a verdict about the account', () async {
    final container = _container(
      _FakeAuth(token: 'tok'),
      MockClient((_) async => http.Response('nope', 503)),
    );
    await container.read(githubAccountProvider.notifier).refresh();

    final account = container.read(githubAccountProvider);
    // Not hearing back is not a revoked token: "sign in again" for a healthy
    // token on a train is the wrong advice. It reads as unreachable, which
    // neither badges nor claims access it cannot verify.
    expect(account.access, GithubReleaseAccess.unreachable);
    expect(account.needsRepoAccess, isFalse);
    expect(account.source, GithubTokenSource.personal);
  });

  test('going offline keeps naming the signed-in person', () async {
    var online = true;
    final api = _apiHandler();
    final container = _container(
      _FakeAuth(token: 'tok'),
      MockClient((request) async {
        if (!online) return http.Response('nope', 503);
        return api(request);
      }),
    );
    final notifier = container.read(githubAccountProvider.notifier);
    await notifier.refresh();
    expect(container.read(githubAccountProvider).login, 'someone');

    online = false;
    await notifier.refresh();

    final account = container.read(githubAccountProvider);
    expect(account.login, 'someone');
    expect(account.isSignedIn, isTrue);
    expect(account.access, GithubReleaseAccess.unreachable);
  });

  test('before the first refresh lands nothing is claimed', () {
    final container = _container(
      _FakeAuth(),
      MockClient((_) async => http.Response('{}', 200)),
    );
    // Read synchronously: refresh() has started but not finished.
    final account = container.read(githubAccountProvider);
    expect(account.resolved, isFalse);
    // The badge rule keys off this; a red dot on every launch until the
    // network answers was the bug.
    expect(account.hasNoToken, isFalse);
    expect(account.busy, isTrue);
  });

  test('signing out forgets the token', () async {
    final auth = _FakeAuth(token: 'tok');
    final container = _container(auth, _api());
    await container.read(githubAccountProvider.notifier).refresh();

    await container.read(githubAccountProvider.notifier).signOut();

    expect(auth.token, isNull);
    expect(container.read(githubAccountProvider).isSignedIn, isFalse);
  });

  test('a build with no client id says so rather than failing obscurely',
      () async {
    final container = _container(_FakeAuth(configured: false), _api());
    await container.read(githubAccountProvider.notifier).signIn();

    expect(
      container.read(githubAccountProvider).failure,
      GithubAuthFailure.notConfigured,
    );
  });

  group('the release check carries the token', () {
    test('an authenticated check reaches a private release', () async {
      String? sentAuth;
      final source = GithubReleaseSource(
        token: 'tok',
        client: MockClient((request) async {
          sentAuth = request.headers['Authorization'];
          return http.Response(
            jsonEncode({
              'tag_name': 'v1.4.8',
              'draft': false,
              'prerelease': false,
              'html_url': 'https://example.invalid',
              'assets': [
                {
                  'name': 'gratovo_toolbox-1.4.8-windows-x64.zip',
                  'browser_download_url': 'https://example.invalid/a.zip',
                  'size': 1,
                },
              ],
            }),
            200,
          );
        }),
      );

      expect((await source.fetchLatest())!.version.toString(), '1.4.8');
      expect(sentAuth, 'Bearer tok');
    });

    test('with no token the header is simply absent', () async {
      var hadAuth = true;
      final source = GithubReleaseSource(
        client: MockClient((request) async {
          hadAuth = request.headers.containsKey('Authorization');
          return http.Response('{}', 404);
        }),
      );

      expect(await source.fetchLatest(), isNull);
      expect(hadAuth, isFalse);
    });
  });

  group('signing in and out around the shared token', () {
    test('signing out falls back to the shared token, not to "no token"',
        () async {
      final container = _container(
        _FakeAuth(token: 'mine'),
        _api(),
        shared: 'shared',
      );
      final notifier = container.read(githubAccountProvider.notifier);
      await notifier.refresh();
      expect(container.read(githubAccountProvider).isSignedIn, isTrue);

      await notifier.signOut();

      final account = container.read(githubAccountProvider);
      expect(account.isSignedIn, isFalse);
      expect(account.source, GithubTokenSource.shared);
      expect(account.hasNoToken, isFalse);
      // Updates still work through the shared token, so nothing to badge.
      expect(account.access, GithubReleaseAccess.granted);
      expect(account.needsRepoAccess, isFalse);
    });

    test('a failed sign-in keeps the shared token in use', () async {
      final container = _container(
        _FakeAuth(pollOutcome: GithubAuthFailure.denied),
        _api(),
        shared: 'shared',
      );
      final notifier = container.read(githubAccountProvider.notifier);
      await notifier.refresh();

      await notifier.signIn();

      final account = container.read(githubAccountProvider);
      expect(account.failure, GithubAuthFailure.denied);
      expect(account.source, GithubTokenSource.shared);
      expect(account.hasNoToken, isFalse);
      expect(account.pendingCode, isNull);
      expect(account.busy, isFalse);
    });

    test('a refresh landing mid-sign-in keeps the device code on screen',
        () async {
      final gate = Completer<void>();
      final container = _container(
        _FakeAuth(pollGate: gate),
        _api(),
        shared: 'shared',
      );
      final notifier = container.read(githubAccountProvider.notifier);
      await notifier.refresh();

      final signIn = notifier.signIn();
      // Let signIn get as far as showing the code and waiting on the poll.
      await Future<void>.delayed(Duration.zero);
      expect(container.read(githubAccountProvider).pendingCode, isNotNull);

      // The startup refresh (or a manual one) arrives while the person is
      // still typing the code into the browser.
      await notifier.refresh();
      final during = container.read(githubAccountProvider);
      expect(during.pendingCode?.userCode, 'ABCD-1234');
      expect(during.busy, isTrue);

      gate.complete();
      await signIn;
      final after = container.read(githubAccountProvider);
      expect(after.pendingCode, isNull);
      expect(after.isSignedIn, isTrue);
    });

    test('a token that cannot be stored is a sign-in failure, not a hang',
        () async {
      final container = _container(
        _FakeAuth(pollOutcome: GithubAuthFailure.storage),
        _api(),
      );
      final notifier = container.read(githubAccountProvider.notifier);
      await notifier.refresh();

      await notifier.signIn();

      final account = container.read(githubAccountProvider);
      expect(account.failure, GithubAuthFailure.storage);
      expect(account.busy, isFalse);
      expect(account.pendingCode, isNull);
    });

    test('a stale refresh does not overwrite a newer one', () async {
      final auth = _FakeAuth(token: 'mine');
      final container = _container(auth, _api(), shared: 'shared');
      final notifier = container.read(githubAccountProvider.notifier);

      // Two refreshes in flight; the second represents newer knowledge.
      final first = notifier.refresh();
      auth.token = null;
      final second = notifier.refresh();
      await Future.wait([first, second]);

      expect(
        container.read(githubAccountProvider).source,
        GithubTokenSource.shared,
      );
    });
  });

  group('the shared built-in token', () {
    // `sharedReleaseToken` reads a compile-time define first and this
    // machine's environment second, so a test run cannot fake one. What can be
    // tested without it is the decision the state makes from a token source,
    // and that the personal token wins when both exist.

    test('with no shared token and nobody signed in, the app says so',
        () async {
      final container = _container(_FakeAuth(), _api());
      await container.read(githubAccountProvider.notifier).refresh();

      final account = container.read(githubAccountProvider);
      // Only true when this test run also has no GRATOVO_GITHUB_TOKEN in its
      // environment, which is the normal case for CI and a dev machine that
      // has not set one.
      if (!hasSharedReleaseToken) {
        expect(account.hasNoToken, isTrue);
        expect(account.usesSharedToken, isFalse);
        expect(account.isSignedIn, isFalse);
      }
    });

    test('a personal sign-in wins over the shared token', () async {
      final container = _container(_FakeAuth(token: 'personal'), _api());
      await container.read(githubAccountProvider.notifier).refresh();

      final account = container.read(githubAccountProvider);
      expect(account.source, GithubTokenSource.personal);
      expect(account.usesSharedToken, isFalse);
      expect(account.isSignedIn, isTrue);
    });

    test('a shared token is not reported as somebody being signed in',
        () async {
      // The distinction the card depends on: `isSignedIn` must mean a person
      // chose to sign in, not merely that a token exists. Otherwise the card
      // would show "Signed in as ..." for a machine account nobody recognises.
      const shared = GithubAccount(
        login: 'release-bot',
        source: GithubTokenSource.shared,
        access: GithubReleaseAccess.granted,
      );
      expect(shared.isSignedIn, isFalse);
      expect(shared.usesSharedToken, isTrue);
      expect(shared.hasNoToken, isFalse);
    });

    test('a refused shared token still counts as needing attention', () {
      const dead = GithubAccount(
        source: GithubTokenSource.shared,
        access: GithubReleaseAccess.denied,
      );
      // Not gated on isSignedIn: an expired shared token is the whole team's
      // updates stopping, and it must badge even though nobody signed in.
      expect(dead.needsRepoAccess, isTrue);
    });
  });
}
