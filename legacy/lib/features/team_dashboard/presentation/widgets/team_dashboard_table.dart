import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/features/team_dashboard/application/team_dashboard_models.dart';
import 'package:gratovo_toolbox/features/team_dashboard/application/team_dashboard_sort_controller.dart';
import 'package:gratovo_toolbox/features/team_dashboard/presentation/widgets/team_dashboard_duration.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:intl/intl.dart';

/// Everyone's row, sortable by tapping a column header — [DataTable]'s own
/// `sortColumnIndex`/`sortAscending`/`onSort`, backed by
/// [teamDashboardSortProvider] rather than local widget state so the choice
/// survives the table being rebuilt when the week changes.
class TeamDashboardTable extends ConsumerWidget {
  const TeamDashboardTable({required this.rows, super.key});

  final List<TeamDashboardRow> rows;

  static const _columns = TeamDashboardSortColumn.values;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final sort = ref.watch(teamDashboardSortProvider);
    final notifier = ref.read(teamDashboardSortProvider.notifier);
    final sorted = sortTeamDashboardRows(rows, sort);
    final percent = NumberFormat.percentPattern(l10n.localeName);

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        sortColumnIndex: _columns.indexOf(sort.column),
        sortAscending: sort.ascending,
        columns: [
          DataColumn(
            label: Text(l10n.teamDashboardColumnMember),
            onSort: (_, __) => notifier.toggle(TeamDashboardSortColumn.member),
          ),
          DataColumn(
            label: Text(l10n.teamDashboardColumnMessagesSent),
            numeric: true,
            onSort: (_, __) =>
                notifier.toggle(TeamDashboardSortColumn.messagesSent),
          ),
          DataColumn(
            label: Text(l10n.teamDashboardColumnRepliesReceived),
            numeric: true,
            onSort: (_, __) =>
                notifier.toggle(TeamDashboardSortColumn.repliesReceived),
          ),
          DataColumn(
            label: Text(l10n.teamDashboardColumnReplyRate),
            numeric: true,
            onSort: (_, __) =>
                notifier.toggle(TeamDashboardSortColumn.replyRate),
          ),
          DataColumn(
            label: Text(l10n.teamDashboardColumnMedianResponse),
            numeric: true,
            onSort: (_, __) => notifier
                .toggle(TeamDashboardSortColumn.medianFirstResponseTime),
          ),
        ],
        rows: [
          for (final row in sorted)
            DataRow(
              cells: [
                DataCell(Text(row.member.name)),
                DataCell(Text(formatCount(row.messagesSent))),
                DataCell(Text(formatCount(row.repliesReceived))),
                DataCell(Text(
                  row.replyRate == null
                      ? l10n.teamDashboardNoData
                      : percent.format(row.replyRate),
                )),
                DataCell(Text(
                  row.medianFirstResponseTime == null
                      ? l10n.teamDashboardNoData
                      : formatResponseDuration(
                          row.medianFirstResponseTime!,
                          l10n,
                        ),
                )),
              ],
            ),
        ],
      ),
    );
  }
}
