import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_timezone/flutter_timezone.dart';

/// The device's own IANA timezone name (e.g. `"Africa/Cairo"`).
///
/// This is the *default* for the display zone, and the zone the OS
/// notification scheduler fires in — deliberately kept separate from
/// [displayTimeZoneProvider], which is what the user picked in Settings and
/// what every on-screen timestamp is rendered in.
///
/// `FlutterTimezone.getLocalTimezone()` goes through a platform channel, so
/// this throws a `MissingPluginException` under `flutter test`; the fallback
/// is `"UTC"`. Override this provider in tests that need a fixed device zone.
final deviceTimeZoneProvider = FutureProvider<String>((ref) async {
  try {
    return await FlutterTimezone.getLocalTimezone();
  } catch (_) {
    return 'UTC';
  }
});
