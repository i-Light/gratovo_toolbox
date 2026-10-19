import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/localization/locale_provider.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/toast/toast_overlay.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_campaign_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/campaigns/presentation/widgets/campaigns_section.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Pins the UI to English — the app's own default is Arabic (see
/// `LocaleNotifier`) and `instantFormatterProvider` reads straight from
/// Riverpod, so without this override the date text under a campaign row
/// would render in Arabic while the rest of the assertions stay English.
/// Same fix as `deliverables_section_test.dart`'s `_EnglishLocale`.
class _EnglishLocale extends LocaleNotifier {
  @override
  Locale build() => const Locale('en');
}

/// Wrapped in a minimal [GoRouter] (not a bare [MaterialApp]) because a
/// campaign row navigates with `context.go` on tap — the same reason
/// `finance_screen_test.dart` wraps `FinanceScreen` in one.
Widget _harness(MockCampaignRepository repository,
    {String brandId = 'brand_001'}) {
  final router = GoRouter(
    initialLocation: '/brands/$brandId',
    routes: [
      GoRoute(
        path: '/brands/:id',
        builder: (context, state) => Scaffold(
          body: SingleChildScrollView(
            child: CampaignsSection(brandId: state.pathParameters['id']!),
          ),
        ),
        routes: [
          GoRoute(
            path: 'campaigns/:campaignId',
            builder: (context, state) => const Scaffold(
              body: Text('campaign detail'),
            ),
          ),
        ],
      ),
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
      localeProvider.overrideWith(_EnglishLocale.new),
      campaignRepositoryProvider.overrideWithValue(repository),
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
      builder: (context, child) => ToastOverlay(child: child!),
    ),
  );
}

void main() {
  testWidgets('shows the seeded campaign for this brand', (tester) async {
    await tester.pumpWidget(_harness(MockCampaignRepository()));
    await tester.pumpAndSettle();

    expect(find.text('Campaigns'), findsOneWidget);
    // campaign_001 belongs to brand_001 in MockCampaignRepository's seed.
    expect(find.text('Spring safe-travel push'), findsOneWidget);
    expect(find.text('Active'), findsOneWidget);
  });

  testWidgets('a brand with no campaigns shows the empty state',
      (tester) async {
    await tester.pumpWidget(
      _harness(MockCampaignRepository(), brandId: 'brand_with_none'),
    );
    await tester.pumpAndSettle();

    expect(
      find.text(
        "No campaigns yet — group this brand's deals under one to plan a "
        'proposal or report around it.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('adding a campaign with a name appends it to the list',
      (tester) async {
    final repository = MockCampaignRepository();
    await tester.pumpWidget(
      _harness(repository, brandId: 'brand_add_test'),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Add campaign'));
    await tester.pumpAndSettle();
    expect(find.text('Add a campaign'), findsOneWidget);

    // Submitting with no name shows the validation error and saves nothing.
    await tester.tap(find.text('Add').last);
    await tester.pumpAndSettle();
    expect(find.text('A name is required.'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField).first, 'Q3 push');
    await tester.tap(find.text('Add').last);
    await tester.pumpAndSettle();

    expect(find.text('Campaign created'), findsOneWidget);
    expect(find.text('Q3 push'), findsOneWidget);

    final saved = await repository.getByBrand('brand_add_test');
    expect(saved, hasLength(1));
    expect(saved.single.name, 'Q3 push');
  });

  testWidgets('tapping a campaign navigates to its detail route',
      (tester) async {
    await tester.pumpWidget(_harness(MockCampaignRepository()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Spring safe-travel push'));
    await tester.pumpAndSettle();

    expect(find.text('campaign detail'), findsOneWidget);
  });
}
