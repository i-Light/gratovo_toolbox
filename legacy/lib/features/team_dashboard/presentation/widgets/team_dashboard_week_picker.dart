import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/features/team_dashboard/application/team_dashboard_aggregator.dart';
import 'package:gratovo_toolbox/features/team_dashboard/application/team_dashboard_stats_provider.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Previous/next arrows plus the week's date range, and a "this week" button
/// that only appears once the picker has moved away from the current week —
/// mirrors the disclosure pattern `InstantFormatter.daysUntil` callers use
/// elsewhere (show the shortcut only when it would do something).
class TeamDashboardWeekPicker extends ConsumerWidget {
  const TeamDashboardWeekPicker({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final weekStart = ref.watch(selectedTeamDashboardWeekProvider);
    final weekEnd = weekStart.add(const Duration(days: 6));
    final notifier = ref.read(selectedTeamDashboardWeekProvider.notifier);
    final isCurrentWeek = weekStart == startOfWeek(DateTime.now().toUtc());

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          tooltip: l10n.teamDashboardPreviousWeek,
          icon: const Icon(Icons.chevron_left),
          onPressed: notifier.goToPreviousWeek,
        ),
        Text(
          l10n.teamDashboardWeekRange(fmt.date(weekStart), fmt.date(weekEnd)),
          style: Theme.of(context).textTheme.titleMedium,
        ),
        IconButton(
          tooltip: l10n.teamDashboardNextWeek,
          icon: const Icon(Icons.chevron_right),
          onPressed: notifier.goToNextWeek,
        ),
        if (!isCurrentWeek) ...[
          const SizedBox(width: 8),
          TextButton(
            onPressed: notifier.goToCurrentWeek,
            child: Text(l10n.teamDashboardThisWeek),
          ),
        ],
      ],
    );
  }
}
