import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/localization/locale_provider.dart';
import 'package:gratovo_toolbox/core/time/tz_clock.dart';
import 'package:intl/intl.dart';

/// The one place a raw [DateTime] becomes a string a user reads.
///
/// Holds a locale and a [TzClock]. Every method shifts the instant into the
/// display zone first, then formats it with a locale-aware [DateFormat] — so
/// an Arabic UI gets Arabic-Indic digits and a `+05:30` zone gets the shifted
/// wall clock. In a `ConsumerWidget`, `ref.watch(instantFormatterProvider)`;
/// a plain `StatelessWidget` should be handed the finished strings by its
/// Consumer parent (the existing idiom in this codebase).
class InstantFormatter {
  const InstantFormatter({required this.locale, required this.clock});

  final String locale;
  final TzClock clock;

  /// `14 Aug 2026`
  String date(DateTime instant) =>
      DateFormat.yMMMd(locale).format(clock.toZone(instant));

  /// `14 Aug 2026, 21:40`
  String dateTime(DateTime instant) =>
      DateFormat('d MMM yyyy, HH:mm', locale).format(clock.toZone(instant));

  /// `8:25 AM, 14-8-26`
  String dateTime12(DateTime instant) =>
      DateFormat('h:mm a, dd-M-yy', locale).format(clock.toZone(instant));

  /// `21:40`
  String time(DateTime instant) =>
      DateFormat.Hm(locale).format(clock.toZone(instant));

  /// `Thu 14, 21:40` — the weekday-led form the Outreach compose reference
  /// uses for recent-upload times. [unknown] is returned verbatim when
  /// [instant] is null (an upload with no known publish date).
  ///
  /// Weekday, day number and clock time, and nothing else. The month and year
  /// were dropped when the reference became a single scrolling row: what it is
  /// read for is which day of the week and what time of day this channel
  /// publishes, and the row it lives in is ordered newest-first, so the year
  /// was only ever taking up space that the next upload could use.
  String uploadLine(DateTime? instant, {required String unknown}) {
    if (instant == null) return unknown;
    return DateFormat('EEE d, HH:mm', locale).format(clock.toZone(instant));
  }

  /// [instant] in the display zone, with an explicit ICU [skeleton] pattern.
  String pattern(DateTime instant, String skeleton) =>
      DateFormat(skeleton, locale).format(clock.toZone(instant));

  /// Whole calendar days from now until [instant] in the display zone: `0`
  /// today, `1` tomorrow, negative in the past. Counts date boundaries
  /// crossed, not 24-hour spans — which is what "due tomorrow" means to a
  /// reader.
  int daysUntil(DateTime instant) {
    final now = clock.nowInZone();
    final then = clock.toZone(instant);
    final today = DateTime(now.year, now.month, now.day);
    final target = DateTime(then.year, then.month, then.day);
    return target.difference(today).inDays;
  }
}

final instantFormatterProvider = Provider<InstantFormatter>((ref) {
  final locale = ref.watch(localeProvider);
  final clock = ref.watch(tzClockProvider);
  return InstantFormatter(locale: locale.languageCode, clock: clock);
});
