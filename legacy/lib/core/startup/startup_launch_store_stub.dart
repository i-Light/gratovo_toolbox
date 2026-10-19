/// Web build of the startup toggle: there's no OS-level "launch at login"
/// in a browser, so this stays unavailable rather than importing anything
/// that would break a web compile.
class StartupLaunchStore {
  StartupLaunchStore._();

  static bool get isAvailable => false;
  static void setup({required String appName, required String appPath}) {}
  static Future<bool> isEnabled() async => false;
  static Future<bool> enable() async => false;
  static Future<bool> disable() async => false;
}
