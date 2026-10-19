import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// `2d 4h`, `3h 12m`, `45m` — the smallest two units that matter at this
/// duration's scale. A median response measured in seconds never happens in
/// practice (nobody replies to a reply in under a minute), so seconds are
/// dropped entirely rather than adding a third tier nobody reads.
String formatResponseDuration(Duration duration, AppLocalizations l10n) {
  final totalMinutes = duration.inMinutes;
  final days = totalMinutes ~/ (24 * 60);
  final hours = (totalMinutes % (24 * 60)) ~/ 60;
  final minutes = totalMinutes % 60;

  if (days > 0) {
    return l10n.teamDashboardDurationDaysHours(days, hours);
  }
  if (hours > 0) {
    return l10n.teamDashboardDurationHoursMinutes(hours, minutes);
  }
  return l10n.teamDashboardDurationMinutes(minutes);
}
