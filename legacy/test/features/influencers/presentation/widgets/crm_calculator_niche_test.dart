// The pricing helper's niche CPM table and slider (HC-05): pick a niche, see
// its range and the prices it implies, slide to test numbers quickly.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/video.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/crm_calculator_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

final _channel = Influencer(
  id: 'UC_c',
  handle: '@c',
  channelUrl: '',
  platform: InfluencerPlatform.youtube,
  subscriberCount: 200000,
  sourceKeywords: const [],
  vettingStatus: VettingStatus.newlyFound,
  discoveredAt: DateTime(2026),
);

// Median 100,000 views: a $30 CPM is a $3,000 video.
final _videos = [
  for (final (i, views) in [90000, 100000, 110000].indexed)
    Video(
      id: 'v$i',
      title: 'Video $i',
      url: 'https://youtube.com/watch?v=v$i',
      viewCount: views,
      publishedAt: DateTime(2026, 10, 1 + i),
    ),
];

void main() {
  testWidgets('the niche range, its prices, and a slider for the CPM',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        supabaseBootProvider.overrideWithValue(
          const SupabaseBoot(
            config: SupabaseConfig(url: '', anonKey: ''),
            error: 'no server configured in this test',
          ),
        ),
        videosByInfluencerProvider('UC_c').overrideWith((ref) async => _videos),
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
              builder: (context) => CrmCalculatorCard(
                influencer: _channel,
                l10n: AppLocalizations.of(context),
              ),
            ),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('What a video is worth'));
    await tester.pumpAndSettle();

    expect(find.text('Tech: \$20-50 CPM, so \$2,000-5,000 for this channel'),
        findsOneWidget);
    final slider =
        tester.widget<Slider>(find.byKey(const ValueKey('cpm-slider')));
    expect((slider.min, slider.max), (20, 50));

    slider.onChanged!(30);
    await tester.pumpAndSettle();

    TextField field(String label) =>
        tester.widget<TextField>(find.widgetWithText(TextField, label));
    expect(field('CPM').controller!.text, '30.00');
    expect(field('Price').controller!.text, '3000');

    await tester.tap(find.byKey(const ValueKey('cpm-niche')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Finance').last);
    await tester.pumpAndSettle();
    expect(find.text('Finance: \$15-80 CPM, so \$1,500-8,000 for this channel'),
        findsOneWidget);
  });
}
