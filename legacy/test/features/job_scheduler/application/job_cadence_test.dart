import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/features/job_scheduler/application/job_cadence.dart';

void main() {
  group('nextRunAfter', () {
    final from = DateTime.utc(2026, 9, 19, 9);

    test('hourly adds one hour', () {
      expect(nextRunAfter(from, 'hourly'), DateTime.utc(2026, 9, 19, 10));
    });

    test('daily adds one day', () {
      expect(nextRunAfter(from, 'daily'), DateTime.utc(2026, 9, 20, 9));
    });

    test('weekly adds seven days', () {
      expect(nextRunAfter(from, 'weekly'), DateTime.utc(2026, 9, 26, 9));
    });

    test(
        'an unrecognised cadence falls back to daily rather than never '
        'running again', () {
      expect(nextRunAfter(from, 'fortnightly'), DateTime.utc(2026, 9, 20, 9));
    });
  });
}
