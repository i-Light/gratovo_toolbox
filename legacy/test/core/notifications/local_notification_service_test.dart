import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/notifications/local_notification_service.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;

void main() {
  // No notification plugin is registered in the test binding, so every call
  // into the service should swallow the resulting MissingPluginException and
  // behave as a no-op — the whole point of the "best-effort" contract.
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(tzdata.initializeTimeZones);

  test('init does not throw without a platform plugin', () async {
    await LocalNotificationService().init();
  });

  test('scheduling a past time is a silent no-op', () async {
    final service = LocalNotificationService();
    await service.schedule(
      id: 1,
      title: 'late',
      body: 'late',
      whenUtc: DateTime.now().toUtc().subtract(const Duration(hours: 1)),
    );
  });

  test('scheduling a future time is swallowed, not thrown', () async {
    final service = LocalNotificationService();
    await service.schedule(
      id: 2,
      title: 'soon',
      body: 'soon',
      whenUtc: DateTime.now().toUtc().add(const Duration(days: 1)),
      payload: 'thread:ch_1',
    );
  });

  test('cancel / cancelAll / requestPermission never throw', () async {
    final service = LocalNotificationService();
    await service.cancel(2);
    await service.cancelAll();
    expect(await service.requestPermission(), isA<bool>());
  });
}
