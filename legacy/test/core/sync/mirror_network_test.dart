import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/sync/mirror_network.dart';
import 'package:gratovo_toolbox/core/sync/sync_diagnostics.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;

void main() {
  group('mirrorTimeoutForRows', () {
    // The bug this whole group exists for: every request shared one flat
    // 45-second deadline, so a page of 500 channel rows — by far the biggest
    // thing the app ever downloads — was given the same budget as a one-row
    // lookup. Settings read "TimeoutException after 0:00:45 … while trying to
    // download channels" over and over on connections that were working fine,
    // just not fast enough to move a megabyte in 45 seconds.
    test('a big page gets more time than a small one', () {
      expect(
        mirrorTimeoutForRows(500),
        greaterThan(mirrorTimeoutForRows(25)),
      );
    });

    test('a full page gets meaningfully longer than the old flat budget', () {
      expect(mirrorTimeoutForRows(500), greaterThan(kMirrorRequestTimeout));
    });

    test('a one-row probe is not made to wait two minutes', () {
      expect(mirrorTimeoutForRows(1), lessThan(const Duration(seconds: 30)));
    });

    // "Wait as long as it takes" is how the spinner that never stops came
    // back. Every budget has to end.
    test('the budget is capped however many rows are asked for', () {
      expect(mirrorTimeoutForRows(100000), const Duration(seconds: 60));
    });
  });

  group('MirrorDeadline', () {
    // The bound whose absence was the reported bug. Individual requests always
    // had deadlines; the pass did not, so their budgets multiplied — three
    // attempts a page, several pages a table, seven tables a pass — and a
    // machine that was going to fail took nearly half an hour to say so.
    test('a fresh deadline has room to work', () {
      final clock = MirrorDeadline(const Duration(seconds: 30));
      expect(clock.hasRoomFor(const Duration(seconds: 10)), isTrue);
      expect(clock.remaining, greaterThan(const Duration(seconds: 25)));
    });

    test('an exhausted deadline has none, and never goes negative', () {
      final clock = MirrorDeadline(Duration.zero);
      expect(clock.hasRoomFor(const Duration(seconds: 1)), isFalse);
      expect(clock.remaining, Duration.zero);
    });

    test('a request cannot be given longer than the pass has left', () {
      final clock = MirrorDeadline(const Duration(seconds: 5));
      expect(
        clock.clamp(const Duration(seconds: 60)),
        lessThanOrEqualTo(const Duration(seconds: 5)),
      );
    });

    test('a request well inside the budget keeps its own', () {
      final clock = MirrorDeadline(const Duration(minutes: 2));
      expect(clock.clamp(const Duration(seconds: 20)),
          const Duration(seconds: 20));
    });

    // The reserve exists because the arithmetic worked out exactly wrong: two
    // 60-second page attempts fit a 120-second pass to the millisecond, so
    // every failure reached the probes with `passLeftMs=0` and skipped them.
    // The diagnostic was unreachable in the one failure it was built for.
    test('a request may not spend the reserve', () {
      final clock = MirrorDeadline(const Duration(seconds: 120));
      expect(
        clock.clampLeaving(
          const Duration(seconds: 100),
          const Duration(seconds: 50),
        ),
        lessThanOrEqualTo(const Duration(seconds: 70)),
      );
    });

    test('a request that fits alongside the reserve keeps its own budget', () {
      final clock = MirrorDeadline(const Duration(seconds: 120));
      expect(
        clock.clampLeaving(
          const Duration(seconds: 60),
          const Duration(seconds: 50),
        ),
        const Duration(seconds: 60),
      );
    });

    // Past the reserve, a short request still beats a zero-length one: it can
    // at least fail informatively, where a zero budget reports a deadline that
    // was already known before the request was composed.
    test('a pass already inside its reserve still gets a usable budget', () {
      final clock = MirrorDeadline(const Duration(seconds: 10));
      final budget = clock.clampLeaving(
        const Duration(seconds: 60),
        const Duration(seconds: 50),
      );
      expect(budget, greaterThan(Duration.zero));
      expect(budget, lessThanOrEqualTo(const Duration(seconds: 10)));
    });

    // Whether there is "room" has to account for the wait before the retry as
    // well as the retry, or the pass schedules a delay it cannot afford and
    // wakes up already over budget.
    test('an unbounded deadline is for callers that bound themselves', () {
      expect(MirrorDeadline.unbounded().hasRoomFor(const Duration(hours: 1)),
          isTrue);
    });
  });

  group('isTransientMirrorFailure', () {
    test('a timeout is worth trying again', () {
      expect(
        isTransientMirrorFailure(
            TimeoutException('slow', const Duration(seconds: 45))),
        isTrue,
      );
    });

    test('a server error is worth trying again', () {
      expect(
        isTransientMirrorFailure(
          const PostgrestException(message: 'upstream', code: '503'),
        ),
        isTrue,
      );
    });

    test('a statement timeout is the query giving up, not the request', () {
      expect(
        isTransientMirrorFailure(
          const PostgrestException(
              message: 'canceling statement', code: '57014'),
        ),
        isTrue,
      );
    });

    test('a lock timeout is a writer we collided with, gone by the next try',
        () {
      // `set_archive_due` runs its one-row UPDATE under a 2s lock_timeout, so a
      // contended write comes back as 55P03 instead of burning the full
      // statement timeout. It must retry, not be reported as final — the lock
      // holder is a sweep or a bulk clean that will have finished by then.
      expect(
        isTransientMirrorFailure(
          const PostgrestException(
              message: 'canceling statement due to lock timeout',
              code: '55P03'),
        ),
        isTrue,
      );
    });

    // The other half of the policy, and the one that protects the queue: a
    // write the server has already judged must be reported, not retried. See
    // MirrorUploader's header on why a jammed queue is worse than a lost edit.
    test('a permissions refusal is final', () {
      expect(
        isTransientMirrorFailure(
          const PostgrestException(message: 'denied', code: '42501'),
        ),
        isFalse,
      );
    });

    test('a constraint violation is final', () {
      expect(
        isTransientMirrorFailure(
          const PostgrestException(message: 'duplicate', code: '23505'),
        ),
        isFalse,
      );
    });

    test('an ordinary bug is not retried', () {
      expect(isTransientMirrorFailure(StateError('bad')), isFalse);
    });
  });

  group('runMirrorRequest', () {
    test('a blip on the first attempt is invisible to the caller', () async {
      var calls = 0;
      final result = await runMirrorRequest<String>(
        what: 'read something',
        event: 'test',
        call: () async {
          calls++;
          if (calls == 1) {
            throw TimeoutException('nope', const Duration(seconds: 1));
          }
          return 'ok';
        },
      );

      expect(result, 'ok');
      expect(calls, 2);
    });

    test('a refusal is reported at once rather than retried', () async {
      var calls = 0;
      await expectLater(
        runMirrorRequest<String>(
          what: 'write something',
          event: 'test',
          call: () async {
            calls++;
            throw const PostgrestException(message: 'denied', code: '42501');
          },
        ),
        throwsA(isA<PostgrestException>()),
      );

      expect(calls, 1, reason: 'a refusal will be refused again');
    });

    test('every attempt is written down, successes included', () async {
      final log = SyncDiagnostics(memoryLimit: 20);
      var calls = 0;
      await runMirrorRequest<String>(
        what: 'read something',
        event: 'test.read',
        log: log,
        call: () async {
          calls++;
          if (calls == 1) {
            throw TimeoutException('nope', const Duration(seconds: 1));
          }
          return 'ok';
        },
      );

      final events = [for (final entry in log.entries) entry.event];
      expect(events, contains('test.read.failed'));
      expect(events, contains('test.read'));
      // The healthy line carries the timing, which is the whole point: a
      // timeout means nothing without the attempts around it to compare to.
      final success = log.entries.firstWhere((e) => e.event == 'test.read');
      expect(success.fields, contains('elapsedMs'));
      expect(success.fields['attempt'], 2);
    });
  });
}
