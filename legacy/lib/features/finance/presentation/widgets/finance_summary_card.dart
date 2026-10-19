import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/features/finance/application/finance_models.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The four ledger-wide totals, shown as one row of stats above the
/// sortable/filterable table — same "stat row on a card" shape as
/// `team_dashboard_deals_summary.dart`'s `TeamDashboardDealsSummaryCard`.
class FinanceSummaryCard extends StatelessWidget {
  const FinanceSummaryCard({required this.totals, super.key});

  final FinanceTotals totals;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Wrap(
          spacing: 32,
          runSpacing: 12,
          children: [
            _Figure(
              label: l10n.financeSummaryBrandRevenue,
              value: formatCurrency(
                totals.totalBrandRevenue,
                locale: l10n.localeName,
              ),
            ),
            _Figure(
              label: l10n.financeSummaryMargin,
              value: formatCurrency(
                totals.totalMargin,
                locale: l10n.localeName,
              ),
              color: theme.colorScheme.primary,
            ),
            _Figure(
              label: l10n.financeSummaryOutstanding,
              value: formatCurrency(
                totals.totalOutstanding,
                locale: l10n.localeName,
              ),
            ),
            _Figure(
              label: l10n.financeSummaryOwedToCreators,
              value: formatCurrency(
                totals.totalOwedToCreators,
                locale: l10n.localeName,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({required this.label, required this.value, this.color});

  final String label;
  final String value;
  final Color? color;

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
        Text(
          value,
          style: theme.textTheme.headlineSmall?.copyWith(color: color),
        ),
      ],
    );
  }
}
