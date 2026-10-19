import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/features/shell/application/nav_rail_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _key = 'gratovo.navRailCollapsed';

ProviderContainer _container() {
  final container = ProviderContainer();
  addTearDown(container.dispose);
  // Keep the notifier alive for the duration of the test.
  container.listen(navRailCollapsedProvider, (_, __) {});
  return container;
}

/// Lets the notifier's `_loadPersisted` future run to completion.
Future<void> _settle() => Future<void>.delayed(Duration.zero);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('starts expanded when nothing was saved', () async {
    SharedPreferences.setMockInitialValues({});
    final container = _container();
    expect(container.read(navRailCollapsedProvider), isFalse);
    await _settle();
    expect(container.read(navRailCollapsedProvider), isFalse);
  });

  test('a saved collapse is restored after the first frame', () async {
    SharedPreferences.setMockInitialValues({_key: true});
    final container = _container();
    // The first read is synchronous and answers the default...
    expect(container.read(navRailCollapsedProvider), isFalse);
    await _settle();
    // ...and the persisted value lands as soon as the prefs are open.
    expect(container.read(navRailCollapsedProvider), isTrue);
  });

  test('toggle flips the state and writes it through', () async {
    SharedPreferences.setMockInitialValues({});
    final container = _container();
    await _settle();

    await container.read(navRailCollapsedProvider.notifier).toggle();
    expect(container.read(navRailCollapsedProvider), isTrue);
    expect((await SharedPreferences.getInstance()).getBool(_key), isTrue);

    await container.read(navRailCollapsedProvider.notifier).toggle();
    expect(container.read(navRailCollapsedProvider), isFalse);
    expect((await SharedPreferences.getInstance()).getBool(_key), isFalse);
  });

  test('set applies immediately, before the write completes', () async {
    SharedPreferences.setMockInitialValues({});
    final container = _container();
    await _settle();

    final pending = container.read(navRailCollapsedProvider.notifier).set(true);
    expect(container.read(navRailCollapsedProvider), isTrue);
    await pending;
  });
}
