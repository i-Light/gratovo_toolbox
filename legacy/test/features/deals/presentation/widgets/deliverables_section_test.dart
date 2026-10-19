import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/localization/locale_provider.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/toast/toast_overlay.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_deliverable_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/deliverables_section.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Pins the UI to English. The app's own default is Arabic (see
/// `LocaleNotifier`); without this override `instantFormatterProvider` (read
/// straight from Riverpod, not from this harness's `MaterialApp.locale`)
/// formats every date in Arabic while the rest of the assertions below stay
/// English — see `app_smoke_test.dart`'s `_EnglishLocale` for the same fix.
class _EnglishLocale extends LocaleNotifier {
  @override
  Locale build() => const Locale('en');
}

/// Pumps [DeliverablesSection] on its own, the same way
/// `influencer_contacts_card_test.dart` pumps its card rather than a whole
/// profile screen — this feature's write path only needs
/// [deliverableRepositoryProvider].
Widget _harness(MockDeliverableRepository repository,
    {String dealId = 'deal_001'}) {
  return ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      localeProvider.overrideWith(_EnglishLocale.new),
      deliverableRepositoryProvider.overrideWithValue(repository),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      // Mounted the same way app.dart mounts it, so the toasts asserted
      // below actually render.
      builder: (context, child) => ToastOverlay(child: child!),
      home: Scaffold(
        body: SingleChildScrollView(
          child: DeliverablesSection(dealId: dealId),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('shows the seeded deliverables for the deal, most senior first',
      (tester) async {
    await tester.pumpWidget(_harness(MockDeliverableRepository()));
    await tester.pumpAndSettle();

    expect(find.text('Deliverables'), findsOneWidget);
    expect(find.text('No deliverables tracked yet.'), findsNothing);
    // The two rows `MockDeliverableRepository` seeds for deal_001.
    expect(find.text('Integration'), findsOneWidget);
    expect(find.text('Community post'), findsOneWidget);
    expect(find.text('Approved'), findsOneWidget);
    expect(find.text('Pending'), findsOneWidget);
  });

  testWidgets('a deal with no deliverables shows the empty state',
      (tester) async {
    await tester.pumpWidget(
      _harness(MockDeliverableRepository(), dealId: 'deal_with_none'),
    );
    await tester.pumpAndSettle();

    expect(find.text('No deliverables tracked yet.'), findsOneWidget);
  });

  testWidgets('adding a deliverable appends a new pending row', (tester) async {
    final repository = MockDeliverableRepository();
    await tester.pumpWidget(_harness(repository, dealId: 'deal_add_test'));
    await tester.pumpAndSettle();

    expect(find.text('No deliverables tracked yet.'), findsOneWidget);

    await tester.tap(find.text('Add deliverable'));
    await tester.pumpAndSettle();
    expect(find.text('Add a deliverable'), findsOneWidget);

    await tester.tap(find.text('Short').last);
    await tester.pumpAndSettle();

    expect(find.text('No deliverables tracked yet.'), findsNothing);
    expect(find.text('Deliverable added'), findsOneWidget);

    final saved = await repository.getForDeal('deal_add_test');
    expect(saved, hasLength(1));
    expect(saved.single.type.name, 'short');
  });

  testWidgets('deleting a deliverable asks for confirmation, then removes it',
      (tester) async {
    final repository = MockDeliverableRepository();
    await tester.pumpWidget(_harness(repository));
    await tester.pumpAndSettle();

    expect(find.text('Integration'), findsOneWidget);

    await tester.tap(find.byTooltip('Delete deliverable').first);
    await tester.pumpAndSettle();
    expect(find.text('Delete this deliverable?'), findsOneWidget);

    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();

    expect(find.text('Deliverable deleted'), findsOneWidget);
    final remaining = await repository.getForDeal('deal_001');
    expect(remaining, hasLength(1));
  });

  testWidgets('a published deliverable offers its 30-day report and says when',
      (tester) async {
    final repository = MockDeliverableRepository();
    await repository.create(Deliverable(
      id: '',
      dealId: 'deal_report',
      type: DeliverableType.integration,
      status: DeliverableStatus.published,
      publishedAt: DateTime.utc(2026, 10, 1, 12),
      createdAt: DateTime.utc(2026, 9),
      updatedAt: DateTime.utc(2026, 9),
    ));
    await tester.pumpWidget(_harness(repository, dealId: 'deal_report'));
    await tester.pumpAndSettle();

    expect(
        find.widgetWithText(OutlinedButton, '30-day report'), findsOneWidget);
    expect(find.textContaining('Report due'), findsOneWidget);
  });

  testWidgets('an unpublished deliverable has no report yet', (tester) async {
    await tester.pumpWidget(_harness(MockDeliverableRepository()));
    await tester.pumpAndSettle();

    expect(find.text('30-day report'), findsNothing);
  });
}
