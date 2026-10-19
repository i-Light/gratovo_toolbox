import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/features/team_dashboard/application/team_dashboard_models.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The one part of the rollup that can't be split by person — see
/// [TeamDashboardDealSummary]'s doc comment for why. Shown as its own card,
/// separate from the sortable per-member table, with the reason spelled out
/// rather than left for someone to wonder why these two columns are missing
/// from the rows above.
class TeamDashboardDealsSummaryCard extends StatelessWidget {
  const TeamDashboardDealsSummaryCard({required this.deals, super.key});

  final TeamDashboardDealSummary deals;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.teamDashboardDealsSummaryTitle,
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 32,
              runSpacing: 12,
              children: [
                _Figure(
                  label: l10n.teamDashboardDealsClosedLabel,
                  value: formatCount(deals.dealsClosed),
                ),
                _Figure(
                  label: l10n.teamDashboardMarginClosedLabel,
                  value: formatCurrency(
                    deals.marginClosed,
                    locale: l10n.localeName,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              l10n.teamDashboardDealsCaveat,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        Text(value, style: theme.textTheme.headlineSmall),
      ],
    );
  }
}
