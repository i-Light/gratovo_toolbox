/// The rollup shapes the Finance page renders. Everything here is derived
/// from `deals` alone, never stored — same spirit as
/// `team_dashboard_models.dart`'s `TeamDashboardStats`: computed fresh every
/// time the screen asks, so there is never a second copy of a number to
/// drift from the ledger fields on [Deal] itself.
library;

import 'package:gratovo_toolbox/data/models/deal.dart';

/// One deal's payment status, alongside the [Deal] it was derived from.
/// Computed once in `finance_aggregator.dart` so the screen and its filters
/// never re-derive the same ✓/✗ booleans from raw timestamps on the fly.
///
/// "Overdue" has no explicit due date to compare against for an invoice —
/// [Deal] only carries sent/paid timestamps, not a due date — so
/// [invoiceOverdue] is a broker-wide net-30 assumption (see
/// `finance_aggregator.dart`'s `invoiceOverdueAfter`). [payoutOverdue] has a
/// real due date ([Deal.creatorPayoutDueAt]) to compare against and needs no
/// such assumption.
class FinanceDealRow {
  const FinanceDealRow({
    required this.deal,
    required this.invoiceSent,
    required this.invoicePaid,
    required this.invoiceOverdue,
    required this.payoutDue,
    required this.payoutOverdue,
    required this.payoutPaid,
  });

  final Deal deal;

  /// `deal.brandInvoiceSentAt != null`.
  final bool invoiceSent;

  /// `deal.brandInvoicePaidAt != null`.
  final bool invoicePaid;

  /// Invoiced, still unpaid, and sent long enough ago to count as late.
  final bool invoiceOverdue;

  /// A payout due date is set and it hasn't been paid yet — "owed to this
  /// creator right now", whether or not the due date itself has passed.
  final bool payoutDue;

  /// [payoutDue], and the due date itself has already passed.
  final bool payoutOverdue;

  /// `deal.creatorPayoutPaidAt != null`.
  final bool payoutPaid;
}

/// The four numbers the Finance page leads with. See
/// `finance_aggregator.dart`'s `computeFinanceStats` for exactly which deals
/// count toward each one and why.
class FinanceTotals {
  const FinanceTotals({
    required this.totalBrandRevenue,
    required this.totalMargin,
    required this.totalOutstanding,
    required this.totalOwedToCreators,
  });

  /// Sum of `brandPrice` across deals whose invoice has actually been paid —
  /// revenue that landed, not revenue that's merely been billed.
  final double totalBrandRevenue;

  /// Sum of `margin` across the same paid-invoice deals as
  /// [totalBrandRevenue] — the broker's realized take, not the pipeline's
  /// theoretical take.
  final double totalMargin;

  /// Sum of `brandPrice` across deals that have been invoiced but not yet
  /// paid — money billed, not yet in hand.
  final double totalOutstanding;

  /// Sum of `influencerPayout` across deals with a payout due that hasn't
  /// been paid out yet, whether or not the due date has passed.
  final double totalOwedToCreators;
}

/// The Finance page's complete rollup: every deal's payment status, plus the
/// ledger-wide totals.
class FinanceStats {
  const FinanceStats({required this.rows, required this.totals});

  final List<FinanceDealRow> rows;
  final FinanceTotals totals;
}

/// Which subset of deals the ledger table is narrowed to. See
/// `finance_filter_controller.dart`'s `applyFinanceFilter` for exactly what
/// each case matches.
enum FinanceFilter {
  all,
  invoiceUnpaid,
  invoiceOverdue,
  payoutDue,
  payoutOverdue,
  settled,
}
