import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/features/team_dashboard/application/team_dashboard_models.dart';

/// Which column the table is sorted by. Order matches the columns
/// left-to-right in `team_dashboard_table.dart`.
enum TeamDashboardSortColumn {
  member,
  messagesSent,
  repliesReceived,
  replyRate,
  medianFirstResponseTime,
}

class TeamDashboardSort {
  const TeamDashboardSort({required this.column, required this.ascending});

  final TeamDashboardSortColumn column;
  final bool ascending;

  TeamDashboardSort toggled(TeamDashboardSortColumn tapped) {
    if (tapped != column) {
      // A newly-chosen numeric column starts high-to-low — "who sent the
      // most" is almost always the more useful first read than "who sent the
      // least"; the name column is the one exception, which is why it still
      // defaults to ascending (A→Z).
      return TeamDashboardSort(
        column: tapped,
        ascending: tapped == TeamDashboardSortColumn.member,
      );
    }
    return TeamDashboardSort(column: column, ascending: !ascending);
  }
}

/// Table sort state, local to this screen — a plain `Notifier` plus a pure
/// sort function, same split as `deal_filter_controller.dart`'s
/// `DealFilterNotifier`/`applyDealFilter`, so the ordering logic is testable
/// without pumping a widget tree.
class TeamDashboardSortNotifier extends Notifier<TeamDashboardSort> {
  @override
  TeamDashboardSort build() => const TeamDashboardSort(
        column: TeamDashboardSortColumn.member,
        ascending: true,
      );

  void toggle(TeamDashboardSortColumn column) => state = state.toggled(column);
}

final teamDashboardSortProvider =
    NotifierProvider<TeamDashboardSortNotifier, TeamDashboardSort>(
  TeamDashboardSortNotifier.new,
);

/// `null` (no data yet, e.g. an empty [TeamDashboardRow.replyRate] or
/// [TeamDashboardRow.medianFirstResponseTime]) always sorts last, in either
/// direction — a member with nothing to show should never land at the top of
/// a "highest reply rate" sort just because there's no number to compare.
List<TeamDashboardRow> sortTeamDashboardRows(
  List<TeamDashboardRow> rows,
  TeamDashboardSort sort,
) {
  final ascending = sort.ascending;

  int compare(TeamDashboardRow a, TeamDashboardRow b) {
    switch (sort.column) {
      case TeamDashboardSortColumn.member:
        final cmp = a.member.name.toLowerCase().compareTo(
              b.member.name.toLowerCase(),
            );
        return ascending ? cmp : -cmp;
      case TeamDashboardSortColumn.messagesSent:
        final cmp = a.messagesSent.compareTo(b.messagesSent);
        return ascending ? cmp : -cmp;
      case TeamDashboardSortColumn.repliesReceived:
        final cmp = a.repliesReceived.compareTo(b.repliesReceived);
        return ascending ? cmp : -cmp;
      case TeamDashboardSortColumn.replyRate:
        return _compareNullable(a.replyRate, b.replyRate, ascending);
      case TeamDashboardSortColumn.medianFirstResponseTime:
        return _compareNullable(
          a.medianFirstResponseTime?.inMicroseconds,
          b.medianFirstResponseTime?.inMicroseconds,
          ascending,
        );
    }
  }

  return [...rows]..sort(compare);
}

/// Null always sorts last, whichever direction [ascending] asks for — a
/// member with no reply rate or no timed response yet should never jump to
/// the top of the table just because "nothing" outranks "0%" when the sort
/// happens to be reversed.
int _compareNullable(Comparable? a, Comparable? b, bool ascending) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  final cmp = a.compareTo(b);
  return ascending ? cmp : -cmp;
}
