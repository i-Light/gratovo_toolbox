/// Formats a **calendar date** — a day on a wall calendar, with no time and no
/// zone attached to it.
///
/// This is not [InstantFormatter], and the difference is the whole reason it
/// exists. Everything that formatter handles is an *instant*: a moment that
/// happened, stored in UTC, which must be shifted into the display zone before
/// anybody reads it. A calendar date is not a moment. A video published on
/// 4 November was published on 4 November for every reader in the world, and
/// running it through a zone conversion would render it as the 3rd for anyone
/// west of UTC — the exact bug the timezone subsystem exists to prevent, just
/// in the opposite direction.
///
/// So: if the value came from a timestamp, it is an instant and belongs in
/// [InstantFormatter]. If it is a bare `YYYY-MM-DD` that was never a moment —
/// today only `EmailRecord.videoDate` — it belongs here.
///
/// Lives in `lib/core/time/` because that is where the timezone guard (see
/// `test/timezone_guard_test.dart`) allows [DateFormat] to be named at all,
/// and that guard is right: the seam should be one directory, not one class.
library;

import 'package:intl/intl.dart';

/// `4 Nov 2025`, in [locale].
///
/// [date]'s year, month and day are used as given. Any time component it
/// happens to carry is ignored rather than rendered, since a calendar date
/// does not have one.
String formatCalendarDate(DateTime date, String locale) =>
    DateFormat.yMMMd(locale).format(DateTime(date.year, date.month, date.day));

/// `4-April` — the month's number, then its name in [locale].
///
/// Built for the video-date spin field, where the number is the thing you
/// scroll to and the name is only there to confirm you landed on the right
/// month. [month] is 1-12; [DateFormat] normalises anything else. The year
/// passed in is a throwaway — only the month slot is read.
String formatMonthLabel(int month, String locale) =>
    '$month-${DateFormat.MMMM(locale).format(DateTime(2020, month))}';

/// `4-Fri` — the day of the month, then its weekday name in [locale].
///
/// The companion to [formatMonthLabel], for the day box of a spin picker. The
/// number is what you scroll to; the weekday is there so you find out you have
/// landed on a Saturday before you schedule something for it, not after.
///
/// Takes a whole date rather than a day number because a weekday cannot be
/// derived from one — it needs the month and year behind it.
String formatDayLabel(DateTime date, String locale) =>
    '${date.day}-${DateFormat.E(locale).format(date)}';

/// `9-Sep` — the month's number, then its short name in [locale].
///
/// [formatMonthLabel]'s narrow sibling, for a picker that sets the month
/// beside four other boxes and cannot spend `September` on it.
String formatShortMonthLabel(int month, String locale) =>
    '$month-${DateFormat.MMM(locale).format(DateTime(2020, month))}';
