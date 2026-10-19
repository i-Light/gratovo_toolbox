import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/features/finance/application/finance_aggregator.dart';

void main() {
  final asOf = DateTime(2026, 9, 19);

  Deal dealWith({
    required String id,
    double brandPrice = 1000,
    double influencerPayout = 700,
    DateTime? brandInvoiceSentAt,
    DateTime? brandInvoicePaidAt,
    DateTime? creatorPayoutDueAt,
    DateTime? creatorPayoutPaidAt,
  }) {
    return Deal(
      id: id,
      brandId: 'brand_x',
      influencerId: 'inf_x',
      stage: DealStage.closed,
      brandPrice: brandPrice,
      influencerPayout: influencerPayout,
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
      brandInvoiceSentAt: brandInvoiceSentAt,
      brandInvoicePaidAt: brandInvoicePaidAt,
      creatorPayoutDueAt: creatorPayoutDueAt,
      creatorPayoutPaidAt: creatorPayoutPaidAt,
    );
  }

  group('computeFinanceStats row flags', () {
    test('a deal with nothing invoiced/paid yet has every flag false', () {
      final stats = computeFinanceStats([dealWith(id: 'a')], now: asOf);
      final row = stats.rows.single;
      expect(row.invoiceSent, isFalse);
      expect(row.invoicePaid, isFalse);
      expect(row.invoiceOverdue, isFalse);
      expect(row.payoutDue, isFalse);
      expect(row.payoutOverdue, isFalse);
      expect(row.payoutPaid, isFalse);
    });

    test('invoice sent recently, unpaid, is not yet overdue', () {
      final stats = computeFinanceStats(
        [
          dealWith(
            id: 'a',
            brandInvoiceSentAt: asOf.subtract(const Duration(days: 10)),
          ),
        ],
        now: asOf,
      );
      final row = stats.rows.single;
      expect(row.invoiceSent, isTrue);
      expect(row.invoicePaid, isFalse);
      expect(row.invoiceOverdue, isFalse);
    });

    test(
        'invoice sent more than the overdue window ago, still unpaid, is '
        'overdue', () {
      final stats = computeFinanceStats(
        [
          dealWith(
            id: 'a',
            brandInvoiceSentAt:
                asOf.subtract(invoiceOverdueAfter + const Duration(days: 1)),
          ),
        ],
        now: asOf,
      );
      expect(stats.rows.single.invoiceOverdue, isTrue);
    });

    test('a paid invoice is never overdue, however long ago it was sent', () {
      final stats = computeFinanceStats(
        [
          dealWith(
            id: 'a',
            brandInvoiceSentAt: asOf.subtract(const Duration(days: 200)),
            brandInvoicePaidAt: asOf.subtract(const Duration(days: 190)),
          ),
        ],
        now: asOf,
      );
      final row = stats.rows.single;
      expect(row.invoicePaid, isTrue);
      expect(row.invoiceOverdue, isFalse);
    });

    test('a payout due date in the future counts as due but not overdue', () {
      final stats = computeFinanceStats(
        [
          dealWith(
            id: 'a',
            creatorPayoutDueAt: asOf.add(const Duration(days: 5)),
          ),
        ],
        now: asOf,
      );
      final row = stats.rows.single;
      expect(row.payoutDue, isTrue);
      expect(row.payoutOverdue, isFalse);
    });

    test('a payout due date in the past that is still unpaid is overdue', () {
      final stats = computeFinanceStats(
        [
          dealWith(
            id: 'a',
            creatorPayoutDueAt: asOf.subtract(const Duration(days: 3)),
          ),
        ],
        now: asOf,
      );
      final row = stats.rows.single;
      expect(row.payoutDue, isTrue);
      expect(row.payoutOverdue, isTrue);
    });

    test('a paid-out payout is neither due nor overdue', () {
      final stats = computeFinanceStats(
        [
          dealWith(
            id: 'a',
            creatorPayoutDueAt: asOf.subtract(const Duration(days: 3)),
            creatorPayoutPaidAt: asOf.subtract(const Duration(days: 1)),
          ),
        ],
        now: asOf,
      );
      final row = stats.rows.single;
      expect(row.payoutDue, isFalse);
      expect(row.payoutOverdue, isFalse);
      expect(row.payoutPaid, isTrue);
    });
  });

  group('computeFinanceStats totals', () {
    test('only paid-invoice deals count toward revenue and margin', () {
      final deals = [
        dealWith(
          id: 'paid',
          brandPrice: 1000,
          influencerPayout: 600,
          brandInvoiceSentAt: DateTime(2026, 1, 1),
          brandInvoicePaidAt: DateTime(2026, 1, 5),
        ),
        dealWith(
          id: 'unpaid',
          brandPrice: 2000,
          influencerPayout: 1500,
          brandInvoiceSentAt: DateTime(2026, 1, 1),
        ),
        dealWith(id: 'untouched', brandPrice: 5000, influencerPayout: 4000),
      ];
      final totals = computeFinanceStats(deals, now: asOf).totals;
      expect(totals.totalBrandRevenue, 1000);
      expect(totals.totalMargin, 400);
    });

    test('outstanding sums invoiced-but-unpaid brand price only', () {
      final deals = [
        dealWith(
          id: 'unpaid',
          brandPrice: 2000,
          brandInvoiceSentAt: DateTime(2026, 1, 1),
        ),
        dealWith(
          id: 'paid',
          brandPrice: 900,
          brandInvoiceSentAt: DateTime(2026, 1, 1),
          brandInvoicePaidAt: DateTime(2026, 1, 2),
        ),
        dealWith(id: 'never-invoiced', brandPrice: 300),
      ];
      final totals = computeFinanceStats(deals, now: asOf).totals;
      expect(totals.totalOutstanding, 2000);
    });

    test(
        'owed-to-creators sums payout-due-and-unpaid payouts only, '
        'whether or not overdue', () {
      final deals = [
        dealWith(
          id: 'due-future',
          influencerPayout: 400,
          creatorPayoutDueAt: asOf.add(const Duration(days: 2)),
        ),
        dealWith(
          id: 'due-past',
          influencerPayout: 300,
          creatorPayoutDueAt: asOf.subtract(const Duration(days: 2)),
        ),
        dealWith(
          id: 'paid',
          influencerPayout: 999,
          creatorPayoutDueAt: asOf.subtract(const Duration(days: 10)),
          creatorPayoutPaidAt: asOf.subtract(const Duration(days: 5)),
        ),
        dealWith(id: 'no-payout-yet', influencerPayout: 999),
      ];
      final totals = computeFinanceStats(deals, now: asOf).totals;
      expect(totals.totalOwedToCreators, 700);
    });

    test('an empty deal list produces all-zero totals', () {
      final totals = computeFinanceStats([], now: asOf).totals;
      expect(totals.totalBrandRevenue, 0);
      expect(totals.totalMargin, 0);
      expect(totals.totalOutstanding, 0);
      expect(totals.totalOwedToCreators, 0);
    });
  });
}
