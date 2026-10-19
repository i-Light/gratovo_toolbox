import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/features/finance/application/finance_models.dart';

/// How long after [Deal.brandInvoiceSentAt] an unpaid invoice counts as
/// "overdue" for [FinanceDealRow.invoiceOverdue] and the
/// [FinanceFilter.invoiceOverdue] filter. [Deal] has no per-invoice due date
/// of its own (see `deal.dart`'s doc comment on the manual-ledger design), so
/// this is a single broker-wide net-30 stand-in rather than a real term —
/// flagged here as the one figure in this file that's a judgment call, not a
/// read off stored data.
const invoiceOverdueAfter = Duration(days: 30);

/// The pure rollup at the heart of the Finance page: every number the screen
/// shows is computed here from `deals` alone, and nothing here writes
/// anything back — same shape as `team_dashboard_aggregator.dart`'s
/// `computeTeamDashboardStats`.
///
/// [now] defaults to [DateTime.now] and exists so "is this overdue" is
/// testable against a fixed instant rather than the wall clock.
FinanceStats computeFinanceStats(List<Deal> deals, {DateTime? now}) {
  final asOf = now ?? DateTime.now();
  final rows = [for (final deal in deals) _rowFor(deal, asOf)];

  double sumWhere(
    bool Function(FinanceDealRow row) test,
    double Function(Deal deal) amount,
  ) =>
      rows.where(test).fold(0.0, (sum, row) => sum + amount(row.deal));

  final totals = FinanceTotals(
    totalBrandRevenue: sumWhere((r) => r.invoicePaid, (d) => d.brandPrice),
    totalMargin: sumWhere((r) => r.invoicePaid, (d) => d.margin),
    totalOutstanding:
        sumWhere((r) => r.invoiceSent && !r.invoicePaid, (d) => d.brandPrice),
    totalOwedToCreators:
        sumWhere((r) => r.payoutDue, (d) => d.influencerPayout),
  );

  return FinanceStats(rows: rows, totals: totals);
}

FinanceDealRow _rowFor(Deal deal, DateTime asOf) {
  final invoiceSent = deal.brandInvoiceSentAt != null;
  final invoicePaid = deal.brandInvoicePaidAt != null;
  final invoiceOverdue = invoiceSent &&
      !invoicePaid &&
      asOf.difference(deal.brandInvoiceSentAt!) > invoiceOverdueAfter;

  final payoutDueSet = deal.creatorPayoutDueAt != null;
  final payoutPaid = deal.creatorPayoutPaidAt != null;
  final payoutDue = payoutDueSet && !payoutPaid;
  final payoutOverdue = payoutDue && deal.creatorPayoutDueAt!.isBefore(asOf);

  return FinanceDealRow(
    deal: deal,
    invoiceSent: invoiceSent,
    invoicePaid: invoicePaid,
    invoiceOverdue: invoiceOverdue,
    payoutDue: payoutDue,
    payoutOverdue: payoutOverdue,
    payoutPaid: payoutPaid,
  );
}
