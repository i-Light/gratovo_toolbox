import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/features/finance/application/finance_models.dart';

/// Which column the Finance table is sorted by. Order matches the sortable
/// columns left-to-right in `finance_table.dart` (the leading "Deal" column
/// has no sort of its own, so it isn't a case here — same reasoning as
/// `team_dashboard_sort_controller.dart`'s `TeamDashboardSortColumn`).
enum FinanceSortColumn {
  brandPrice,
  margin,
  invoiceSentAt,
  invoicePaidAt,
  payoutDueAt,
  payoutPaidAt,
}

class FinanceSort {
  const FinanceSort({required this.column, required this.ascending});

  final FinanceSortColumn column;
  final bool ascending;

  FinanceSort toggled(FinanceSortColumn tapped) {
    if (tapped != column) {
      // Every Finance column is a money amount or a date; "biggest"/"most
      // recent" first is the more useful default read than the reverse, so a
      // newly-chosen column always starts high-to-low.
      return FinanceSort(column: tapped, ascending: false);
    }
    return FinanceSort(column: column, ascending: !ascending);
  }
}

/// Table sort state, local to this screen — same split as
/// `team_dashboard_sort_controller.dart`'s `TeamDashboardSortNotifier`: a
/// plain `Notifier` plus a pure sort function below.
class FinanceSortNotifier extends Notifier<FinanceSort> {
  @override
  FinanceSort build() => const FinanceSort(
        column: FinanceSortColumn.brandPrice,
        ascending: false,
      );

  void toggle(FinanceSortColumn column) => state = state.toggled(column);
}

final financeSortProvider =
    NotifierProvider<FinanceSortNotifier, FinanceSort>(FinanceSortNotifier.new);

/// `null` (a date field that was never set) always sorts last, in either
/// direction — a deal with no invoice-paid date yet should never land at the
/// top of a "most recently paid" sort just because there's no date to
/// compare.
List<FinanceDealRow> sortFinanceRows(
  List<FinanceDealRow> rows,
  FinanceSort sort,
) {
  final ascending = sort.ascending;

  int compare(FinanceDealRow a, FinanceDealRow b) {
    switch (sort.column) {
      case FinanceSortColumn.brandPrice:
        final cmp = a.deal.brandPrice.compareTo(b.deal.brandPrice);
        return ascending ? cmp : -cmp;
      case FinanceSortColumn.margin:
        final cmp = a.deal.margin.compareTo(b.deal.margin);
        return ascending ? cmp : -cmp;
      case FinanceSortColumn.invoiceSentAt:
        return _compareNullableDate(
          a.deal.brandInvoiceSentAt,
          b.deal.brandInvoiceSentAt,
          ascending,
        );
      case FinanceSortColumn.invoicePaidAt:
        return _compareNullableDate(
          a.deal.brandInvoicePaidAt,
          b.deal.brandInvoicePaidAt,
          ascending,
        );
      case FinanceSortColumn.payoutDueAt:
        return _compareNullableDate(
          a.deal.creatorPayoutDueAt,
          b.deal.creatorPayoutDueAt,
          ascending,
        );
      case FinanceSortColumn.payoutPaidAt:
        return _compareNullableDate(
          a.deal.creatorPayoutPaidAt,
          b.deal.creatorPayoutPaidAt,
          ascending,
        );
    }
  }

  return [...rows]..sort(compare);
}

int _compareNullableDate(DateTime? a, DateTime? b, bool ascending) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  final cmp = a.compareTo(b);
  return ascending ? cmp : -cmp;
}
