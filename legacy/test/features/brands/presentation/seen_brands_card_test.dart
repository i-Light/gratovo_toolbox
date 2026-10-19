// Roster -> Brands -> "Brands seen sponsoring" (fix #6).
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/brand.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_agency_settings_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_brand_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/brands/presentation/widgets/seen_brands_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

Influencer _creator(String id, List<String> brands) => Influencer(
      id: id,
      handle: '@$id',
      channelUrl: '',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 100000,
      sourceKeywords: const [],
      vettingStatus: VettingStatus.newlyFound,
      discoveredAt: DateTime(2026),
      seenBrands: brands,
    );

void main() {
  testWidgets('seen brands, how many channels, and one click to a record',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 1600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final brands = MockBrandRepository();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        supabaseBootProvider.overrideWithValue(
          const SupabaseBoot(
            config: SupabaseConfig(url: '', anonKey: ''),
            error: 'no server configured in this test',
          ),
        ),
        influencerRepositoryProvider.overrideWithValue(
          MockInfluencerRepository()
            ..replaceAllForTesting([
              _creator('aitools', ['Opera GX', 'Notion']),
              _creator('promptguy', ['Opera GX']),
            ]),
        ),
        brandRepositoryProvider.overrideWithValue(brands),
        agencySettingsRepositoryProvider
            .overrideWithValue(MockAgencySettingsRepository()),
      ],
      child: const MaterialApp(
        localizationsDelegates: [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        locale: Locale('en'),
        home: Scaffold(body: SingleChildScrollView(child: SeenBrandsCard())),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('2 brands seen across 2 channels'), findsOneWidget);
    await tester.tap(find.text('Brands seen sponsoring'));
    await tester.pumpAndSettle();

    expect(find.text('Opera GX'), findsOneWidget);
    expect(find.text('2 channels: @aitools, @promptguy'), findsOneWidget);
    // Notion is already a brand record (the mock's brand_002).
    expect(find.text('Saved'), findsOneWidget);

    await tester.tap(find.text('Create brand'));
    await tester.pumpAndSettle();
    expect(
        tester
            .widget<TextFormField>(find.byKey(const ValueKey('brand-name')))
            .controller!
            .text,
        'Opera GX');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    final created =
        (await brands.getAll()).firstWhere((b) => b.name == 'Opera GX');
    expect(created.source, BrandSource.seenSponsoring);
    expect(find.text('Saved'), findsNWidgets(2));
  });
}
