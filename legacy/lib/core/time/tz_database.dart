import 'dart:developer' as developer;

import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

/// One-time initialisation of the IANA timezone database.
///
/// Call from `main()` right after `WidgetsFlutterBinding.ensureInitialized()`
/// and before `runApp`. Everything downstream — [tzClockProvider], any
/// `tz.TZDateTime`, and (later) OS notification scheduling — assumes the
/// database is loaded and `tz.local` points at the device zone.
///
/// Both steps are guarded. Failing to load the embedded database would be a
/// packaging bug; failing to read the device zone is normal under
/// `flutter test` (no platform channel). Neither is allowed to stop the app
/// from starting — the fallback is UTC, which shows a wrong offset rather than
/// a blank screen.
Future<void> initTimeZoneDatabase() async {
  try {
    tzdata.initializeTimeZones();
  } catch (error, stackTrace) {
    developer.log(
      'Failed to load the IANA timezone database; timestamps render in UTC.',
      name: 'gratovo.time',
      level: 1000, // SEVERE — should never happen in a correct build.
      error: error,
      stackTrace: stackTrace,
    );
    return;
  }

  try {
    final name = await FlutterTimezone.getLocalTimezone();
    tz.setLocalLocation(tz.getLocation(name));
  } catch (error, stackTrace) {
    developer.log(
      'Could not resolve the device timezone; using UTC as tz.local.',
      name: 'gratovo.time',
      level: 900, // WARNING — expected under `flutter test`.
      error: error,
      stackTrace: stackTrace,
    );
    tz.setLocalLocation(tz.UTC);
  }
}
