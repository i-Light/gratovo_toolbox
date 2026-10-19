import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/generate_keywords_dialog.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/keyword_input.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_gemini_bridge.dart';

const _desktop = AppCapabilities(
  isDesktopDevice: true,
  isNative: true,
  canRunSearch: true,
  canEditSearchInputs: true,
  canTuneScrapingSettings: true,
);

/// The keyword box's header is where "Generate keywords" lives — offered
/// between runs only, because a run rewrites the list as each keyword ends.
Future<void> _pump(WidgetTester tester, {required bool running}) async {
  tester.view.physicalSize = const Size(1000, 700);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final controller = KeywordListController(text: 'ai agents');
  addTearDown(controller.dispose);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      capabilitiesProvider.overrideWithValue(_desktop),
      geminiBridgeProvider.overrideWithValue(
        FakeGeminiBridge(initialState: connectedGeminiState()),
      ),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: SizedBox(
          height: 500,
          child: KeywordInput(
            controller: controller,
            keywordCount: 1,
            isRunning: running,
          ),
        ),
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('between runs the keyword box offers Generate keywords',
      (tester) async {
    await _pump(tester, running: false);
    expect(find.byType(GenerateKeywordsButton), findsOneWidget);
    expect(find.byTooltip('Generate keywords with Gemini'), findsOneWidget);
  });

  testWidgets('during a run it is not offered', (tester) async {
    await _pump(tester, running: true);
    expect(find.byType(GenerateKeywordsButton), findsNothing);
  });
}
