import 'dart:async';

/// How late the event loop is running, sampled while something else is awaited.
///
/// The measurement that was missing when the mirror spent five sessions timing
/// out on a single page. Everything outside the app measured fast — the query
/// plans in 5 ms, and the byte-for-byte identical request returns 240 kB in
/// 0.4 s from both a Python client and the app's own Dart client run from a
/// test. Inside the running app the same small horizon request took 1.9 s
/// instead of 130 ms, and the page never finished at all.
///
/// A request cannot be slower than the wire it travels on unless the process
/// asking is too busy to read the reply. Dart does socket I/O on the isolate
/// that runs everything else, and `package:sqlite3` is synchronous FFI, so a
/// screen running aggregates over a large local database does not merely feel
/// slow — it stops the socket being drained. A small response arrives in one
/// chunk and survives; a 240 kB response arrives in many, each waiting its turn
/// behind whatever else the loop is doing, and a minute is not enough.
///
/// That failure is indistinguishable, from inside `MirrorPuller`, from a server
/// that never answered — which is exactly what the log said, for days. So the
/// puller now samples the loop while it waits, and a timeout carries the answer
/// with it: a page that failed with `loopLagMaxMs=41000` was starved by this
/// process, and a page that failed with `loopLagMaxMs=6` was not.
///
/// Deliberately cheap. One periodic timer, an integer compare per tick, no
/// allocation per sample — this runs during every page of every pass, including
/// the healthy ones, because a healthy baseline is what makes the unhealthy
/// number mean anything.
class EventLoopLagSampler {
  EventLoopLagSampler._(this._interval, this._timer);

  /// Starts sampling immediately.
  ///
  /// [interval] is a compromise: short enough that a two-second stall is
  /// several samples rather than a rounding error, long enough that sampling
  /// for a minute costs a few hundred timer callbacks and nothing else.
  factory EventLoopLagSampler.start({
    Duration interval = const Duration(milliseconds: 200),
  }) {
    late final EventLoopLagSampler sampler;
    var last = DateTime.now();
    final timer = Timer.periodic(interval, (_) {
      final now = DateTime.now();
      // Lateness, not elapsed time: a tick that arrives exactly on schedule
      // contributes zero, so the number reads as "how long was the loop
      // unavailable" rather than "how long did we sample for".
      final late = now.difference(last) - interval;
      if (late > sampler._worst) sampler._worst = late;
      sampler._samples++;
      last = now;
    });
    sampler = EventLoopLagSampler._(interval, timer);
    return sampler;
  }

  /// A sampler that measures nothing, for tests and for callers that have
  /// already stopped. Keeps call sites free of null checks.
  factory EventLoopLagSampler.idle() =>
      EventLoopLagSampler._(Duration.zero, null);

  // ignore: unused_field -- kept for readability at the construction site
  final Duration _interval;
  final Timer? _timer;

  Duration _worst = Duration.zero;
  int _samples = 0;

  /// The longest the loop went without servicing the sampling timer.
  Duration get worst => _worst;

  /// How many ticks were taken. A request that timed out after a minute with
  /// only a handful of samples was itself starved, which is the finding.
  int get samples => _samples;

  void stop() => _timer?.cancel();
}
