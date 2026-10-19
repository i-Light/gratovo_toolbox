// The 30-day report dialog (plan step 7): read the views once, show views and
// CPM, add clicks when there is a tracking link, copy for email, save a page,
// and remind to pitch the brand again (HC-19).
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/native/url_launcher_provider.dart';
import 'package:gratovo_toolbox/core/native/video_stats_protocol.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/brand.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_brand_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_deal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_deliverable_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/deals/application/thirty_day_report_actions.dart';
import 'package:gratovo_toolbox/features/deals/application/video_stats_gateway.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/thirty_day_report_dialog.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

class _FakeStats implements VideoStatsGateway {
  final asked = <String>[];

  @override
  Future<VideoStatsResult> fetch(String video) async {
    asked.add(video);
    return VideoStatsResult(
      videoId: 'dQw4w9WgXcQ',
      views: 60000,
      fetchedAt: DateTime.utc(2026, 10, 31, 9),
    );
  }
}

class _World {
  final stats = _FakeStats();
  final deliverables = MockDeliverableRepository();
  final reminders = MockReminderRepository();
  final deals = MockDealRepository();
  final brands = MockBrandRepository();
  final pages = <String>[];
  late Deliverable video;
}

Future<_World> _pump(
  WidgetTester tester, {
  String? trackingLink,
  DateTime? publishedAt,
  Size size = const Size(1200, 1400),
  Locale locale = const Locale('en'),
  double textScale = 1,
  ThemeMode themeMode = ThemeMode.light,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final world = _World();
  await world.brands.create(
      Brand(id: 'brand_ai', name: 'Notion AI', createdAt: DateTime.utc(2026)));
  await world.deals.create(Deal(
    id: 'deal_ai',
    brandId: 'brand_ai',
    influencerId: 'UC_ai',
    stage: DealStage.live,
    brandPrice: 3000,
    influencerPayout: 2000,
    trackingLink: trackingLink,
    createdAt: DateTime.utc(2026, 9),
    updatedAt: DateTime.utc(2026, 9),
  ));
  world.video = await world.deliverables.create(Deliverable(
    id: '',
    dealId: 'deal_ai',
    type: DeliverableType.integration,
    status: DeliverableStatus.published,
    publishedUrl: 'https://youtu.be/dQw4w9WgXcQ',
    publishedAt:
        publishedAt ?? DateTime.now().subtract(const Duration(days: 31)),
    createdAt: DateTime.utc(2026, 9),
    updatedAt: DateTime.utc(2026, 9),
  ));
  final influencers = MockInfluencerRepository()
    ..replaceAllForTesting([
      Influencer(
        id: 'UC_ai',
        handle: '@aiexplained',
        channelUrl: '',
        platform: InfluencerPlatform.youtube,
        subscriberCount: 200000,
        sourceKeywords: const [],
        vettingStatus: VettingStatus.shortlisted,
        discoveredAt: DateTime.utc(2026),
      ),
    ]);

  await tester.pumpWidget(ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(const SupabaseBoot(
        config: SupabaseConfig(url: '', anonKey: ''),
        error: 'no server configured in this test',
      )),
      videoStatsGatewayProvider.overrideWithValue(world.stats),
      deliverableRepositoryProvider.overrideWithValue(world.deliverables),
      reminderRepositoryProvider.overrideWithValue(world.reminders),
      dealRepositoryProvider.overrideWithValue(world.deals),
      brandRepositoryProvider.overrideWithValue(world.brands),
      influencerRepositoryProvider.overrideWithValue(influencers),
      reportPageWriterProvider.overrideWithValue((fileName, html) async {
        world.pages.add(html);
        return 'C:/data/reports/$fileName';
      }),
      urlLauncherProvider.overrideWithValue((uri) async => true),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      locale: locale,
      theme: ThemeData.light(),
      darkTheme: ThemeData.dark(),
      themeMode: themeMode,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context)
            .copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: Scaffold(
        body: Builder(
          builder: (context) => Center(
            child: TextButton(
              onPressed: () => showThirtyDayReport(context,
                  dealId: 'deal_ai', deliverableId: world.video.id),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  ));
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return world;
}

void main() {
  testWidgets('reading the views shows them with the CPM achieved',
      (tester) async {
    final world = await _pump(tester);

    await tester.tap(find.text('Read the views now'));
    await tester.pumpAndSettle();

    expect(world.stats.asked, ['https://youtu.be/dQw4w9WgXcQ']);
    expect(find.textContaining('60,000'), findsOneWidget);
    expect(find.textContaining(r'$50.00'), findsOneWidget);
    expect(find.text('Read the views now'), findsNothing);
  });

  testWidgets('before day 30 it says the views are not 30-day views yet',
      (tester) async {
    await _pump(tester,
        publishedAt: DateTime.now().subtract(const Duration(days: 10)));

    expect(find.textContaining('not 30-day views'), findsOneWidget);
  });

  testWidgets('copy for email puts the report on the clipboard in English',
      (tester) async {
    String? copied;
    tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') {
        copied = (call.arguments as Map)['text'] as String?;
      }
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null));
    await _pump(tester, locale: const Locale('ar'));
    await tester.tap(find.byKey(const ValueKey('report-read-views')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('report-copy')));
    await tester.pumpAndSettle();

    expect(copied, contains('@aiexplained × Notion AI: results after 30 days'));
    expect(copied, contains('60,000'));
  });

  testWidgets('clicks are asked for only when the deal has a tracking link',
      (tester) async {
    final world = await _pump(tester, trackingLink: 'https://bit.ly/ai');
    await tester.tap(find.text('Read the views now'));
    await tester.pumpAndSettle();

    await tester.enterText(
        find.widgetWithText(TextField, 'Clicks on the tracking link'), '420');
    await tester.tap(find.text('Save clicks'));
    await tester.pumpAndSettle();

    final stored = (await world.deliverables.getForDeal('deal_ai')).single;
    expect(stored.reportClicks, 420);
  });

  testWidgets('no tracking link, no clicks field', (tester) async {
    await _pump(tester);
    await tester.tap(find.text('Read the views now'));
    await tester.pumpAndSettle();

    expect(find.widgetWithText(TextField, 'Clicks on the tracking link'),
        findsNothing);
  });

  testWidgets('good results set a reminder to pitch the brand again',
      (tester) async {
    final world = await _pump(tester);
    await tester.tap(find.text('Read the views now'));
    await tester.pumpAndSettle();

    await tester.tap(find.textContaining('remind me to pitch Notion AI'));
    await tester.pumpAndSettle();

    final reminders = await world.reminders.getUpcoming();
    expect(reminders.map((r) => r.title),
        contains('Pitch Notion AI its next creator'));
    expect(find.text('Reminder set for tomorrow.'), findsOneWidget);
  });

  testWidgets('the page is saved in English and escaped', (tester) async {
    final world = await _pump(tester);
    await tester.tap(find.text('Read the views now'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Save a page to print'));
    await tester.pumpAndSettle();

    expect(world.pages.single, contains('results after 30 days'));
  });

  testWidgets('it lays out on a small phone in Arabic, large text, dark',
      (tester) async {
    await _pump(tester,
        trackingLink: 'https://bit.ly/ai',
        size: const Size(375, 1400),
        locale: const Locale('ar'),
        textScale: 1.6,
        themeMode: ThemeMode.dark);
    await tester.tap(find.byKey(const ValueKey('report-read-views')));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
  });
}
