// My Day asks for a 30-day report, and one click opens it (plan step 7).
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_brand_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_deal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_deliverable_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/thirty_day_report_dialog.dart';
import 'package:gratovo_toolbox/features/my_day/application/my_day_models.dart';
import 'package:gratovo_toolbox/features/my_day/application/my_day_provider.dart';
import 'package:gratovo_toolbox/features/my_day/presentation/my_day_section.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

void main() {
  testWidgets('a report-due item opens the report itself', (tester) async {
    final deliverables = MockDeliverableRepository();
    final video = await deliverables.create(Deliverable(
      id: '',
      dealId: 'deal_001',
      type: DeliverableType.integration,
      status: DeliverableStatus.published,
      publishedUrl: 'https://youtu.be/dQw4w9WgXcQ',
      publishedAt: DateTime.now().subtract(const Duration(days: 31)),
      createdAt: DateTime.utc(2026, 9),
      updatedAt: DateTime.utc(2026, 9),
    ));
    final item = MyDayItem(
      id: 'report_${video.id}',
      type: MyDayItemType.reportDue,
      urgency: MyDayUrgency.dueSoon,
      anchorAt: DateTime.now().subtract(const Duration(days: 1)),
      ownerId: null,
      dealId: 'deal_001',
      influencerId: 'inf_001',
      deliverableType: DeliverableType.integration,
      deliverableId: video.id,
    );

    await tester.pumpWidget(ProviderScope(
      overrides: [
        supabaseBootProvider.overrideWithValue(const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        )),
        myDayItemsProvider.overrideWith((ref) async => [item]),
        deliverableRepositoryProvider.overrideWithValue(deliverables),
        dealRepositoryProvider.overrideWithValue(MockDealRepository()),
        brandRepositoryProvider.overrideWithValue(MockBrandRepository()),
        influencerRepositoryProvider
            .overrideWithValue(MockInfluencerRepository()),
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
        home: Scaffold(body: SingleChildScrollView(child: MyDaySection())),
      ),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.textContaining('30-day report'));
    await tester.pumpAndSettle();

    expect(find.byType(ThirtyDayReportDialog), findsOneWidget);
    expect(find.text('Read the views now'), findsOneWidget);
  });
}
