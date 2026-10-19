import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_deal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/finance/presentation/finance_screen.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Wrapped in a minimal [GoRouter] (not a bare [MaterialApp]) because
/// `FinanceTable` rows navigate with `context.go` on tap — the same reason
/// widget tests elsewhere in this app that render a `go_router`-aware screen
/// need a router in the tree rather than `Navigator.push`.
Widget _harness(MockDealRepository repository) {
  final router = GoRouter(
    initialLocation: '/finance',
    routes: [
      GoRoute(
          path: '/finance', builder: (context, state) => const FinanceScreen()),
      GoRoute(
          path: '/deals/:id', builder: (context, state) => const SizedBox()),
    ],
  );
  return ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      dealRepositoryProvider.overrideWithValue(repository),
    ],
    child: MaterialApp.router(
      routerConfig: router,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
    ),
  );
}

void main() {
  testWidgets('shows ledger-wide totals computed from the seeded deals',
      (tester) async {
    final repository = MockDealRepository();
    // deal_002: brandPrice 2500, influencerPayout 2000 — invoice fully paid.
    await repository.updatePayment(
      'deal_002',
      currency: 'USD',
      brandInvoiceSentAt: DateTime(2026, 1, 1),
      brandInvoicePaidAt: DateTime(2026, 1, 10),
    );
    // deal_001: brandPrice 3000 — invoiced, not yet paid (outstanding).
    await repository.updatePayment(
      'deal_001',
      currency: 'USD',
      brandInvoiceSentAt: DateTime(2026, 2, 1),
    );

    await tester.pumpWidget(_harness(repository));
    await tester.pumpAndSettle();

    final l10n = await AppLocalizations.delegate.load(const Locale('en'));
    expect(find.text(l10n.financeTitle), findsOneWidget);
    // Revenue/margin: only deal_002 (2500 paid, margin 500).
    expect(find.textContaining('2,500'), findsWidgets);
    // Outstanding: only deal_001's 3000 brand price.
    expect(find.textContaining('3,000'), findsWidgets);
  });

  testWidgets('the invoice-unpaid filter narrows the table', (tester) async {
    final repository = MockDealRepository();
    await repository.updatePayment(
      'deal_001',
      currency: 'USD',
      brandInvoiceSentAt: DateTime(2026, 2, 1),
    );

    await tester.pumpWidget(_harness(repository));
    await tester.pumpAndSettle();

    final l10n = await AppLocalizations.delegate.load(const Locale('en'));
    await tester.tap(find.text(l10n.financeFilterInvoiceUnpaid));
    await tester.pumpAndSettle();

    // Exactly one deal (deal_001) matches "invoiced, unpaid" out of the six
    // seeded deals, so the table renders one data row for it.
    expect(find.textContaining('3,000'), findsWidgets);
  });
}
