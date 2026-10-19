import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/sync/mirror_engine_io.dart';
import 'package:gratovo_toolbox/core/sync/mirror_network.dart';

void main() {
  group('mirrorRetryPageSize', () {
    // The failure this answers is not a slow pass, it is a stuck one: a table
    // whose first page never lands never advances its cursor, so every pass
    // after it asks for the identical doomed page and everything queued behind
    // it waits for a request that has already failed six times.
    test('each retry asks for a quarter of the last ask', () {
      expect(mirrorRetryPageSize(500), 125);
      expect(mirrorRetryPageSize(125), 31);
    });

    test('it stops shrinking rather than paging one row at a time', () {
      expect(mirrorRetryPageSize(31), kMirrorMinPageSize);
      expect(mirrorRetryPageSize(kMirrorMinPageSize), kMirrorMinPageSize);
      expect(mirrorRetryPageSize(1), kMirrorMinPageSize);
    });

    test(
        'a smaller page gets a smaller budget, so the ladder costs no more '
        'time than three attempts at full size', () {
      final full = mirrorTimeoutForRows(500) * 3;
      final ladder = mirrorTimeoutForRows(500) +
          mirrorTimeoutForRows(mirrorRetryPageSize(500)) +
          mirrorTimeoutForRows(mirrorRetryPageSize(mirrorRetryPageSize(500)));

      expect(ladder, lessThan(full));
    });
  });

  group('mirrorSyncDelay', () {
    // The bug this is here to stop coming back: a mirror whose only schedule
    // was its three-hourly tick treated a failure and a success identically.
    // One unlucky pass — a laptop whose network was not up yet when the app
    // launched — left Settings reading "Sync problem" and every list showing
    // launch-time rows until somebody restarted the app.
    test('a pass that worked waits the ordinary interval', () {
      expect(mirrorSyncDelay(0), const Duration(hours: 3));
    });

    test('the first failure is retried in well under a minute', () {
      expect(mirrorSyncDelay(1), const Duration(seconds: 30));
      expect(mirrorSyncDelay(1), lessThan(const Duration(minutes: 1)));
    });

    test('repeated failures back off, without ever giving up', () {
      final ladder = [for (var i = 1; i <= 6; i++) mirrorSyncDelay(i)];

      for (var i = 1; i < ladder.length; i++) {
        expect(ladder[i], greaterThanOrEqualTo(ladder[i - 1]),
            reason: 'the ladder must never step back down');
      }
      // Capped rather than growing without bound: a server that has been down
      // all morning is still asked twice an hour, so the mirror recovers on its
      // own the moment it comes back rather than waiting for a restart.
      expect(ladder.last, const Duration(minutes: 30));
      expect(ladder.last, lessThan(const Duration(hours: 3)));
    });
  });
}
