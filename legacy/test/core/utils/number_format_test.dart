import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';

void main() {
  // The project rule: anything with MORE than three digits is comma-grouped.
  // 999 must stay 999, and 1000 must become 1,000 — that boundary is the
  // whole reason this helper exists rather than a bare NumberFormat call.
  group('formatCount', () {
    test('leaves three digits and fewer alone', () {
      expect(formatCount(0, locale: 'en'), '0');
      expect(formatCount(7, locale: 'en'), '7');
      expect(formatCount(999, locale: 'en'), '999');
    });

    test('groups four digits and more', () {
      expect(formatCount(1000, locale: 'en'), '1,000');
      expect(formatCount(482000, locale: 'en'), '482,000');
      expect(formatCount(5370000, locale: 'en'), '5,370,000');
    });

    test('shows a placeholder rather than "null"', () {
      expect(formatCount(null), '—');
      expect(formatCount(null, placeholder: 'n/a'), 'n/a');
    });
  });

  group('formatMoney', () {
    test('drops a pointless .00 but keeps real fractions', () {
      expect(formatMoney(12000, locale: 'en'), '12,000');
      expect(formatMoney(12000.5, locale: 'en'), '12,000.50');
    });
  });

  group('formatCurrency', () {
    test('keeps the symbol but drops a pointless .00', () {
      // The whole reason this helper exists rather than calling
      // NumberFormat.simpleCurrency: that always renders two decimals, so
      // every round deal price came out as "$12,000.00".
      expect(formatCurrency(12000, locale: 'en_US'), r'$12,000');
      expect(formatCurrency(12000.5, locale: 'en_US'), r'$12,000.50');
    });

    test('shows a placeholder rather than "null"', () {
      expect(formatCurrency(null, locale: 'en_US'), '—');
      expect(formatCurrency(null, placeholder: 'n/a', locale: 'en_US'), 'n/a');
    });
  });

  group('formatCompact', () {
    test('leaves small numbers as-is and shortens large ones', () {
      expect(formatCompact(999, locale: 'en'), '999');
      expect(formatCompact(1234, locale: 'en'), '1.2K');
    });
  });

  group('formatBytes', () {
    test('bytes below a kilobyte are exact', () {
      expect(formatBytes(0, locale: 'en'), '0 B');
      expect(formatBytes(999, locale: 'en'), '999 B');
    });

    test('uses decimal units, matching what the OS reports', () {
      // 1000, not 1024. This number sits next to a "delete saved pictures"
      // button and is compared against the file manager, which is decimal on
      // every platform this app targets.
      expect(formatBytes(1000, locale: 'en'), '1 kB');
      expect(formatBytes(1500, locale: 'en'), '1.5 kB');
      expect(formatBytes(1000000, locale: 'en'), '1 MB');
      expect(formatBytes(3400000, locale: 'en'), '3.4 MB');
    });

    test('drops the decimal once the figure reaches double digits', () {
      // "342.7 MB" carries a digit nobody acts on; "3.4 MB" does not.
      expect(formatBytes(342700000, locale: 'en'), '343 MB');
      expect(formatBytes(12000000, locale: 'en'), '12 MB');
    });

    test('stops at terabytes rather than running out of units', () {
      expect(formatBytes(5000000000000, locale: 'en'), '5 TB');
      expect(formatBytes(9000000000000000, locale: 'en'), '9,000 TB');
    });
  });
}
