import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/presence/presence_service.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Stands in for "an auth event happened": the session object is replaced on
/// every token refresh, and the profile reloads (loading, then data) after it.
final _authEvents = NotifierProvider<_AuthEvents, int>(_AuthEvents.new);

class _AuthEvents extends Notifier<int> {
  @override
  int build() => 0;

  void fire() => state++;
}

void main() {
  test('auth events do not rebuild the presence controller', () async {
    // A rebuild runs the controller's onDispose -- which tore the channel
    // down -- and a token refresh caused two or three of them in a burst:
    // leave + join + track each time, which is what the server answered
    // with "Client presence rate limit exceeded".
    final container = ProviderContainer(
      overrides: [
        supabaseClientProvider.overrideWithValue(null),
        // A new Session object per event, as a token refresh produces --
        // same person, new token.
        currentSessionProvider.overrideWith((ref) {
          final n = ref.watch(_authEvents);
          return Session(
            accessToken: 'token-$n',
            tokenType: 'bearer',
            user: const User(
              id: 'user-1',
              appMetadata: {},
              userMetadata: {},
              aud: 'authenticated',
              createdAt: '2026-01-01T00:00:00Z',
            ),
          );
        }),
        currentProfileProvider.overrideWith((ref) async {
          ref.watch(_authEvents);
          return null;
        }),
      ],
    );
    addTearDown(container.dispose);
    container.listen(presenceControllerProvider, (_, __) {});

    for (var i = 0; i < 5; i++) {
      container.read(_authEvents.notifier).fire();
      container.read(currentSessionProvider);
      await container.read(currentProfileProvider.future);
      await Future<void>.delayed(Duration.zero);
    }

    expect(container.read(presenceControllerProvider.notifier).buildCount, 1);
    expect(container.read(presenceControllerProvider).isConnected, isFalse);
  });
}
