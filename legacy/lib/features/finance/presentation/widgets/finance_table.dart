import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/finance/application/finance_models.dart';
import 'package:gratovo_toolbox/features/finance/application/finance_sort_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// Every deal's payment status at a glance, sortable by tapping a column
/// header — [DataTable]'s own `sortColumnIndex`/`sortAscending`/`onSort`,
/// backed by [financeSortProvider], same pattern as
/// `team_dashboard_table.dart`'s `TeamDashboardTable`. Tapping a row opens
/// that deal (`/deals/:id`), same as `deal_list_tile.dart`.
class FinanceTable extends ConsumerWidget {
  const FinanceTable({required this.rows, super.key});

  final List<FinanceDealRow> rows;

  /// The sortable columns, in table order. The leading "Deal" column has no
  /// sort of its own and so isn't part of this list — see
  /// `finance_sort_controller.dart`'s doc comment.
  static const _columns = FinanceSortColumn.values;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final sort = ref.watch(financeSortProvider);
    final notifier = ref.read(financeSortProvider.notifier);
    final sorted = sortFinanceRows(rows, sort);

    String? dateOrNull(DateTime? value) =>
        value == null ? null : fmt.date(value);

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        showCheckboxColumn: false,
        // +1: the leading "Deal" column isn't in [_columns] (see its doc
        // comment), so every sortable column's index in the table is one
        // past its index in [_columns].
        sortColumnIndex: _columns.indexOf(sort.column) + 1,
        sortAscending: sort.ascending,
        columns: [
          DataColumn(label: Text(l10n.financeColumnDeal)),
          DataColumn(
            label: Text(l10n.financeColumnBrandPrice),
            numeric: true,
            onSort: (_, __) => notifier.toggle(FinanceSortColumn.brandPrice),
          ),
          DataColumn(
            label: Text(l10n.financeColumnMargin),
            numeric: true,
            onSort: (_, __) => notifier.toggle(FinanceSortColumn.margin),
          ),
          DataColumn(
            label: Text(l10n.financeColumnInvoiceSent),
            onSort: (_, __) => notifier.toggle(FinanceSortColumn.invoiceSentAt),
          ),
          DataColumn(
            label: Text(l10n.financeColumnInvoicePaid),
            onSort: (_, __) => notifier.toggle(FinanceSortColumn.invoicePaidAt),
          ),
          DataColumn(
            label: Text(l10n.financeColumnPayoutDue),
            onSort: (_, __) => notifier.toggle(FinanceSortColumn.payoutDueAt),
          ),
          DataColumn(
            label: Text(l10n.financeColumnPayoutPaid),
            onSort: (_, __) => notifier.toggle(FinanceSortColumn.payoutPaidAt),
          ),
        ],
        rows: [
          for (final row in sorted)
            DataRow(
              onSelectChanged: (_) =>
                  context.go(AppRoutes.dealDetail(row.deal.id)),
              cells: [
                DataCell(_DealCell(deal: row.deal)),
                DataCell(Text(
                  formatCurrency(row.deal.brandPrice, locale: l10n.localeName),
                )),
                DataCell(Text(
                  formatCurrency(row.deal.margin, locale: l10n.localeName),
                )),
                DataCell(_StatusCell(
                  isSet: row.invoiceSent,
                  label: dateOrNull(row.deal.brandInvoiceSentAt) ??
                      l10n.financeNotSet,
                )),
                DataCell(_StatusCell(
                  isSet: row.invoicePaid,
                  label: dateOrNull(row.deal.brandInvoicePaidAt) ??
                      l10n.financeNotSet,
                  isWarning: row.invoiceOverdue,
                )),
                DataCell(_StatusCell(
                  isSet: row.deal.creatorPayoutDueAt != null,
                  label: dateOrNull(row.deal.creatorPayoutDueAt) ??
                      l10n.financeNotSet,
                  isWarning: row.payoutOverdue,
                )),
                DataCell(_StatusCell(
                  isSet: row.payoutPaid,
                  label: dateOrNull(row.deal.creatorPayoutPaidAt) ??
                      l10n.financeNotSet,
                )),
              ],
            ),
        ],
      ),
    );
  }
}

/// Brand × influencer, resolved independently of the row's own build so one
/// slow lookup never blocks the rest of the table — same reasoning as
/// `deal_list_tile.dart`'s `DealListTile`.
class _DealCell extends ConsumerWidget {
  const _DealCell({required this.deal});

  final Deal deal;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final brandAsync = ref.watch(brandByIdProvider(deal.brandId));
    final influencerAsync =
        ref.watch(influencerByIdProvider(deal.influencerId));

    final brandName = brandAsync.maybeWhen(
      data: (brand) => brand?.name ?? deal.brandId,
      orElse: () => deal.brandId,
    );
    final influencerHandle = influencerAsync.maybeWhen(
      data: (influencer) => influencer?.handle ?? deal.influencerId,
      orElse: () => deal.influencerId,
    );

    return Text('$brandName × $influencerHandle');
  }
}

/// A ✓/✗-at-a-glance cell: a filled check when [isSet], an outline circle
/// when not, and the date (or a placeholder) beside it. [isWarning] tints
/// both red — used for an invoice or payout that's overdue, so a scan down
/// the column catches it without reading every date.
class _StatusCell extends StatelessWidget {
  const _StatusCell({
    required this.isSet,
    required this.label,
    this.isWarning = false,
  });

  final bool isSet;
  final String label;
  final bool isWarning;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = isWarning
        ? theme.colorScheme.error
        : (isSet
            ? theme.colorScheme.primary
            : theme.colorScheme.onSurfaceVariant);

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          isSet ? Icons.check_circle : Icons.radio_button_unchecked,
          size: 16,
          color: color,
        ),
        const SizedBox(width: 6),
        Text(
          label,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: isWarning ? color : null,
            fontWeight: isWarning ? FontWeight.w600 : null,
          ),
        ),
      ],
    );
  }
}
