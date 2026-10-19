import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/features/finance/application/finance_models.dart';
import 'package:gratovo_toolbox/features/finance/application/finance_sort_controller.dart';

void main() {
  FinanceDealRow row({
    required String id,
    double brandPrice = 1000,
    double influencerPayout = 700,
    DateTime? brandInvoicePaidAt,
  }) {
    final deal = Deal(
      id: id,
      brandId: 'brand_x',
      influencerId: 'inf_x',
      stage: DealStage.closed,
      brandPrice: brandPrice,
      influencerPayout: influencerPayout,
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
      brandInvoicePaidAt: brandInvoicePaidAt,
    );
    return FinanceDealRow(
      deal: deal,
      invoiceSent: brandInvoicePaidAt != null,
      invoicePaid: brandInvoicePaidAt != null,
      invoiceOverdue: false,
      payoutDue: false,
      payoutOverdue: false,
      payoutPaid: false,
    );
  }

  group('sortFinanceRows', () {
    final rows = [
      row(id: 'low', brandPrice: 500, influencerPayout: 100),
      row(id: 'high', brandPrice: 5000, influencerPayout: 1000),
      row(
        id: 'mid',
        brandPrice: 2000,
        influencerPayout: 2100, // negative margin, on purpose
      ),
    ];

    test('sorts by brand price, either direction', () {
      final asc = sortFinanceRows(
        rows,
        const FinanceSort(
          column: FinanceSortColumn.brandPrice,
          ascending: true,
        ),
      );
      expect(asc.map((r) => r.deal.id), ['low', 'mid', 'high']);

      final desc = sortFinanceRows(
        rows,
        const FinanceSort(
          column: FinanceSortColumn.brandPrice,
          ascending: false,
        ),
      );
      expect(desc.map((r) => r.deal.id), ['high', 'mid', 'low']);
    });

    test('sorts by margin, which can be negative', () {
      final asc = sortFinanceRows(
        rows,
        const FinanceSort(column: FinanceSortColumn.margin, ascending: true),
      );
      // mid: 2000-2100=-100, low: 500-100=400, high: 5000-1000=4000
      expect(asc.map((r) => r.deal.id), ['mid', 'low', 'high']);
    });

    test('a null invoice-paid date always sorts last, either direction', () {
      final dated = [
        row(id: 'a', brandInvoicePaidAt: DateTime(2026, 2, 1)),
        row(id: 'b'),
        row(id: 'c', brandInvoicePaidAt: DateTime(2026, 1, 1)),
      ];

      final asc = sortFinanceRows(
        dated,
        const FinanceSort(
          column: FinanceSortColumn.invoicePaidAt,
          ascending: true,
        ),
      );
      expect(asc.map((r) => r.deal.id), ['c', 'a', 'b']);

      final desc = sortFinanceRows(
        dated,
        const FinanceSort(
          column: FinanceSortColumn.invoicePaidAt,
          ascending: false,
        ),
      );
      expect(desc.map((r) => r.deal.id), ['a', 'c', 'b']);
    });

    test('does not mutate the original list', () {
      final originalOrder = rows.map((r) => r.deal.id).toList();
      sortFinanceRows(
        rows,
        const FinanceSort(
          column: FinanceSortColumn.brandPrice,
          ascending: true,
        ),
      );
      expect(rows.map((r) => r.deal.id).toList(), originalOrder);
    });
  });

  group('FinanceSort.toggled', () {
    test('switching to a new column always starts descending', () {
      const current = FinanceSort(
        column: FinanceSortColumn.brandPrice,
        ascending: false,
      );
      final toggled = current.toggled(FinanceSortColumn.margin);
      expect(toggled.column, FinanceSortColumn.margin);
      expect(toggled.ascending, isFalse);
    });

    test('tapping the active column flips direction', () {
      const current = FinanceSort(
        column: FinanceSortColumn.brandPrice,
        ascending: false,
      );
      final toggled = current.toggled(FinanceSortColumn.brandPrice);
      expect(toggled.ascending, isTrue);
    });
  });
}
