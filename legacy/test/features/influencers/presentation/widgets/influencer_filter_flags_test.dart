// The list's quick filters (fix #10): has email, sponsored, shortlisted,
// ready to pitch.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_filter_controller.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_page_controller.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/influencer_filter_sheet.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

void main() {
  testWidgets('a quick filter narrows the list and can be turned off again',
      (tester) async {
    tester.view.physicalSize = const Size(900, 1600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        influencerCountriesProvider.overrideWith((ref) async => const []),
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
        home: Scaffold(body: InfluencerFilterSheet()),
      ),
    ));
    await tester.pumpAndSettle();
    final container = ProviderScope.containerOf(
        tester.element(find.byType(InfluencerFilterSheet)));

    expect(find.text('Show only'), findsOneWidget);
    for (final label in [
      'Has an email',
      'Sponsored before',
      'Shortlisted',
      'Ready to pitch',
    ]) {
      expect(find.widgetWithText(FilterChip, label), findsOneWidget);
    }

    await tester.tap(find.widgetWithText(FilterChip, 'Ready to pitch'));
    await tester.tap(find.widgetWithText(FilterChip, 'Has an email'));
    await tester.pumpAndSettle();
    expect(container.read(influencerFilterProvider).requireFlags,
        {InfluencerFlag.readyToPitch, InfluencerFlag.hasEmail});

    await tester.tap(find.widgetWithText(FilterChip, 'Ready to pitch'));
    await tester.pumpAndSettle();
    expect(container.read(influencerFilterProvider).requireFlags,
        {InfluencerFlag.hasEmail});
  });
}
