import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/features/news/application/news_badge_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The badge is "new stories since the last fetch": the difference between the
/// count now and the count as of the fetch before it, held until the next
/// fetch rather than reset on read.
void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('the first fetch reports its whole count as new', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    await container.read(newsBadgeProvider.notifier).recordFetch(12);

    expect(container.read(newsBadgeProvider).delta, 12);
  });

  test('a later fetch reports only what it added, and holds that value',
      () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final notifier = container.read(newsBadgeProvider.notifier);

    await notifier.recordFetch(12);
    await notifier.recordFetch(15);

    expect(container.read(newsBadgeProvider).delta, 3);
    // Reading it again does not roll it back to zero.
    expect(container.read(newsBadgeProvider).delta, 3);
  });

  test('the delta goes negative when stories aged out', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final notifier = container.read(newsBadgeProvider.notifier);

    await notifier.recordFetch(20);
    await notifier.recordFetch(14);

    expect(container.read(newsBadgeProvider).delta, -6);
  });

  test('reset drops the baseline so the next fetch counts as all-new',
      () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final notifier = container.read(newsBadgeProvider.notifier);

    await notifier.recordFetch(30);
    await notifier.reset();
    expect(container.read(newsBadgeProvider).delta, 0);

    await notifier.recordFetch(9);
    expect(container.read(newsBadgeProvider).delta, 9);
  });

  test('the counters survive a restart', () async {
    final first = ProviderContainer();
    await first.read(newsBadgeProvider.notifier).recordFetch(10);
    await first.read(newsBadgeProvider.notifier).recordFetch(13);
    first.dispose();

    final second = ProviderContainer();
    addTearDown(second.dispose);
    // Build the provider, then let its async load from SharedPreferences run.
    second.read(newsBadgeProvider);
    await Future<void>.delayed(const Duration(milliseconds: 50));

    expect(second.read(newsBadgeProvider).delta, 3);
    expect(second.read(newsBadgeProvider).lastCount, 13);
  });
}
