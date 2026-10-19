import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/features/finance/application/finance_filter_controller.dart';
import 'package:gratovo_toolbox/features/finance/application/finance_models.dart';

void main() {
  Deal deal(String id) => Deal(
        id: id,
        brandId: 'brand_x',
        influencerId: 'inf_x',
        stage: DealStage.closed,
        brandPrice: 1000,
        influencerPayout: 700,
        createdAt: DateTime(2026, 1, 1),
        updatedAt: DateTime(2026, 1, 1),
      );

  FinanceDealRow row(
    String id, {
    bool invoiceSent = false,
    bool invoicePaid = false,
    bool invoiceOverdue = false,
    bool payoutDue = false,
    bool payoutOverdue = false,
    bool payoutPaid = false,
  }) =>
      FinanceDealRow(
        deal: deal(id),
        invoiceSent: invoiceSent,
        invoicePaid: invoicePaid,
        invoiceOverdue: invoiceOverdue,
        payoutDue: payoutDue,
        payoutOverdue: payoutOverdue,
        payoutPaid: payoutPaid,
      );

  group('applyFinanceFilter', () {
    final rows = [
      row('untouched'),
      row('invoice_unpaid', invoiceSent: true),
      row('invoice_overdue', invoiceSent: true, invoiceOverdue: true),
      row('payout_due', payoutDue: true),
      row('payout_overdue', payoutDue: true, payoutOverdue: true),
      row('settled', invoicePaid: true, payoutPaid: true),
    ];

    test('all keeps every row', () {
      expect(applyFinanceFilter(rows, FinanceFilter.all).length, rows.length);
    });

    test('invoiceUnpaid keeps only sent-but-unpaid rows', () {
      final result = applyFinanceFilter(rows, FinanceFilter.invoiceUnpaid);
      expect(
        result.map((r) => r.deal.id).toSet(),
        {'invoice_unpaid', 'invoice_overdue'},
      );
    });

    test('invoiceOverdue keeps only the overdue-flagged row', () {
      final result = applyFinanceFilter(rows, FinanceFilter.invoiceOverdue);
      expect(result.map((r) => r.deal.id).toSet(), {'invoice_overdue'});
    });

    test('payoutDue keeps due rows regardless of overdue status', () {
      final result = applyFinanceFilter(rows, FinanceFilter.payoutDue);
      expect(
        result.map((r) => r.deal.id).toSet(),
        {'payout_due', 'payout_overdue'},
      );
    });

    test('payoutOverdue keeps only the overdue-flagged row', () {
      final result = applyFinanceFilter(rows, FinanceFilter.payoutOverdue);
      expect(result.map((r) => r.deal.id).toSet(), {'payout_overdue'});
    });

    test('settled requires both invoice paid and payout paid', () {
      final result = applyFinanceFilter(rows, FinanceFilter.settled);
      expect(result.map((r) => r.deal.id).toSet(), {'settled'});
    });
  });
}
