// Settings -> Agency facts: the shared agency_settings row (fix #9, HC-07,
// HC-09, decision daily-target).
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/presence/live_data_service.dart';
import 'package:gratovo_toolbox/data/models/agency_settings.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_agency_settings_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/settings/application/agency_settings_controller.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/agency_facts_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

Future<MockAgencySettingsRepository> _pump(WidgetTester tester,
    {AgencySettings? saved}) async {
  tester.view.physicalSize = const Size(1000, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final repository = MockAgencySettingsRepository();
  if (saved != null) await repository.save(saved);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      agencySettingsRepositoryProvider.overrideWithValue(repository),
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
      home: Scaffold(
        body: SingleChildScrollView(child: AgencyFactsCard()),
      ),
    ),
  ));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Agency facts'));
  await tester.pumpAndSettle();
  return repository;
}

Finder _field(String key) => find.byKey(ValueKey('agency-$key'));

void main() {
  test('a teammate\'s change to the agency row refreshes the card', () {
    expect(domainsForTables({'agency_settings'}), {DataDomain.agency});
    expect(domainsForTables({'comms_proposals'}), {DataDomain.comms});
  });

  test('saving through the controller stores and re-reads', () async {
    final repository = MockAgencySettingsRepository();
    final container = ProviderContainer(overrides: [
      agencySettingsRepositoryProvider.overrideWithValue(repository),
    ]);
    addTearDown(container.dispose);

    expect(await container.read(agencySettingsProvider.future),
        const AgencySettings());
    await container
        .read(agencySettingsProvider.notifier)
        .save(const AgencySettings(name: 'Gratovo'));

    expect((await repository.get()).name, 'Gratovo');
    expect(
        (await container.read(agencySettingsProvider.future)).name, 'Gratovo');
  });

  testWidgets('an unsaved agency shows the owner\'s house defaults',
      (tester) async {
    await _pump(tester);

    expect(tester.widget<TextFormField>(_field('countries')).controller!.text,
        'IL');
    expect(
        tester.widget<TextFormField>(_field('target')).controller!.text, '50');
    expect(tester.widget<SwitchListTile>(_field('incubator')).value, isTrue);
  });

  testWidgets('the facts are typed in and saved for the whole team',
      (tester) async {
    final repository = await _pump(tester);

    await tester.enterText(_field('name'), 'Gratovo');
    await tester.enterText(_field('sender'), 'Moustafa');
    await tester.enterText(
        _field('claims'), 'We are a small agency.\n\nWe work only in AI.\n');
    await tester.enterText(_field('brands'), 'Wix\nSodaStream');
    await tester.enterText(_field('countries'), 'il, ');
    await tester.enterText(_field('target'), '40');
    await tester.tap(_field('incubator'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    final saved = await repository.get();
    expect(saved.name, 'Gratovo');
    expect(saved.sender, 'Moustafa');
    expect(saved.trueClaims, ['We are a small agency.', 'We work only in AI.']);
    expect(saved.boycottBrands, ['Wix', 'SodaStream']);
    expect(saved.boycottCountries, ['IL']);
    expect(saved.dailyTarget, 40);
    expect(saved.incubator, isFalse);
  });

  testWidgets('a target outside 1-500 is refused and nothing is saved',
      (tester) async {
    final repository = await _pump(tester);

    await tester.enterText(_field('name'), 'Gratovo');
    await tester.enterText(_field('target'), '0');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(find.text('Enter a whole number from 1 to 500.'), findsOneWidget);
    expect((await repository.get()).name, '');
  });

  testWidgets('a country code that is not two letters is refused',
      (tester) async {
    final repository = await _pump(tester);

    await tester.enterText(_field('countries'), 'Israel');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(find.text('Use two-letter country codes, like IL.'), findsOneWidget);
    expect(await repository.get(), const AgencySettings());
  });

  testWidgets('saved facts are shown when the card opens', (tester) async {
    await _pump(tester,
        saved: const AgencySettings(
            name: 'Gratovo', trueClaims: ['A', 'B'], dailyTarget: 30));

    expect(tester.widget<TextFormField>(_field('name')).controller!.text,
        'Gratovo');
    expect(tester.widget<TextFormField>(_field('claims')).controller!.text,
        'A\nB');
    expect(
        tester.widget<TextFormField>(_field('target')).controller!.text, '30');
  });

  testWidgets('the open card lays out on a small phone with large text',
      (tester) async {
    tester.view.physicalSize = const Size(375, 2600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(ProviderScope(
      overrides: [
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
        locale: Locale('ar'),
        home: MediaQuery(
          data: MediaQueryData(textScaler: TextScaler.linear(1.6)),
          child: Scaffold(
            body: SingleChildScrollView(child: AgencyFactsCard()),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('بيانات الوكالة'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(_field('target'), findsOneWidget);
  });
}
