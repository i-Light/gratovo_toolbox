import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';
import 'package:gratovo_toolbox/features/settings/application/gemini_account_memory.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_gemini_bridge.dart';

void main() {
  group('withAccountSeen', () {
    const base = GeminiBridgeSettings(
      lastAccountName: 'Ana',
      lastAccountEmail: 'ana@x.com',
      lastAccountIndex: 1,
    );

    test('nothing to remember returns the same instance', () {
      expect(identical(withAccountSeen(base, const GeminiAccount()), base),
          isTrue);
    });

    test('the same account again is not news', () {
      final same = withAccountSeen(
        base,
        const GeminiAccount(name: 'ana', email: 'ANA@x.com', index: 1),
      );
      expect(identical(same, base), isTrue);
    });

    test('a different email replaces the name too', () {
      final next = withAccountSeen(
        base,
        const GeminiAccount(email: 'bob@y.com'),
      );
      expect(next.lastAccountEmail, 'bob@y.com');
      expect(next.lastAccountName, '');
      expect(next.lastAccountIndex, isNull);
    });

    test('a name alone for the same person keeps the email', () {
      final next = withAccountSeen(base, const GeminiAccount(name: 'Ana'));
      expect(next.lastAccountEmail, 'ana@x.com');
    });

    test('a different name alone drops the old email', () {
      final next = withAccountSeen(base, const GeminiAccount(name: 'Bob'));
      expect(next.lastAccountName, 'Bob');
      expect(next.lastAccountEmail, '');
    });

    test('lastSeenAccount reads it back, null when blank', () {
      expect(lastSeenAccount(const GeminiBridgeSettings()), isNull);
      expect(lastSeenAccount(base)!.label, 'Ana (ana@x.com)');
    });
  });

  group('persistence', () {
    test('a saved account survives an early edit (the race)', () async {
      SharedPreferences.setMockInitialValues({
        'gratovo.gemini.accountMatch': 'ana@x.com',
        'gratovo.gemini.lastAccountEmail': 'ana@x.com',
        'gratovo.gemini.keywordsGem': 'https://gemini.google.com/gem/k',
      });
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final notifier = container.read(geminiBridgeSettingsProvider.notifier);
      // Before the load has landed:
      await notifier.edit((s) => s.copyWith(autoStart: false));
      final settings = container.read(geminiBridgeSettingsProvider);
      expect(settings.autoStart, isFalse);
      expect(settings.accountMatch, 'ana@x.com');
      expect(settings.lastAccountEmail, 'ana@x.com');
      expect(settings.keywordsGem, 'https://gemini.google.com/gem/k');
    });

    test('the connected account is remembered and outlives the connection',
        () async {
      SharedPreferences.setMockInitialValues({});
      final bridge = FakeGeminiBridge(initialState: connectedGeminiState());
      final container = ProviderContainer(
        overrides: [geminiBridgeProvider.overrideWithValue(bridge)],
      );
      addTearDown(container.dispose);
      container.listen(geminiAccountMemoryProvider, (_, __) {});
      await container.read(geminiBridgeSettingsProvider.notifier).ready;
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      var settings = container.read(geminiBridgeSettingsProvider);
      expect(settings.lastAccountEmail, 'moustafa@example.com');
      expect(settings.lastAccountName, 'Moustafa Khaled');

      bridge.setState(const GeminiBridgeState.stopped());
      await Future<void>.delayed(Duration.zero);
      settings = container.read(geminiBridgeSettingsProvider);
      expect(settings.lastAccountEmail, 'moustafa@example.com');
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('gratovo.gemini.lastAccountEmail'),
          'moustafa@example.com');
    });

    test('a hello event with an account is remembered', () async {
      SharedPreferences.setMockInitialValues({});
      final bridge = FakeGeminiBridge();
      final container = ProviderContainer(
        overrides: [geminiBridgeProvider.overrideWithValue(bridge)],
      );
      addTearDown(container.dispose);
      container.listen(geminiAccountMemoryProvider, (_, __) {});
      await container.read(geminiBridgeSettingsProvider.notifier).ready;
      bridge.emit(const GeminiEvent(event: 'hello', data: {
        'account': {'name': 'Zed', 'email': 'z@z.com', 'index': 2},
      }));
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      final settings = container.read(geminiBridgeSettingsProvider);
      expect(settings.lastAccountEmail, 'z@z.com');
      expect(settings.lastAccountIndex, 2);
    });
  });
}
