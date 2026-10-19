import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/time/display_time_zone_controller.dart';
import 'package:timezone/timezone.dart' as tz;

/// Turns stored UTC instants into wall-clock time in one fixed zone, and
/// reports "now" in that zone.
///
/// Every instant in this app is stored and transported in UTC. Nothing is
/// shown to a user without passing through here — usually via
/// `InstantFormatter`, which wraps one. Reach for [tzClockProvider] so the
/// zone tracks the Settings choice; construct directly only in tests.
class TzClock {
  const TzClock(this.location);

  final tz.Location location;

  /// The zone's IANA name, e.g. `"Africa/Cairo"`.
  String get zoneName => location.name;

  /// "Now", as wall-clock time in this zone.
  tz.TZDateTime nowInZone() => tz.TZDateTime.now(location);

  /// [instant] (UTC, or coerced to UTC) as wall-clock time in this zone.
  ///
  /// DST-safe: `TZDateTime.from` applies the offset in effect *at that
  /// instant*, so a timestamp recorded in July renders with summer time even
  /// when it is now winter, and vice versa.
  tz.TZDateTime toZone(DateTime instant) =>
      tz.TZDateTime.from(instant.isUtc ? instant : instant.toUtc(), location);
}

/// [TzClock] for the user's chosen display zone. Falls back to UTC whenever
/// the chosen name is not in the loaded database (or the database has not been
/// loaded, as in a widget test that skips `initTimeZoneDatabase()`).
final tzClockProvider = Provider<TzClock>((ref) {
  final name = ref.watch(displayTimeZoneProvider);
  try {
    return TzClock(tz.getLocation(name));
  } catch (_) {
    return TzClock(tz.UTC);
  }
});
