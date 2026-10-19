import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/github/github_auth.dart';
import 'package:gratovo_toolbox/core/github/github_token_provider.dart';
import 'package:gratovo_toolbox/core/github/shared_release_token.dart';
import 'package:gratovo_toolbox/core/update/github_release_source.dart';
import 'package:http/http.dart' as http;

/// Whether the signed-in GitHub account can actually reach this project's
/// releases.
///
/// Separate from "is signed in" on purpose, and the distinction is the whole
/// point of this card: a teammate can sign in perfectly successfully with an
/// account that has never been added to the private repository, and every
/// update check will then quietly find nothing. GitHub does not say "you lack
/// access" — it 404s, because admitting a private repo exists would itself be
/// a leak. So the app asks directly and says which of the two it is.
enum GithubReleaseAccess {
  /// Not asked yet.
  unknown,

  /// The account can read the repository's releases.
  granted,

  /// GitHub answered 404: either the repo does not exist or this account
  /// cannot see it. For a slug that is known to exist, it is the second.
  denied,

  /// The token itself was rejected — revoked in GitHub's settings, or
  /// expired. Signing in again fixes it.
  tokenRejected,

  /// Could not be determined: offline, GitHub down.
  unreachable,
}

@immutable
class GithubAccount {
  const GithubAccount({
    this.login,
    this.avatarUrl,
    this.access = GithubReleaseAccess.unknown,
    this.source = GithubTokenSource.none,
    this.pendingCode,
    this.failure,
    this.busy = false,
    this.resolved = true,
  });

  /// The state before the first [GithubAccountController.refresh] has read
  /// the stored token. Nothing here is known yet, and in particular
  /// [hasNoToken] must not be believed: badging "no token" for the second or
  /// twenty it takes to find out is a red dot on every launch.
  static const probing = GithubAccount(busy: true, resolved: false);

  /// The GitHub username, once signed in.
  final String? login;
  final String? avatarUrl;
  final GithubReleaseAccess access;

  /// Which token [access] was measured with. The card reads very differently
  /// for the two: a shared token that stopped working is everybody's problem
  /// and needs a new build, where a personal one is just this machine's.
  final GithubTokenSource source;

  /// Set while a device-flow sign-in is waiting for the person to type the
  /// code into a browser.
  final GithubDeviceCode? pendingCode;

  final GithubAuthFailure? failure;
  final bool busy;

  /// False only for [probing]. Every state a refresh produces is resolved.
  final bool resolved;

  /// Somebody signed in personally on this machine. The shared token is not
  /// a sign-in — nobody chose it and it names no one.
  bool get isSignedIn => login != null && source == GithubTokenSource.personal;

  /// Updates are running on the token compiled into the build.
  bool get usesSharedToken => source == GithubTokenSource.shared;
  bool get isSigningIn => pendingCode != null;

  /// Signed in, but this account cannot see the releases — the case worth
  /// surfacing loudly, because the fix is on GitHub's side (add them to the
  /// repo) and nothing in the app will hint at it otherwise.
  bool get needsRepoAccess =>
      source != GithubTokenSource.none && access == GithubReleaseAccess.denied;

  /// The update check cannot work at all: no shared token in this build and
  /// nobody signed in.
  bool get hasNoToken => resolved && source == GithubTokenSource.none;

  GithubAccount copyWith({
    String? login,
    String? avatarUrl,
    GithubReleaseAccess? access,
    GithubTokenSource? source,
    GithubDeviceCode? pendingCode,
    GithubAuthFailure? failure,
    bool? busy,
    bool clearPendingCode = false,
    bool clearFailure = false,
  }) {
    return GithubAccount(
      login: login ?? this.login,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      access: access ?? this.access,
      source: source ?? this.source,
      pendingCode: clearPendingCode ? null : (pendingCode ?? this.pendingCode),
      failure: clearFailure ? null : (failure ?? this.failure),
      busy: busy ?? this.busy,
      resolved: resolved,
    );
  }
}

/// The GitHub sign-in behind the update checker.
///
/// The repository is private, so an anonymous release check gets a 404 and the
/// updater would never find anything. Rather than shipping one shared token
/// compiled into every copy — which would be a credential handed to anyone
/// with the .exe, and unrevocable without rebuilding — each person signs in
/// with their own account and the app uses their own access.
class GithubAccountController extends Notifier<GithubAccount> {
  GithubAccountController({
    GithubAuth? auth,
    http.Client? client,
    String? Function()? sharedToken,
  })  : _injectedAuth = auth,
        _client = client,
        _sharedToken = sharedToken ?? (() => sharedReleaseToken);

  final GithubAuth? _injectedAuth;
  final http.Client? _client;

  /// Where the built-in token comes from. Injectable because the real one is
  /// a compile-time define that a test run cannot set.
  final String? Function() _sharedToken;

  /// Bumped by every refresh; a refresh that finds the counter moved on
  /// while it was waiting on the network throws its answer away, because a
  /// newer one is already describing a newer token.
  int _generation = 0;

  late final GithubAuth _auth = _injectedAuth ?? GithubAuth(client: _client);

  @override
  GithubAccount build() {
    unawaited(refresh());
    return GithubAccount.probing;
  }

  /// Reads the stored token and asks GitHub who it belongs to and what it can
  /// see. Safe to call at any time.
  Future<void> refresh() async {
    final generation = ++_generation;
    final personal = await _auth.readToken();
    if (generation != _generation) return;
    final token = personal ?? _sharedToken();
    final source = personal != null
        ? GithubTokenSource.personal
        : (token != null ? GithubTokenSource.shared : GithubTokenSource.none);

    if (token == null) {
      // Clears the identity, but keeps anything a sign-in attempt is in the
      // middle of saying. `build()` kicks off a refresh in the background, and
      // it used to land a moment after a failed sign-in and wipe the message
      // explaining what went wrong — leaving a card that had visibly done
      // nothing.
      state = GithubAccount(
        pendingCode: state.pendingCode,
        failure: state.failure,
        busy: state.busy && state.isSigningIn,
      );
      return;
    }

    state = state.copyWith(busy: true, clearFailure: true);
    final access = await probeAccess(token);
    // Only a personal token has a person behind it worth naming. Asking who
    // the shared one belongs to would show a machine account's login on
    // everybody's screen, which explains nothing.
    final identity = personal == null ? null : await _fetchIdentity(personal);
    if (generation != _generation) return;

    // Offline with a personal token, keep naming whoever it last named:
    // the card flipping to anonymous every time the network blinks reads
    // as being signed out.
    final offline = personal != null && identity == null;
    final remembered = offline && state.source == GithubTokenSource.personal;
    state = GithubAccount(
      login: identity?.login ?? (remembered ? state.login : null),
      avatarUrl: identity?.avatarUrl ?? (remembered ? state.avatarUrl : null),
      source: source,
      // A personal token GitHub no longer recognises has been revoked,
      // whatever the release probe made of it. Not hearing back at all is a
      // different thing — the probe already said `unreachable` for that.
      access: identity?.rejected ?? false
          ? GithubReleaseAccess.tokenRejected
          : access,
      // A sign-in can be mid-flight underneath a startup refresh; the device
      // code on screen is the one thing that must survive it.
      pendingCode: state.pendingCode,
      busy: state.isSigningIn,
    );
  }

  /// Starts the device flow. The returned code is put in state for the card to
  /// display; the poll runs in the background until it succeeds or gives up.
  Future<void> signIn() async {
    if (!_auth.isConfigured) {
      state = state.copyWith(failure: GithubAuthFailure.notConfigured);
      return;
    }
    state = state.copyWith(busy: true, clearFailure: true);
    try {
      final code = await _auth.requestDeviceCode();
      state = state.copyWith(pendingCode: code, busy: true);
      await _auth.pollForToken(code);
      ref.invalidate(githubTokenProvider);
      state = state.copyWith(clearPendingCode: true);
      await refresh();
    } on GithubAuthException catch (error) {
      // Whatever token was in use before the attempt (the shared one, most
      // likely) is still in use; only the attempt failed.
      state = state.copyWith(
        failure: error.failure,
        busy: false,
        clearPendingCode: true,
      );
    }
  }

  /// Forgets the personal token. The shared built-in one, if the build has
  /// it, is what the app falls back to — so this is a refresh, not a reset:
  /// "signed out" must not read as "no token" when updates still work.
  Future<void> signOut() async {
    await _auth.signOut();
    ref.invalidate(githubTokenProvider);
    await refresh();
  }

  /// Asks whether [token] can read this project's releases.
  ///
  /// Made public and kept small so the answer has exactly one definition —
  /// the card, the badge and the updater all mean the same thing by "can see
  /// the releases".
  Future<GithubReleaseAccess> probeAccess(String token) async {
    final client = _client ?? http.Client();
    try {
      final response = await client.get(
        Uri.https('api.github.com', '/repos/$kUpdateRepoSlug/releases'),
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': 'Bearer $token',
          'User-Agent': 'gratovo-toolbox-updater',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      ).timeout(const Duration(seconds: 20));

      return switch (response.statusCode) {
        200 => GithubReleaseAccess.granted,
        401 => GithubReleaseAccess.tokenRejected,
        // 403 here is a rate limit or an org policy, not "wrong account";
        // 404 is the private-repo answer for somebody who was never added.
        404 => GithubReleaseAccess.denied,
        _ => GithubReleaseAccess.unreachable,
      };
    } catch (error) {
      developer.log(
        'Could not check GitHub release access.',
        name: 'gratovo.github',
        level: 800,
        error: error,
      );
      return GithubReleaseAccess.unreachable;
    } finally {
      if (_client == null) client.close();
    }
  }

  /// `(login, avatarUrl)`, or null when the token is no longer good.
  /// Who a personal token belongs to. `rejected` is GitHub saying the token
  /// is no good (401); a `null` login without it is GitHub not answering,
  /// which says nothing about the token.
  Future<_Identity?> _fetchIdentity(String token) async {
    final client = _client ?? http.Client();
    try {
      final response = await client.get(
        Uri.https('api.github.com', '/user'),
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': 'Bearer $token',
          'User-Agent': 'gratovo-toolbox-updater',
        },
      ).timeout(const Duration(seconds: 20));
      if (response.statusCode == 401) return const _Identity(rejected: true);
      if (response.statusCode != 200) return null;
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      final login = json['login'] as String?;
      if (login == null) return const _Identity(rejected: true);
      return _Identity(login: login, avatarUrl: json['avatar_url'] as String?);
    } catch (_) {
      return null;
    } finally {
      if (_client == null) client.close();
    }
  }
}

class _Identity {
  const _Identity({this.login, this.avatarUrl, this.rejected = false});

  final String? login;
  final String? avatarUrl;
  final bool rejected;
}

final githubAccountProvider =
    NotifierProvider<GithubAccountController, GithubAccount>(
  GithubAccountController.new,
);

/// The token the update checker should send, or null when nobody is signed in
/// here. Read rather than watched by the checker: a token change should not
/// restart a poll timer.
