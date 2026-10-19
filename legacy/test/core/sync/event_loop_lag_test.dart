import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/sync/event_loop_lag.dart';

/// The sampler exists to answer one question in the sync log: was the server
/// slow, or was this process too busy to read the reply? So the two cases worth
/// pinning are an idle loop reporting nothing and a blocked loop reporting the
/// block — anything in between is a number, not a verdict.
void main() {
  group('EventLoopLagSampler', () {
    test('an idle loop measures almost no lag', () async {
      final sampler = EventLoopLagSampler.start(
        interval: const Duration(milliseconds: 10),
      );
      await Future<void>.delayed(const Duration(milliseconds: 200));
      sampler.stop();

      expect(sampler.samples, greaterThan(5),
          reason: 'a free loop should service the timer repeatedly');
      // Generous: test machines are shared and a garbage collection lands
      // where it likes. The finding this has to survive is 60,000 ms, so
      // anything under a tenth of a second is comfortably "nothing happened".
      expect(sampler.worst.inMilliseconds, lessThan(100));
    });

    test('a blocked loop is measured, not missed', () async {
      final sampler = EventLoopLagSampler.start(
        interval: const Duration(milliseconds: 10),
      );

      // Synchronous work, which is what the real culprit looks like: the
      // mirror shares its isolate with `package:sqlite3`, whose calls are
      // blocking FFI, so a screen running aggregates over a large local
      // database stops the socket being drained for as long as it runs.
      final until = DateTime.now().add(const Duration(milliseconds: 300));
      while (DateTime.now().isBefore(until)) {
        // Deliberately spinning.
      }

      await Future<void>.delayed(const Duration(milliseconds: 20));
      sampler.stop();

      expect(sampler.worst.inMilliseconds, greaterThan(200),
          reason: 'a 300 ms block must show up as a lag of that order');
    });

    test('an idle sampler is safe to stop and reports zero', () {
      final sampler = EventLoopLagSampler.idle()..stop();
      expect(sampler.worst, Duration.zero);
      expect(sampler.samples, 0);
    });
  });
}
