import 'package:intl/intl.dart';

/// Number formatting used everywhere a count is shown.
///
/// The rule this project follows: **any number with more than three digits is
/// grouped with commas.** 999 stays 999; 1000 becomes 1,000. That threshold is
/// the reason this is a helper rather than a bare `NumberFormat` call — a plain
/// grouping format is identical for four digits and up, but we also want the
/// large-number shorthand (1.2M) available for the places where a full
/// subscriber count would blow out a narrow list column.
///
/// Formatting is locale-aware via `intl`, so the Arabic locale gets its own
/// digit grouping conventions for free rather than being hardcoded to commas.

/// `1234` -> `1,234`. `999` -> `999`. `null` -> [placeholder].
String formatCount(num? value, {String placeholder = '—', String? locale}) {
  if (value == null) return placeholder;
  return NumberFormat.decimalPattern(locale).format(value);
}

/// Compact form for tight spaces: `1234` -> `1.2K`, `2400000` -> `2.4M`.
/// Numbers under 1,000 are returned as-is, since "999" is already short.
String formatCompact(num? value, {String placeholder = '—', String? locale}) {
  if (value == null) return placeholder;
  if (value.abs() < 1000) return value.toString();
  // One decimal place, explicitly. `NumberFormat.compact`'s own default is
  // three significant digits, which renders 1234 as "1.23K" — a third digit of
  // precision that is noise on a subscriber count and, worse, makes the column
  // ragged, since 15000 still comes out as "15K". Capping the fraction gives
  // every value at most one decimal: 1.2K, 15K, 2.4M.
  return (NumberFormat.compact(locale: locale)..maximumFractionDigits = 1)
      .format(value);
}

/// A money amount with grouping and no trailing `.00` when it is a round
/// number — deal prices are usually whole, and "12,000" reads better than
/// "12,000.00" in a list.
String formatMoney(num? value, {String placeholder = '—', String? locale}) {
  if (value == null) return placeholder;
  final hasFraction = value % 1 != 0;
  return NumberFormat(hasFraction ? '#,##0.00' : '#,##0', locale).format(value);
}

/// [formatMoney] with the locale's currency symbol: `$12,000`, `12,000 ج.م`.
///
/// This exists rather than call sites using `NumberFormat.simpleCurrency`
/// directly, which is what they all used to do. `simpleCurrency` always shows
/// two decimal places, so every whole-number deal price rendered as
/// "$12,000.00" — four characters of noise on a figure that is round by
/// definition. The symbol is taken from `simpleCurrency` (so the locale still
/// decides it, and still decides whether it leads or trails) and re-applied to
/// [formatMoney]'s digits.
String formatCurrency(num? value, {String placeholder = '—', String? locale}) {
  if (value == null) return placeholder;
  final reference = NumberFormat.simpleCurrency(locale: locale);
  final digits = formatMoney(value, locale: locale);
  // Rebuild rather than string-replace the digits inside simpleCurrency's own
  // output: replacing would have to guess where the number ends, and gets it
  // wrong for any locale whose symbol contains digits or a decimal separator.
  final symbol = reference.currencySymbol;
  final symbolLeads = reference.format(0).indexOf(symbol) == 0;
  return symbolLeads ? '$symbol$digits' : '$digits $symbol';
}

/// A byte count as a human-readable size: `0 B`, `912 kB`, `3.4 MB`.
///
/// Decimal units (1000, not 1024), because this number is shown next to a
/// "delete saved pictures" button and the person reading it is comparing it
/// against what their file manager and their operating system's storage
/// settings say — and on every platform this app targets, those report decimal.
/// Being internally consistent with a definition nobody else on the machine
/// uses is not the kind of correctness worth having here.
String formatBytes(int bytes, {String? locale}) {
  if (bytes < 1000) return '$bytes B';
  const units = ['kB', 'MB', 'GB', 'TB'];
  var value = bytes / 1000;
  var unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  // One decimal below 10, none above: "3.4 MB" is useful precision, "342.7 MB"
  // is a digit nobody acts on.
  final digits = value < 10 ? 1 : 0;
  final formatted = (NumberFormat.decimalPattern(locale)
        ..maximumFractionDigits = digits)
      .format(value);
  return '$formatted ${units[unit]}';
}

extension NumberDisplay on num {
  /// Shorthand so call sites read `subscribers.grouped` instead of wrapping.
  String get grouped => formatCount(this);
  String get compact => formatCompact(this);
}
