import 'package:fake_async/fake_async.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/toast/notification_center.dart';
import 'package:gratovo_toolbox/core/toast/toast_severity.dart';

void main() {
  test('notify adds to both active and history, and bumps unreadCount', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final notifier = container.read(notificationCenterProvider.notifier);

    notifier.notify('Saved', ToastSeverity.success);

    final state = container.read(notificationCenterProvider);
    expect(state.active, hasLength(1));
    expect(state.history, hasLength(1));
    expect(state.active.single.message, 'Saved');
    expect(state.active.single.severity, ToastSeverity.success);
    expect(state.unreadCount, 1);
  });

  test('a toast dismisses itself off `active` after its severity duration', () {
    fakeAsync((async) {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final notifier = container.read(notificationCenterProvider.notifier);

      notifier.notify('Send failed', ToastSeverity.error);
      expect(container.read(notificationCenterProvider).active, hasLength(1));

      // Short of the error duration: still showing.
      async.elapse(const Duration(seconds: 5));
      expect(container.read(notificationCenterProvider).active, hasLength(1));

      // Past it: gone from `active`, but the history record stays.
      async.elapse(const Duration(seconds: 2));
      final state = container.read(notificationCenterProvider);
      expect(state.active, isEmpty);
      expect(state.history, hasLength(1));
    });
  });

  test('dismiss removes a toast early and cancels its timer', () {
    fakeAsync((async) {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final notifier = container.read(notificationCenterProvider.notifier);

      final entry = notifier.notify('Copied', ToastSeverity.info);
      notifier.dismiss(entry.id);
      expect(container.read(notificationCenterProvider).active, isEmpty);

      // The now-cancelled timer firing later must not throw or touch state.
      async.elapse(const Duration(seconds: 10));
      expect(container.read(notificationCenterProvider).active, isEmpty);
    });
  });

  test('acknowledge clears unreadCount without touching history', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final notifier = container.read(notificationCenterProvider.notifier);

    notifier.notify('One', ToastSeverity.info);
    notifier.notify('Two', ToastSeverity.warning);
    notifier.acknowledge();

    final state = container.read(notificationCenterProvider);
    expect(state.unreadCount, 0);
    expect(state.history, hasLength(2));
  });

  test('clearHistory empties the log and the unread count', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final notifier = container.read(notificationCenterProvider.notifier);

    notifier.notify('One', ToastSeverity.info);
    notifier.clearHistory();

    final state = container.read(notificationCenterProvider);
    expect(state.history, isEmpty);
    expect(state.unreadCount, 0);
  });

  test('history is capped at historyLimit entries, newest first', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final notifier = container.read(notificationCenterProvider.notifier);

    for (var i = 0; i < NotificationCenter.historyLimit + 5; i++) {
      notifier.notify('msg $i', ToastSeverity.info);
    }

    final history = container.read(notificationCenterProvider).history;
    expect(history, hasLength(NotificationCenter.historyLimit));
    expect(
      history.first.message,
      'msg ${NotificationCenter.historyLimit + 4}',
    );
  });
}
