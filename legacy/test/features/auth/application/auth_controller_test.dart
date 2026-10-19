import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/features/auth/application/auth_controller.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

void main() {
  group('classifySignInError', () {
    SignInProblem classify(String message) =>
        AuthController.classifySignInError(AuthException(message));

    test('the wrong password is invalid credentials', () {
      expect(classify('Invalid login credentials'),
          SignInProblem.invalidCredentials);
      expect(classify('invalid credentials'), SignInProblem.invalidCredentials);
    });

    test('an unconfirmed address says so', () {
      expect(classify('Email not confirmed'), SignInProblem.emailNotConfirmed);
    });

    test('anything else is unknown, with the message kept', () {
      expect(classify('Database error querying schema'), SignInProblem.unknown);
      expect(classify(''), SignInProblem.unknown);
    });
  });

  group('looksOffline', () {
    test('socket and DNS failures read as offline', () {
      expect(
        AuthController.looksOffline(
            const SocketException('Failed host lookup')),
        isTrue,
      );
      expect(
        AuthController.looksOffline(http.ClientException('Connection closed')),
        isTrue,
      );
      expect(
        AuthController.looksOffline(StateError('connection refused')),
        isTrue,
      );
    });

    test('other failures do not', () {
      expect(AuthController.looksOffline(StateError('bad state')), isFalse);
      expect(AuthController.looksOffline(const FormatException('x')), isFalse);
    });
  });

  group('without a Supabase client', () {
    late ProviderContainer container;

    setUp(() {
      container = ProviderContainer(
        overrides: [supabaseClientProvider.overrideWithValue(null)],
      );
      addTearDown(container.dispose);
    });

    test('sign-in fails as not configured, before touching state', () async {
      final auth = container.read(authControllerProvider.notifier);
      await expectLater(
        auth.signIn(email: 'a@b.c', password: 'pw'),
        throwsA(isA<AuthFailure>()
            .having((f) => f.problem, 'problem', SignInProblem.notConfigured)),
      );
      // Never went through loading: there was nothing to wait for.
      expect(container.read(authControllerProvider).isLoading, isFalse);
      expect(container.read(authControllerProvider).hasError, isFalse);
    });

    test('sign-out is a no-op', () async {
      await container.read(authControllerProvider.notifier).signOut();
    });
  });

  test('AuthFailure prints its problem and detail', () {
    expect(
      const AuthFailure(SignInProblem.offline, 'no route').toString(),
      'AuthFailure(SignInProblem.offline: no route)',
    );
    expect(
      const AuthFailure(SignInProblem.unknown).toString(),
      'AuthFailure(SignInProblem.unknown)',
    );
  });
}
