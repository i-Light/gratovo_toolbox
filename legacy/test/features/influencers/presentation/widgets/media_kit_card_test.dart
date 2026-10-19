// Profile -> Media kit (fix #4) and the Ready to pitch flag (BRD-PRES-15,
// HC-27).
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/media_kit.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/media_kit_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

Influencer _channel({MediaKit? kit}) => Influencer(
      id: 'UC_k',
      handle: '@k',
      channelUrl: '',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 100000,
      sourceKeywords: const [],
      vettingStatus: VettingStatus.newlyFound,
      discoveredAt: DateTime(2026),
      mediaKit: kit,
    );

Future<MockInfluencerRepository> _pump(
    WidgetTester tester, Influencer channel) async {
  tester.view.physicalSize = const Size(900, 1600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final repository = MockInfluencerRepository()
    ..replaceAllForTesting([channel]);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      influencerRepositoryProvider.overrideWithValue(repository),
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
      home: Scaffold(
        body: SingleChildScrollView(
          child: Builder(
            builder: (context) => MediaKitCard(
              influencer: channel,
              l10n: AppLocalizations.of(context),
            ),
          ),
        ),
      ),
    ),
  ));
  await tester.pumpAndSettle();
  return repository;
}

void main() {
  testWidgets('a full kit is ready to pitch and shows what it holds',
      (tester) async {
    await _pump(
      tester,
      _channel(
        kit: const MediaKit(
          countries: [
            AudienceShare(code: 'US', pct: 18),
            AudienceShare(code: 'IN', pct: 15),
            AudienceShare(code: 'GB', pct: 6),
          ],
          ageBand: '18-34',
          rates: [
            RateCardRow(format: 'integration', price: 900, agreed: true),
            RateCardRow(format: 'short', price: 300),
          ],
        ),
      ),
    );

    expect(find.text('Ready to pitch'), findsOneWidget);
    expect(find.text('24% of the audience in the US, UK and Canada'),
        findsOneWidget);
    expect(find.text('Top countries: US 18% · IN 15% · GB 6%'), findsOneWidget);
    expect(find.text('Main age band: 18-34'), findsOneWidget);
    expect(find.text('Integration: \$900, agreed'), findsOneWidget);
    expect(find.text('Short: \$300, asking'), findsOneWidget);
  });

  testWidgets('no kit says what is missing before a pitch', (tester) async {
    await _pump(tester, _channel());

    expect(find.text('Not ready to pitch yet'), findsOneWidget);
    expect(
        find.text('Missing: audience analytics (top countries and age band)'),
        findsOneWidget);
    expect(
        find.text('Missing: a rate agreed with the creator'), findsOneWidget);
  });

  testWidgets('the kit is typed in and saved for the team', (tester) async {
    final repository = await _pump(tester, _channel());

    await tester.tap(find.byTooltip('Edit media kit'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('kit-code-0')), 'us');
    await tester.enterText(find.byKey(const ValueKey('kit-pct-0')), '35');
    await tester.enterText(find.byKey(const ValueKey('kit-age')), '18-34');
    await tester.tap(find.text('Add a rate'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('kit-price-0')), '800');
    await tester.tap(find.byKey(const ValueKey('kit-agreed-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(
      (await repository.getById('UC_k'))!.mediaKit,
      const MediaKit(
        countries: [AudienceShare(code: 'US', pct: 35)],
        ageBand: '18-34',
        rates: [RateCardRow(format: 'integration', price: 800, agreed: true)],
      ),
    );
  });

  testWidgets('a country code that is not two letters is refused',
      (tester) async {
    final repository = await _pump(tester, _channel());

    await tester.tap(find.byTooltip('Edit media kit'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('kit-code-0')), 'USA');
    await tester.enterText(find.byKey(const ValueKey('kit-pct-0')), '35');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(find.text('Two letters'), findsOneWidget);
    expect((await repository.getById('UC_k'))!.mediaKit, isNull);
  });

  testWidgets('the card and its dialog fit a small phone with large text',
      (tester) async {
    tester.view.physicalSize = const Size(375, 1400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final channel = _channel();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        supabaseBootProvider.overrideWithValue(
          const SupabaseBoot(
            config: SupabaseConfig(url: '', anonKey: ''),
            error: 'no server configured in this test',
          ),
        ),
        influencerRepositoryProvider.overrideWithValue(
            MockInfluencerRepository()..replaceAllForTesting([channel])),
      ],
      child: MaterialApp(
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        locale: const Locale('ar'),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: const TextScaler.linear(1.6)),
          child: child!,
        ),
        home: Scaffold(
          body: SingleChildScrollView(
            child: Builder(
              builder: (context) => MediaKitCard(
                influencer: channel,
                l10n: AppLocalizations.of(context),
              ),
            ),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.edit_outlined));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.add).last);
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byKey(const ValueKey('kit-price-0')), findsOneWidget);
  });
}
