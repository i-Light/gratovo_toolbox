import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/time/device_time_zone.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/timezone.dart' as tz;

const _prefsKey = 'gratovo.display.timezone';

/// The IANA zone every user-facing timestamp is rendered in.
///
/// Starts at `"UTC"` and, right after first read, loads asynchronously: the
/// persisted choice if there is one, otherwise the device zone
/// ([deviceTimeZoneProvider]). Any name the `timezone` database does not
/// recognise — a stale preference, a hand-typed mistake, a Windows zone id —
/// resolves to `"UTC"` rather than throwing. Same load/save/swallow shape as
/// `LocaleNotifier` and `ThemeModeNotifier`.
///
/// Only affects display: instants are stored and transported in UTC
/// everywhere. Changing this does NOT reschedule OS notifications already
/// handed to the platform — those fire in the device zone (see
/// lib/core/notifications/).
class DisplayTimeZoneNotifier extends Notifier<String> {
  @override
  String build() {
    unawaited(_load());
    return 'UTC';
  }

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_prefsKey);
      final name = (saved != null && saved.isNotEmpty)
          ? saved
          : await ref.read(deviceTimeZoneProvider.future);
      state = _resolved(name);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to load the display timezone; keeping UTC.',
        name: 'gratovo.time',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  /// Sets and persists the display zone. Returns `false` and changes nothing
  /// if [name] is not a zone the loaded database knows.
  Future<bool> setZone(String name) async {
    if (_resolved(name) != name) return false;
    state = name;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefsKey, name);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to persist the display timezone "$name".',
        name: 'gratovo.time',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
    return true;
  }

  String _resolved(String name) {
    try {
      tz.getLocation(name);
      return name;
    } catch (_) {
      return 'UTC';
    }
  }
}

final displayTimeZoneProvider =
    NotifierProvider<DisplayTimeZoneNotifier, String>(
  DisplayTimeZoneNotifier.new,
);
