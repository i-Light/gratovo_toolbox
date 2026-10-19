import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/features/onboarding/application/onboarding_preferences.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Same shape as `test/core/time/display_time_zone_controller_test.dart`:
/// exercise the `Notifier<bool>` against a mocked `shared_preferences`.
ProviderContainer _container() {
  final container = ProviderContainer();
  addTearDown(container.dispose);
  return container;
}

Future<void> _settle(ProviderContainer container) async {
  await pumpEventQueue();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('with nothing stored yet, onboarding is needed', () async {
    final container = _container();
    container.read(onboardingCompletedProvider);
    await _settle(container);

    expect(container.read(onboardingCompletedProvider), isFalse);
    expect(container.read(needsOnboardingProvider), isTrue);
  });

  test('a persisted true is loaded and stops the wizard showing', () async {
    SharedPreferences.setMockInitialValues(
      {'gratovo.onboarding.completed': true},
    );
    final container = _container();
    container.read(onboardingCompletedProvider);
    await _settle(container);

    expect(container.read(onboardingCompletedProvider), isTrue);
    expect(container.read(needsOnboardingProvider), isFalse);
  });

  test('a persisted false keeps the wizard showing', () async {
    SharedPreferences.setMockInitialValues(
      {'gratovo.onboarding.completed': false},
    );
    final container = _container();
    container.read(onboardingCompletedProvider);
    await _settle(container);

    expect(container.read(needsOnboardingProvider), isTrue);
  });

  test('markComplete flips state and persists it', () async {
    final container = _container();
    container.read(onboardingCompletedProvider);
    await _settle(container);

    await container.read(onboardingCompletedProvider.notifier).markComplete();

    expect(container.read(onboardingCompletedProvider), isTrue);
    expect(container.read(needsOnboardingProvider), isFalse);

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool('gratovo.onboarding.completed'), isTrue);
  });

  test('markComplete survives into a fresh container reading the same prefs',
      () async {
    final first = _container();
    first.read(onboardingCompletedProvider);
    await _settle(first);
    await first.read(onboardingCompletedProvider.notifier).markComplete();

    final second = _container();
    second.read(onboardingCompletedProvider);
    await _settle(second);

    expect(second.read(needsOnboardingProvider), isFalse);
  });
}
