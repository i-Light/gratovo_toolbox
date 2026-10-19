import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/sync/sync_providers.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// What went wrong signing in, in words a teammate can act on.
///
/// Supabase returns accurate but unhelpful strings ("Invalid login
/// credentials"), and network failures surface as raw socket exceptions.
/// Neither tells someone whether to retype their password or call you, so
/// they get translated here.
enum SignInProblem {
  invalidCredentials,
  emailNotConfirmed,
  offline,
  notConfigured,
  unknown;
}

class AuthFailure implements Exception {
  const AuthFailure(this.problem, [this.detail]);

  final SignInProblem problem;
  final String? detail;

  @override
  String toString() =>
      'AuthFailure($problem${detail == null ? '' : ': $detail'})';
}

/// Sign in and sign out. Deliberately thin: Supabase already persists the
/// session and refreshes the token in the background, so there is no
/// "remember me" flag and no token handling here. Signing in once on a
/// machine keeps you signed in until you press Sign out.
class AuthController extends AsyncNotifier<void> {
  @override
  Future<void> build() async {}

  Future<void> signIn({required String email, required String password}) async {
    final client = ref.read(supabaseClientProvider);
    if (client == null) {
      throw const AuthFailure(SignInProblem.notConfigured);
    }

    state = const AsyncValue<void>.loading();
    try {
      await client.auth.signInWithPassword(
        email: email.trim(),
        password: password,
      );
      // Everything derived from identity is now stale by definition.
      ref.invalidate(currentProfileProvider);
      ref.invalidate(teamMembersProvider);
      state = const AsyncValue<void>.data(null);
    } on AuthException catch (error, stackTrace) {
      state = AsyncValue<void>.error(error, stackTrace);
      throw AuthFailure(classifySignInError(error), error.message);
    } catch (error, stackTrace) {
      state = AsyncValue<void>.error(error, stackTrace);
      throw AuthFailure(
        looksOffline(error) ? SignInProblem.offline : SignInProblem.unknown,
        error.toString(),
      );
    }
  }

  Future<void> signOut() async {
    final client = ref.read(supabaseClientProvider);
    if (client == null) return;

    // The local database stays; the session's pull cursors go.
    //
    // The file is this machine's working copy, shared with the Python
    // pipeline, and it may hold edits not uploaded yet — deleting it on
    // sign-out would throw away the pipeline's scraped tables and unsent work
    // together. What a sign-out must not leave behind is a watermark, so the
    // next account to sign in here starts with a full pull of the (small)
    // typed-in tables rather than a delta from somebody else's cursor.
    //
    // Guarded, because signing out must not depend on any of that working.
    try {
      await ref.read(syncEngineProvider)?.forgetSession();
    } catch (error, stackTrace) {
      developer.log(
        'Could not clear the sync cursors while signing out; continuing.',
        name: 'gratovo.auth',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }

    await client.auth.signOut();
    ref.invalidate(currentProfileProvider);
    ref.invalidate(teamMembersProvider);
  }

  /// Supabase's message, read for the two cases a person can do something
  /// about. Static so the mapping is testable without a client.
  @visibleForTesting
  static SignInProblem classifySignInError(AuthException error) {
    final message = error.message.toLowerCase();
    if (message.contains('not confirmed')) {
      return SignInProblem.emailNotConfirmed;
    }
    if (message.contains('invalid login') ||
        message.contains('invalid credentials')) {
      return SignInProblem.invalidCredentials;
    }
    return SignInProblem.unknown;
  }

  /// Whether a non-auth failure reads like the network, not the account.
  @visibleForTesting
  static bool looksOffline(Object error) {
    final text = error.toString().toLowerCase();
    return text.contains('socketexception') ||
        text.contains('failed host lookup') ||
        text.contains('clientexception') ||
        text.contains('connection');
  }
}

final authControllerProvider =
    AsyncNotifierProvider<AuthController, void>(AuthController.new);
