import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/aws_gateway_settings.dart';
import 'package:gratovo_toolbox/data/models/search_tuning_settings.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/data/repositories/search_tuning_repository.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/search_tuning_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

class _RecordingRepo implements SearchTuningRepository {
  SearchTuningSettings? saved;

  @override
  Future<SearchTuningSettings> get() async => SearchTuningSettings.defaults;

  @override
  Future<void> update(SearchTuningSettings settings) async => saved = settings;
}

AwsGatewaySettings _gateways(int n) => AwsGatewaySettings(
      enabled: true,
      gateways: [
        for (var i = 0; i < n; i++)
          AwsGatewayEntry(region: 'r$i', apiId: 'id$i', url: 'https://g$i'),
      ],
    );

Future<_RecordingRepo> _pump(WidgetTester tester,
    {required int gateways}) async {
  tester.view.physicalSize = const Size(1000, 3000);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final repo = _RecordingRepo();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        searchTuningSettingsProvider
            .overrideWith((ref) async => SearchTuningSettings.defaults),
        awsGatewaySettingsProvider
            .overrideWith((ref) async => _gateways(gateways)),
        searchTuningRepositoryProvider.overrideWithValue(repo),
      ],
      child: const MaterialApp(
        localizationsDelegates: [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: SingleChildScrollView(child: SearchTuningCard())),
      ),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.text('Advanced Search Tuning'));
  await tester.pumpAndSettle();
  return repo;
}

String _status(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const Key('parallel-search-status'))).data!;

void main() {
  testWidgets('off by default; on with three gateways it says three at once',
      (tester) async {
    final repo = await _pump(tester, gateways: 3);

    final toggle = find.byKey(const Key('parallel-search-switch'));
    expect(tester.widget<Switch>(toggle).value, isFalse);
    expect(find.byKey(const Key('parallel-search-status')), findsNothing);

    await tester.ensureVisible(toggle);
    await tester.tap(toggle);
    await tester.pumpAndSettle();
    expect(_status(tester),
        'The next run works 3 keywords at a time, at the Normal speed.');

    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(repo.saved!.parallelSearchEnabled, isTrue);
  });

  testWidgets('with one gateway it says the switch changes nothing yet',
      (tester) async {
    await _pump(tester, gateways: 1);

    final toggle = find.byKey(const Key('parallel-search-switch'));
    await tester.ensureVisible(toggle);
    await tester.tap(toggle);
    await tester.pumpAndSettle();
    expect(
      _status(tester),
      'Needs at least two AWS gateways or proxies. With 1, runs stay one '
      'keyword at a time.',
    );
  });
}
