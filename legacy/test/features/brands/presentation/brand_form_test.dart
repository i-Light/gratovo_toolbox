// New brand / Edit brand (fix #5): several contacts (HC-25), country and
// category, and the boycott check (HC-09) said before anything is saved.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/agency_settings.dart';
import 'package:gratovo_toolbox/data/models/brand.dart';
import 'package:gratovo_toolbox/data/repositories/brand_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_agency_settings_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_brand_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/brands/presentation/widgets/brand_form_dialog.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

Future<BrandRepository> _pump(WidgetTester tester, {Brand? initial}) async {
  tester.view.physicalSize = const Size(1000, 1600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final brands = MockBrandRepository();
  final agency = MockAgencySettingsRepository();
  await agency.save(const AgencySettings(boycottBrands: ['Wix']));
  await tester.pumpWidget(ProviderScope(
    overrides: [
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
      home: Scaffold(
        body: Builder(
          builder: (context) => Center(
            child: FilledButton(
              onPressed: () => showBrandForm(context, initial: initial),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  ));
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return brands;
}

Finder _field(String key) => find.byKey(ValueKey('brand-$key'));

void main() {
  testWidgets('a new brand with two contacts is saved', (tester) async {
    final brands = await _pump(tester);
    final before = (await brands.getAll()).length;

    await tester.enterText(_field('name'), 'Runway');
    await tester.enterText(_field('country'), 'us');
    await tester.enterText(_field('category'), 'AI video');
    await tester.enterText(_field('contact-name-0'), 'Jack');
    await tester.enterText(_field('contact-email-0'), 'jack@runway.ml');
    await tester.tap(find.text('Add a contact'));
    await tester.pumpAndSettle();
    await tester.enterText(_field('contact-name-1'), 'Mia');
    await tester.enterText(_field('contact-email-1'), 'mia@runway.ml');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    final all = await brands.getAll();
    expect(all.length, before + 1);
    final saved = all.firstWhere((b) => b.name == 'Runway');
    expect(saved.country, 'US');
    expect(saved.category, 'AI video');
    expect(saved.contacts.map((c) => c.email),
        ['jack@runway.ml', 'mia@runway.ml']);
    expect(saved.contacts.first.isPrimary, isTrue,
        reason: 'the first contact is primary until somebody says otherwise');
  });

  testWidgets('a brand needs a name and a two-letter country', (tester) async {
    final brands = await _pump(tester);
    final before = (await brands.getAll()).length;

    await tester.enterText(_field('country'), 'USA');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(find.text('A brand needs a name.'), findsOneWidget);
    expect(find.text('Two letters, like US.'), findsOneWidget);
    expect((await brands.getAll()).length, before);
  });

  testWidgets('the boycott list is checked while typing', (tester) async {
    await _pump(tester);

    await tester.enterText(_field('name'), 'Wix.com');
    await tester.pumpAndSettle();
    expect(
        find.text('On the boycott list (Wix): no pitch and no creator for '
            'this brand.'),
        findsOneWidget);

    await tester.enterText(_field('name'), 'Startup');
    await tester.enterText(_field('country'), 'IL');
    await tester.pumpAndSettle();
    expect(
        find.text('Boycotted country (IL): no pitch and no creator for this '
            'brand.'),
        findsOneWidget);
  });

  testWidgets('editing starts from what is saved', (tester) async {
    final brands = await _pump(tester,
        initial: Brand(
          id: 'brand_001',
          name: 'NordVPN',
          createdAt: DateTime(2026),
          country: 'PA',
          contacts: const [
            BrandContact(
                name: 'Alex', email: 'alex@nord.example', isPrimary: true),
          ],
        ));

    expect(tester.widget<TextFormField>(_field('name')).controller!.text,
        'NordVPN');
    await tester.enterText(_field('category'), 'VPN');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    final saved = (await brands.getById('brand_001'))!;
    expect(saved.category, 'VPN');
    expect(saved.contacts.single.email, 'alex@nord.example');
  });
}
