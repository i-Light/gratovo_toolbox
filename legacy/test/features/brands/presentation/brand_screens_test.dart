// The brand list and profile with the 1.4 brand: New brand, Edit, every
// contact, and the HC-09 boycott said where the brand is shown.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/agency_settings.dart';
import 'package:gratovo_toolbox/data/models/brand.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_agency_settings_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_brand_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/brands/presentation/brand_list_screen.dart';
import 'package:gratovo_toolbox/features/brands/presentation/brand_profile_screen.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

Future<MockBrandRepository> _pump(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1000, 1600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final brands = MockBrandRepository();
  await brands.create(Brand(
    id: 'brand_wix',
    name: 'Wix',
    createdAt: DateTime(2026),
    contacts: const [
      BrandContact(name: 'Dana', email: 'dana@wix.example', isPrimary: true),
      BrandContact(name: 'Eli', email: 'eli@wix.example', role: 'Marketing'),
    ],
  ));
  final agency = MockAgencySettingsRepository();
  await agency.save(const AgencySettings(boycottBrands: ['Wix']));
  await tester.pumpWidget(ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      brandRepositoryProvider.overrideWithValue(brands),
      agencySettingsRepositoryProvider.overrideWithValue(agency),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      locale: const Locale('en'),
      home: screen,
    ),
  ));
  await tester.pumpAndSettle();
  return brands;
}

void main() {
  testWidgets('the list offers a new brand and marks a boycotted one',
      (tester) async {
    await _pump(tester, const BrandListScreen());

    expect(find.text('New brand'), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp('boycott', caseSensitive: false)),
        findsOneWidget);

    await tester.tap(find.text('New brand'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsOneWidget);
  });

  testWidgets('the profile shows every contact, the boycott, and Edit',
      (tester) async {
    await _pump(tester, const BrandProfileScreen(brandId: 'brand_wix'));

    expect(
        find.text('On the boycott list (Wix): no pitch and no creator for '
            'this brand.'),
        findsOneWidget);
    expect(find.text('dana@wix.example'), findsOneWidget);
    expect(find.text('eli@wix.example'), findsOneWidget);
    expect(find.textContaining('Marketing'), findsOneWidget);

    await tester.tap(find.byTooltip('Edit brand'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsOneWidget);
  });
}
