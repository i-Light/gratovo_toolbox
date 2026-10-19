import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/gemini_bridge_status_dot.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

import '../../../support/fake_gemini_bridge.dart';

Widget _harness(FakeGeminiBridge bridge) => ProviderScope(
      overrides: [geminiBridgeProvider.overrideWithValue(bridge)],
      child: const MaterialApp(
        localizationsDelegates: [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: GeminiBridgeStatusDot()),
      ),
    );

void main() {
  testWidgets('nothing while stopped or where there is no bridge',
      (tester) async {
    await tester.pumpWidget(_harness(FakeGeminiBridge()));
    await tester.pumpAndSettle();
    expect(find.byType(Tooltip), findsNothing);

    await tester.pumpWidget(_harness(FakeGeminiBridge(available: false)));
    await tester.pumpAndSettle();
    expect(find.byType(Tooltip), findsNothing);
  });

  testWidgets(
      'a tick with the account once connected; an error mark on '
      'failure, following the bridge live', (tester) async {
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState());
    await tester.pumpWidget(_harness(bridge));
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.check_circle), findsOneWidget);
    expect(
      find.byTooltip(
        'Gemini in browser: Connected as Moustafa Khaled (moustafa@example.com)',
      ),
      findsOneWidget,
    );

    bridge.setState(const GeminiBridgeState.failed('python missing'));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.error), findsOneWidget);
    expect(find.byTooltip('Gemini in browser: Failed'), findsOneWidget);
  });
}
