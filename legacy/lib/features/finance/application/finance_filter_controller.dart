import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/features/finance/application/finance_models.dart';

/// Which slice of the ledger the Finance table is currently narrowed to. A
/// plain `Notifier<FinanceFilter>` plus a pure filter function, same split as
/// `deal_filter_controller.dart`'s `DealFilterNotifier` — testable without
/// pumping a widget tree.
class FinanceFilterNotifier extends Notifier<FinanceFilter> {
  @override
  FinanceFilter build() => FinanceFilter.all;

  void setFilter(FinanceFilter filter) => state = filter;
}

final financeFilterProvider =
    NotifierProvider<FinanceFilterNotifier, FinanceFilter>(
  FinanceFilterNotifier.new,
);

/// Narrows [rows] to the ones matching [filter]. See [FinanceFilter]'s own
/// doc comment for what each case is for, and `finance_aggregator.dart` for
/// exactly what each [FinanceDealRow] flag means.
List<FinanceDealRow> applyFinanceFilter(
  List<FinanceDealRow> rows,
  FinanceFilter filter,
) {
  switch (filter) {
    case FinanceFilter.all:
      return rows;
    case FinanceFilter.invoiceUnpaid:
      return rows.where((r) => r.invoiceSent && !r.invoicePaid).toList();
    case FinanceFilter.invoiceOverdue:
      return rows.where((r) => r.invoiceOverdue).toList();
    case FinanceFilter.payoutDue:
      return rows.where((r) => r.payoutDue).toList();
    case FinanceFilter.payoutOverdue:
      return rows.where((r) => r.payoutOverdue).toList();
    case FinanceFilter.settled:
      return rows.where((r) => r.invoicePaid && r.payoutPaid).toList();
  }
}
