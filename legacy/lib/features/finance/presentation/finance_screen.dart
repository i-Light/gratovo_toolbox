import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/features/finance/application/finance_filter_controller.dart';
import 'package:gratovo_toolbox/features/finance/application/finance_stats_provider.dart';
import 'package:gratovo_toolbox/features/finance/presentation/widgets/finance_filter_bar.dart';
import 'package:gratovo_toolbox/features/finance/presentation/widgets/finance_summary_card.dart';
import 'package:gratovo_toolbox/features/finance/presentation/widgets/finance_table.dart';
import 'package:gratovo_toolbox/features/team_dashboard/application/team_dashboard_stats_provider.dart';
import 'package:gratovo_toolbox/features/team_dashboard/presentation/widgets/team_dashboard_deals_summary.dart';
import 'package:gratovo_toolbox/features/team_dashboard/presentation/widgets/team_dashboard_table.dart';
import 'package:gratovo_toolbox/features/team_dashboard/presentation/widgets/team_dashboard_week_picker.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The broker's manual payment ledger — did the brand pay us, did we pay the
/// creator, and what does that add up to. Nothing here is automated: every
/// figure is a rollup over the same manually-entered timestamps the Payment
/// section on each deal's detail screen writes (`payment_section.dart`); see
/// `deal.dart`'s doc comments on those fields for the "Path A" design this
/// follows (nobody's bank feed is wired up).
///
/// Carries the team performance rollup (`team_dashboard_*`) as its top
/// section rather than as a page of its own — both are "how the team is
/// doing" reading, and a separate rail slot for each was one destination too
/// many. The two sections are otherwise independent: their own async state,
/// their own week/filter controls, nothing shared but the scroll view.
///
/// Self-contained by design: this screen is not wired into `app_router.dart`
/// or `app_shell.dart`'s nav rail (both owned centrally) — see this
/// feature's PR description for the route and nav-rail snippet to add.
class FinanceScreen extends ConsumerWidget {
  const FinanceScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final statsAsync = ref.watch(financeStatsProvider);
    final filter = ref.watch(financeFilterProvider);
    final teamWeekStart = ref.watch(selectedTeamDashboardWeekProvider);
    final teamStatsAsync = ref.watch(teamDashboardStatsProvider(teamWeekStart));

    return Scaffold(
      appBar: AppBar(title: Text(l10n.financeTitle)),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l10n.teamDashboardTitle,
                    style: theme.textTheme.titleLarge),
                const SizedBox(height: 8),
                const TeamDashboardWeekPicker(),
                const SizedBox(height: 12),
                teamStatsAsync.when(
                  loading: () => const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                  error: (error, stackTrace) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Text(l10n.teamDashboardLoadError),
                  ),
                  data: (stats) => Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      TeamDashboardDealsSummaryCard(deals: stats.deals),
                      const SizedBox(height: 16),
                      if (stats.rows.isEmpty)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          child: Text(
                            l10n.teamDashboardEmptyState,
                            style: theme.textTheme.bodyMedium,
                          ),
                        )
                      else ...[
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Tooltip(
                              message: l10n.teamDashboardAttributionNote,
                              child: Icon(
                                Icons.info_outline,
                                size: 16,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Card(
                          clipBehavior: Clip.antiAlias,
                          child: TeamDashboardTable(rows: stats.rows),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                const Divider(),
                const SizedBox(height: 16),
                statsAsync.when(
                  loading: () => const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                  error: (error, stackTrace) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(l10n.financeLoadError),
                        TextButton(
                          onPressed: () => ref.invalidate(financeStatsProvider),
                          child: Text(l10n.commonRetry),
                        ),
                      ],
                    ),
                  ),
                  data: (stats) {
                    final visible = applyFinanceFilter(stats.rows, filter);
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        FinanceSummaryCard(totals: stats.totals),
                        const SizedBox(height: 16),
                        FinanceFilterBar(selected: filter),
                        const SizedBox(height: 12),
                        visible.isEmpty
                            ? Padding(
                                padding:
                                    const EdgeInsets.symmetric(vertical: 16),
                                child: Text(l10n.financeEmptyState),
                              )
                            : Card(
                                clipBehavior: Clip.antiAlias,
                                child: FinanceTable(rows: visible),
                              ),
                      ],
                    );
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
