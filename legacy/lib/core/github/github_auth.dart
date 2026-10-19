import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:gratovo_toolbox/core/github/github_env.dart';
import 'package:http/http.dart' as http;

/// The OAuth App the device-flow sign-in runs against.
///
/// Supplied at build time (`--dart-define=GRATOVO_GITHUB_CLIENT_ID=...`)
/// rather than committed, and blank by default — an unconfigured build simply
/// says so on the Accounts card instead of failing at a confusing moment.
///
/// A client id is public information by design: OAuth device flow has no
/// client secret precisely so that it can be used from a desktop app, where
/// anything compiled in can be read back out with `strings`. What it is *not*
/// is a credential — it identifies the app, and every token it yields is the
/// signed-in person's own, carrying only their own access.
const _compiledGithubClientId =
    String.fromEnvironment('GRATOVO_GITHUB_CLIENT_ID', defaultValue: '');

/// The client id this build will use: the compiled-in one, or — when there
/// isn't one, which is the case for any run from source — this machine's
/// `GRATOVO_GITHUB_CLIENT_ID` environment variable.
///
/// The fallback exists so the sign-in doesn't work in the shipped build and
/// silently fail in development. Shipped builds never reach it.
String get kGithubClientId => _compiledGithubClientId.isNotEmpty
    ? _compiledGithubClientId
    : (githubEnvValue('GRATOVO_GITHUB_CLIENT_ID') ?? '');

/// Read access to the private repository's releases. `repo` is the narrowest
/// scope GitHub offers that covers a private repo's release assets — there is
/// no read-only release scope for classic OAuth apps.
const kGithubScope = 'repo';

const _tokenStorageKey = 'gratovo.github.token';

/// What GitHub hands back when a device-flow sign-in starts: the code the
/// person types, and where they type it.
@immutable
class GithubDeviceCode {
  const GithubDeviceCode({
    required this.deviceCode,
    required this.userCode,
    required this.verificationUri,
    required this.interval,
    required this.expiresIn,
  });

  final String deviceCode;

  /// The short code shown in the app and typed into the browser.
  final String userCode;

  final String verificationUri;

  /// The minimum seconds between polls. GitHub says how often it will answer
  /// and rejects anything faster, so this is obeyed rather than guessed.
  final Duration interval;
  final Duration expiresIn;
}

/// Why a sign-in ended without a token.
enum GithubAuthFailure {
  /// The build carries no client id.
  notConfigured,

  /// The person took longer than the code was valid for.
  expired,

  /// The person refused the authorization in the browser.
  denied,

  /// Network, DNS, GitHub being down.
  unreachable,

  /// GitHub issued a token but this machine's secure storage refused to keep
  /// it. The grant exists on GitHub's side; signing in again mints another.
  storage,
}

class GithubAuthException implements Exception {
  const GithubAuthException(this.failure, [this.detail]);

  final GithubAuthFailure failure;
  final String? detail;

  @override
  String toString() => 'GithubAuthException($failure${detail ?? ''})';
}

/// Signs a person in to GitHub with their own account, using the OAuth device
/// flow, and keeps the resulting token in the OS keystore.
///
/// Device flow rather than a redirect: a desktop app has no URL it can be
/// redirected back to without either embedding a client secret or standing up
/// a loopback server on an unpredictable port, and neither is worth it for a
/// sign-in somebody does once. Device flow trades that for typing an
/// eight-character code, in exchange for no secret existing anywhere.
///
/// Each teammate signs in as themselves. The app never holds a shared token,
/// and what any given person can download is exactly what their own GitHub
/// account can already reach — which is what makes "this account cannot see
/// the releases" an answerable question rather than a guess.
class GithubAuth {
  GithubAuth({http.Client? client, FlutterSecureStorage? storage})
      : _client = client,
        _storage = storage ?? const FlutterSecureStorage();

  final http.Client? _client;
  final FlutterSecureStorage _storage;

  bool get isConfigured => kGithubClientId.isNotEmpty;

  /// The stored token, or null when nobody has signed in on this machine.
  Future<String?> readToken() async {
    try {
      return await _storage.read(key: _tokenStorageKey);
    } catch (error, stackTrace) {
      developer.log(
        'Could not read the stored GitHub token.',
        name: 'gratovo.github',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
      return null;
    }
  }

  Future<void> writeToken(String token) =>
      _storage.write(key: _tokenStorageKey, value: token);

  /// Forgets the token. The grant itself lives in the person's GitHub
  /// settings and is revoked there — this only stops *this* machine using it,
  /// which is what "sign out" should mean.
  Future<void> signOut() async {
    try {
      await _storage.delete(key: _tokenStorageKey);
    } catch (error) {
      developer.log(
        'Could not clear the stored GitHub token.',
        name: 'gratovo.github',
        level: 900,
        error: error,
      );
    }
  }

  /// Step one: ask GitHub for a code for this machine.
  Future<GithubDeviceCode> requestDeviceCode() async {
    if (!isConfigured) {
      throw const GithubAuthException(GithubAuthFailure.notConfigured);
    }
    final json = await _post('https://github.com/login/device/code', {
      'client_id': kGithubClientId,
      'scope': kGithubScope,
    });
    return GithubDeviceCode(
      deviceCode: json['device_code'] as String,
      userCode: json['user_code'] as String,
      verificationUri: json['verification_uri'] as String,
      interval: Duration(seconds: (json['interval'] as int?) ?? 5),
      expiresIn: Duration(seconds: (json['expires_in'] as int?) ?? 900),
    );
  }

  /// Step two: poll until the person has authorized in the browser.
  ///
  /// Returns the token. Throws [GithubAuthException] when they declined, took
  /// too long, or GitHub could not be reached.
  Future<String> pollForToken(GithubDeviceCode code) async {
    var interval = code.interval;
    final deadline = DateTime.now().add(code.expiresIn);

    while (DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(interval);
      final json = await _post('https://github.com/login/oauth/access_token', {
        'client_id': kGithubClientId,
        'device_code': code.deviceCode,
        'grant_type': 'urn:ietf:params:oauth:grant-type:device_code',
      });

      final token = json['access_token'] as String?;
      if (token != null) {
        try {
          await writeToken(token);
        } catch (error, stackTrace) {
          // Secure storage throws a PlatformException, not one of ours, and a
          // sign-in that cannot be kept must read as a sign-in that failed —
          // not as a card stuck on "waiting for the code".
          developer.log(
            'GitHub issued a token but it could not be stored.',
            name: 'gratovo.github',
            level: 900,
            error: error,
            stackTrace: stackTrace,
          );
          throw const GithubAuthException(GithubAuthFailure.storage);
        }
        return token;
      }

      switch (json['error'] as String?) {
        case 'authorization_pending':
          continue;
        case 'slow_down':
          // GitHub asking to be polled less often. Obeyed rather than
          // ignored: continuing at the old rate gets the flow rejected.
          interval += const Duration(seconds: 5);
        case 'expired_token':
          throw const GithubAuthException(GithubAuthFailure.expired);
        case 'access_denied':
          throw const GithubAuthException(GithubAuthFailure.denied);
        default:
          throw GithubAuthException(
            GithubAuthFailure.unreachable,
            json['error_description'] as String?,
          );
      }
    }
    throw const GithubAuthException(GithubAuthFailure.expired);
  }

  Future<Map<String, dynamic>> _post(
    String url,
    Map<String, String> body,
  ) async {
    final client = _client ?? http.Client();
    try {
      final response = await client
          .post(
            Uri.parse(url),
            // GitHub's OAuth endpoints answer in form encoding unless asked
            // otherwise, and a silently form-encoded body parsed as JSON is a
            // confusing failure.
            headers: const {
              'Accept': 'application/json',
              'User-Agent': 'gratovo-toolbox-updater',
            },
            body: body,
          )
          .timeout(const Duration(seconds: 20));
      return jsonDecode(response.body) as Map<String, dynamic>;
    } on GithubAuthException {
      rethrow;
    } catch (error) {
      throw GithubAuthException(GithubAuthFailure.unreachable, '$error');
    } finally {
      if (_client == null) client.close();
    }
  }
}
