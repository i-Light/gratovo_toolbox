import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/time/display_time_zone_controller.dart';
import 'package:gratovo_toolbox/core/time/tz_clock.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

/// Overrides [DisplayTimeZoneNotifier.build] so the zone is fixed and the
/// async SharedPreferences load never runs.
class _StubZone extends DisplayTimeZoneNotifier {
  _StubZone(this._value);

  final String _value;

  @override
  String build() => _value;
}

void main() {
  setUpAll(tzdata.initializeTimeZones);

  group('TzClock.toZone', () {
    test('applies standard time for a winter instant in New York', () {
      final clock = TzClock(tz.getLocation('America/New_York'));
      // 2026-01-15 12:00Z — EST is UTC-5.
      final local = clock.toZone(DateTime.utc(2026, 1, 15, 12));
      expect(local.hour, 7);
      expect(local.day, 15);
      expect(local.timeZoneOffset, const Duration(hours: -5));
    });

    test('applies daylight time for a summer instant in New York', () {
      final clock = TzClock(tz.getLocation('America/New_York'));
      // 2026-07-15 12:00Z — EDT is UTC-4.
      final local = clock.toZone(DateTime.utc(2026, 7, 15, 12));
      expect(local.hour, 8);
      expect(local.timeZoneOffset, const Duration(hours: -4));
    });

    test('handles the half-hour offset of Asia/Kolkata', () {
      final clock = TzClock(tz.getLocation('Asia/Kolkata'));
      final local = clock.toZone(DateTime.utc(2026, 6, 1, 0));
      expect(local.hour, 5);
      expect(local.minute, 30);
      expect(local.day, 1);
    });

    test('handles the 45-minute offset of Pacific/Chatham', () {
      final clock = TzClock(tz.getLocation('Pacific/Chatham'));
      // 2026-07-01 00:00Z — southern-hemisphere winter, so standard
      // time: UTC+12:45.
      final local = clock.toZone(DateTime.utc(2026, 7, 1, 0));
      expect(local.hour, 12);
      expect(local.minute, 45);
      expect(local.timeZoneOffset, const Duration(hours: 12, minutes: 45));
    });

    test('coerces a naive (non-UTC) DateTime instead of throwing', () {
      final clock = TzClock(tz.getLocation('Asia/Kolkata'));
      final local = clock.toZone(DateTime(2026, 6, 1, 0)); // not .utc
      expect(local.location.name, 'Asia/Kolkata');
    });

    test('an instant at the spring-forward boundary normalises cleanly', () {
      final clock = TzClock(tz.getLocation('America/New_York'));
      // US DST 2026 begins 02:00 local on 8 March → 07:00Z. 07:30Z is
      // 03:30 EDT; the 02:30 wall time that never happened is not
      // reachable this way, so conversion is always well-defined.
      expect(
        () => clock.toZone(DateTime.utc(2026, 3, 8, 7, 30)),
        returnsNormally,
      );
      final local = clock.toZone(DateTime.utc(2026, 3, 8, 7, 30));
      expect(local.hour, 3);
      expect(local.minute, 30);
      expect(local.timeZoneOffset, const Duration(hours: -4));
    });
  });

  group('tzClockProvider', () {
    test('builds a clock for the display zone', () {
      final container = ProviderContainer(
        overrides: [
          displayTimeZoneProvider.overrideWith(() => _StubZone('Asia/Kolkata')),
        ],
      );
      addTearDown(container.dispose);

      expect(container.read(tzClockProvider).location.name, 'Asia/Kolkata');
    });

    test('falls back to UTC when the display zone is unknown', () {
      final container = ProviderContainer(
        overrides: [
          displayTimeZoneProvider.overrideWith(() => _StubZone('Mars/Olympus')),
        ],
      );
      addTearDown(container.dispose);

      expect(container.read(tzClockProvider).location.name, 'UTC');
    });
  });
}
