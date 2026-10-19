import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:gratovo_toolbox/core/notifications/notification_service.dart';
import 'package:timezone/timezone.dart' as tz;

/// Real, platform-backed [NotificationService] (Outreach overhaul, Phase H).
///
/// One code path: `flutter_local_notifications` 19 routes `zonedSchedule` to
/// the Windows toast implementation itself when running on Windows (see
/// `FlutterLocalNotificationsPlugin.zonedSchedule`), so there is no
/// `Platform.isWindows` branch here — the settings objects just carry a
/// section for every platform this project ships.
///
/// **Best-effort by contract.** Every call is wrapped: a machine with no
/// plugin registered — the widget-test environment, or a platform without a
/// notification backend — turns each method into a silent no-op instead of a
/// thrown `MissingPluginException`. The reliable channel is always the in-app
/// due/overdue list (the Dashboard card and the Outreach thread chip); the OS
/// toast is a bonus that may not survive an app exit on an unpackaged Windows
/// build (no MSIX identity today — see the plan's open questions).
class LocalNotificationService implements NotificationService {
  LocalNotificationService();

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();

  bool _ready = false;

  /// A stable GUID for the Windows toast activator. Generated once for this
  /// app; it only has to stay constant across builds, not be secret.
  static const _windowsAumid = 'com.gratovo.toolbox';
  static const _windowsGuid = 'd91d4e9c-9b1f-4c1a-9d2e-2f7a6b5c4d3e';

  static const _androidChannelId = 'gratovo_follow_ups';
  static const _androidChannelName = 'Follow-up reminders';

  static const InitializationSettings _initSettings = InitializationSettings(
    android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    iOS: DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    ),
    windows: WindowsInitializationSettings(
      appName: 'Gratovo IMA ToolBox',
      appUserModelId: _windowsAumid,
      guid: _windowsGuid,
    ),
  );

  static const NotificationDetails _details = NotificationDetails(
    android: AndroidNotificationDetails(
      _androidChannelId,
      _androidChannelName,
      importance: Importance.defaultImportance,
      priority: Priority.defaultPriority,
    ),
    iOS: DarwinNotificationDetails(),
    windows: WindowsNotificationDetails(),
  );

  @override
  Future<void> init() async {
    if (_ready) return;
    try {
      await _plugin.initialize(_initSettings);
      _ready = true;
    } catch (error, stackTrace) {
      _log('init failed; notifications will be a no-op', error, stackTrace);
    }
  }

  @override
  Future<bool> requestPermission() async {
    await init();
    try {
      if (kIsWeb) return false;
      switch (defaultTargetPlatform) {
        case TargetPlatform.android:
          final granted = await _plugin
              .resolvePlatformSpecificImplementation<
                  AndroidFlutterLocalNotificationsPlugin>()
              ?.requestNotificationsPermission();
          return granted ?? false;
        case TargetPlatform.iOS:
          final granted = await _plugin
              .resolvePlatformSpecificImplementation<
                  IOSFlutterLocalNotificationsPlugin>()
              ?.requestPermissions(alert: true, badge: false, sound: true);
          return granted ?? false;
        case TargetPlatform.windows:
        case TargetPlatform.linux:
        case TargetPlatform.macOS:
        case TargetPlatform.fuchsia:
          // Windows toasts have no runtime prompt; the others aren't shipped.
          return true;
      }
    } catch (error, stackTrace) {
      _log('requestPermission failed', error, stackTrace);
      return false;
    }
  }

  @override
  Future<void> show({
    required int id,
    required String title,
    required String body,
    String? payload,
  }) async {
    await init();
    try {
      await _plugin.show(id, title, body, _details, payload: payload);
    } catch (error, stackTrace) {
      _log('show($id) failed', error, stackTrace);
    }
  }

  @override
  Future<void> schedule({
    required int id,
    required String title,
    required String body,
    required DateTime whenUtc,
    String? payload,
  }) async {
    final when = tz.TZDateTime.from(whenUtc.toUtc(), tz.local);
    if (!when.isAfter(tz.TZDateTime.now(tz.local))) return;
    await init();
    try {
      await _plugin.zonedSchedule(
        id,
        title,
        body,
        when,
        _details,
        androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
        payload: payload,
      );
    } catch (error, stackTrace) {
      _log('schedule($id) failed', error, stackTrace);
    }
  }

  @override
  Future<void> cancel(int id) async {
    try {
      await _plugin.cancel(id);
    } catch (error, stackTrace) {
      _log('cancel($id) failed', error, stackTrace);
    }
  }

  @override
  Future<void> cancelAll() async {
    try {
      await _plugin.cancelAll();
    } catch (error, stackTrace) {
      _log('cancelAll failed', error, stackTrace);
    }
  }

  void _log(String message, Object error, StackTrace stackTrace) {
    if (kDebugMode) {
      debugPrint('LocalNotificationService: $message — $error');
    }
  }
}
