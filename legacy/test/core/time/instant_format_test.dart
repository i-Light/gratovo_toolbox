import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/time/tz_clock.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

void main() {
  setUpAll(() async {
    tzdata.initializeTimeZones();
    await initializeDateFormatting();
  });

  InstantFormatter formatter(String locale, String zone) => InstantFormatter(
        locale: locale,
        clock: TzClock(tz.getLocation(zone)),
      );

  test('renders the wall clock of the display zone, not UTC', () {
    final fmt = formatter('en', 'America/New_York');
    // 2026-01-15 02:00Z → 2026-01-14 21:00 EST.
    final instant = DateTime.utc(2026, 1, 15, 2);
    expect(fmt.time(instant), '21:00');
    expect(fmt.date(instant), contains('14'));
  });

  test('tracks daylight saving for a summer instant', () {
    final fmt = formatter('en', 'America/New_York');
    // 2026-07-15 02:00Z → 2026-07-14 22:00 EDT.
    expect(fmt.time(DateTime.utc(2026, 7, 15, 2)), '22:00');
  });

  test('localises to Arabic and applies the +05:30 wall clock for ar + Kolkata',
      () {
    final fmt = formatter('ar', 'Asia/Kolkata');
    // 2026-03-10 20:00Z → 2026-03-11 01:30 IST.
    final text = fmt.dateTime(DateTime.utc(2026, 3, 10, 20));
    expect(text, contains('01:30')); // shifted +5:30 from 20:00Z
    expect(text, contains('11')); // the day rolled forward to the 11th
    expect(text, contains('مارس')); // month name localised to Arabic
  });

  test('uploadLine returns the fallback for a null instant', () {
    final fmt = formatter('en', 'UTC');
    expect(fmt.uploadLine(null, unknown: 'date unknown'), 'date unknown');
  });

  test('uploadLine is weekday-led', () {
    final fmt = formatter('en', 'UTC');
    // 2026-08-14 is a Friday.
    expect(
      fmt.uploadLine(DateTime.utc(2026, 8, 14, 9, 5), unknown: '-'),
      startsWith('Fri'),
    );
  });

  test('daysUntil counts calendar days in the display zone', () {
    final fmt = formatter('en', 'Asia/Kolkata');
    final now = fmt.clock.nowInZone();
    final noonToday = tz.TZDateTime(
      tz.getLocation('Asia/Kolkata'),
      now.year,
      now.month,
      now.day,
      12,
    );

    expect(fmt.daysUntil(noonToday.toUtc()), 0);
    expect(fmt.daysUntil(noonToday.add(const Duration(days: 3)).toUtc()), 3);
    expect(
      fmt.daysUntil(noonToday.subtract(const Duration(days: 1)).toUtc()),
      -1,
    );
  });
}
