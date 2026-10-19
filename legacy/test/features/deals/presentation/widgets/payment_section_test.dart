import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/toast/toast_overlay.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_deal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/payment_section.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

Deal _deal({
  String currency = 'USD',
  DateTime? brandInvoiceSentAt,
  DateTime? brandInvoicePaidAt,
  DateTime? creatorPayoutDueAt,
  DateTime? creatorPayoutPaidAt,
  String? paymentMethod,
  String? paymentReference,
}) =>
    Deal(
      id: 'deal_001',
      brandId: 'brand_001',
      influencerId: 'inf_001',
      stage: DealStage.signed,
      brandPrice: 3000,
      influencerPayout: 2000,
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
      currency: currency,
      brandInvoiceSentAt: brandInvoiceSentAt,
      brandInvoicePaidAt: brandInvoicePaidAt,
      creatorPayoutDueAt: creatorPayoutDueAt,
      creatorPayoutPaidAt: creatorPayoutPaidAt,
      paymentMethod: paymentMethod,
      paymentReference: paymentReference,
    );

/// Pumps [PaymentSection] on its own, the same isolation strategy
/// `influencer_contacts_card_test.dart` uses for its own card: only
/// [dealRepositoryProvider] is needed, not the rest of the deal detail
/// screen.
Widget _harness(MockDealRepository repository, Deal deal) {
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
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      builder: (context, child) => ToastOverlay(child: child!),
      home: Scaffold(body: PaymentSection(deal: deal)),
    ),
  );
}

void main() {
  testWidgets('shows the margin prominently', (tester) async {
    final deal = _deal();
    await tester.pumpWidget(_harness(MockDealRepository(), deal));
    await tester.pumpAndSettle();

    // brandPrice 3000 - influencerPayout 2000 = 1000.
    expect(find.textContaining('1,000'), findsOneWidget);
  });

  testWidgets('unset dates show the not-set placeholder', (tester) async {
    final deal = _deal();
    await tester.pumpWidget(_harness(MockDealRepository(), deal));
    await tester.pumpAndSettle();

    final l10n = await AppLocalizations.delegate.load(const Locale('en'));
    expect(find.text(l10n.paymentNotSet), findsNWidgets(4));
  });

  testWidgets(
      '"Mark sent now" writes brandInvoiceSentAt through '
      'updatePayment', (tester) async {
    final repository = MockDealRepository();
    final deal = _deal();
    await tester.pumpWidget(_harness(repository, deal));
    await tester.pumpAndSettle();

    final l10n = await AppLocalizations.delegate.load(const Locale('en'));
    await tester.tap(find.widgetWithText(TextButton, l10n.paymentMarkSentNow));
    await tester.pumpAndSettle();

    final saved = await repository.getById('deal_001');
    expect(saved!.brandInvoiceSentAt, isNotNull);
    // Nothing else in the payment set was touched by this one action.
    expect(saved.brandInvoicePaidAt, isNull);
    expect(saved.creatorPayoutDueAt, isNull);
    expect(find.text(l10n.paymentDateSaved), findsOneWidget);
  });

  testWidgets('clearing a set date writes null through updatePayment',
      (tester) async {
    final repository = MockDealRepository();
    final deal = _deal(brandInvoicePaidAt: DateTime(2026, 2, 1));
    await tester.pumpWidget(_harness(repository, deal));
    await tester.pumpAndSettle();

    final l10n = await AppLocalizations.delegate.load(const Locale('en'));
    final clearButtons = find.widgetWithIcon(IconButton, Icons.close);
    expect(clearButtons, findsOneWidget);
    await tester.tap(clearButtons);
    await tester.pumpAndSettle();

    final saved = await repository.getById('deal_001');
    expect(saved!.brandInvoicePaidAt, isNull);
    expect(find.text(l10n.paymentDateSaved), findsOneWidget);
  });

  testWidgets(
      'saving currency, method and reference writes all three '
      'together and preserves existing dates', (tester) async {
    final repository = MockDealRepository();
    final deal = _deal(brandInvoiceSentAt: DateTime(2026, 3, 1));
    await tester.pumpWidget(_harness(repository, deal));
    await tester.pumpAndSettle();

    final l10n = await AppLocalizations.delegate.load(const Locale('en'));
    await tester.enterText(
      find.widgetWithText(TextField, l10n.paymentCurrencyLabel),
      'eur',
    );
    await tester.enterText(
      find.widgetWithText(TextField, l10n.paymentMethodLabel),
      'wire',
    );
    await tester.enterText(
      find.widgetWithText(TextField, l10n.paymentReferenceLabel),
      'TX-42',
    );
    await tester.tap(find.widgetWithText(FilledButton, l10n.commonSave));
    await tester.pumpAndSettle();

    final saved = await repository.getById('deal_001');
    expect(saved!.currency, 'EUR');
    expect(saved.paymentMethod, 'wire');
    expect(saved.paymentReference, 'TX-42');
    // The date set before this save was untouched by it.
    expect(saved.brandInvoiceSentAt, DateTime(2026, 3, 1));
    expect(find.text(l10n.paymentDetailsSaved), findsOneWidget);
  });
}
