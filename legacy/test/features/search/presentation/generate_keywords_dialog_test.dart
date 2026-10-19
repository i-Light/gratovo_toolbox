import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/generate_keywords_dialog.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_gemini_bridge.dart';

Widget _harness(FakeGeminiBridge bridge, Widget child) => ProviderScope(
      overrides: [geminiBridgeProvider.overrideWithValue(bridge)],
      child: MaterialApp(
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: child),
      ),
    );

/// Pumps the dialog directly, with what the keyword box and the search
/// history would have handed it.
Future<List<String>> _openDialog(
  WidgetTester tester,
  FakeGeminiBridge bridge, {
  List<String> current = const [],
  List<String> searched = const [],
}) async {
  tester.view.physicalSize = const Size(1200, 1400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final added = <String>[];
  await tester.pumpWidget(_harness(
    bridge,
    GenerateKeywordsDialog(
      currentKeywords: current,
      alreadySearched: searched,
      onAdd: added.addAll,
    ),
  ));
  await tester.pumpAndSettle();
  return added;
}

Future<void> _generate(WidgetTester tester,
    {String topic = 'ai agents'}) async {
  await tester.enterText(find.widgetWithText(TextField, 'Topic'), topic);
  await tester.tap(find.widgetWithText(FilledButton, 'Generate'));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('sends topic, count, exclusions, styles and the avoid list',
      (tester) async {
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState())
      ..answer('action.generate_keywords', {
        'keywords': ['how to build ai agents at home'],
        'dropped': 0,
      });
    await _openDialog(
      tester,
      bridge,
      current: ['ai agents tutorial'],
      searched: ['best ai agent frameworks 2026', 'ai agents tutorial'],
    );
    expect(
      find.textContaining('Avoiding 3 keywords'),
      findsOneWidget,
    );

    await tester.enterText(find.widgetWithText(TextField, 'How many'), '40');
    await tester.enterText(
      find.widgetWithText(TextField, 'Exclude'),
      'music, crypto\nnft',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Phrasing styles'),
      'how to, best',
    );
    await tester.enterText(find.widgetWithText(TextField, 'Language'), 'en');
    await _generate(tester);

    final call = bridge.lastCall('action.generate_keywords');
    expect(call, isNotNull);
    expect(call!.params['topic'], 'ai agents');
    expect(call.params['count'], 40);
    expect(call.params['exclusions'], ['music', 'crypto', 'nft']);
    expect(call.params['styles'], ['how to', 'best']);
    expect(call.params['language'], 'en');
    expect(call.params['avoid'], [
      'ai agents tutorial',
      'best ai agent frameworks 2026',
      'ai agents tutorial',
    ]);
    expect(bridge.prepareCount, 1);
    // The saved number of separate chats (4 unless changed); no keywords gem
    // set, none sent.
    expect(call.params['chats'], 4);
    expect(call.params.containsKey('gem'), isFalse);
  });

  testWidgets(
      'one chat is the plain single-chat request, and the choice is '
      'remembered for next time', (tester) async {
    SharedPreferences.setMockInitialValues({'gratovo.gemini.keywordChats': 2});
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState())
      ..answer('action.generate_keywords', {
        'keywords': ['ai agents for small business'],
      });
    await _openDialog(tester, bridge);
    final field = find.widgetWithText(TextField, 'Separate chats');
    expect(tester.widget<TextField>(field).controller!.text, '2');

    await tester.enterText(field, '1');
    await _generate(tester);
    final call = bridge.lastCall('action.generate_keywords')!;
    expect(call.params.containsKey('chats'), isFalse);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getInt('gratovo.gemini.keywordChats'), 1);
  });

  testWidgets('separate chats and the keywords gem from Settings are sent',
      (tester) async {
    SharedPreferences.setMockInitialValues({
      'gratovo.gemini.keywordsGem': 'https://gemini.google.com/gem/kw123456',
    });
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState())
      ..answer('action.generate_keywords', {
        'keywords': ['ai agents for small business'],
      });
    await _openDialog(tester, bridge);
    await tester.enterText(
        find.widgetWithText(TextField, 'Separate chats'), '12');
    await _generate(tester);

    final call = bridge.lastCall('action.generate_keywords')!;
    expect(call.params['chats'], 8, reason: "clamped to the daemon's 1–8");
    expect(call.params['gem'], 'https://gemini.google.com/gem/kw123456');
  });

  testWidgets('a multi-chat batch shows how far it has got', (tester) async {
    final bridge = FakeGeminiBridge(
      initialState: connectedGeminiState(),
      latency: const Duration(seconds: 2),
    )..answer('action.generate_keywords', {
        'keywords': ['ai agents explained'],
        'chats': [
          {'index': 0, 'requested': 25, 'received': 25, 'ok': true},
        ],
      });
    await _openDialog(tester, bridge);
    await tester.enterText(
        find.widgetWithText(TextField, 'Separate chats'), '4');
    await tester.enterText(find.widgetWithText(TextField, 'Topic'), 'ai');
    await tester.tap(find.widgetWithText(FilledButton, 'Generate'));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.textContaining('Asking Gemini'), findsOneWidget);

    bridge.emitProgress(const GeminiProgress(
        action: 'generate_keywords', done: 2, total: 4, keywords: 37));
    // Another action's progress is not this dialog's.
    bridge.emitProgress(
        const GeminiProgress(action: 'draft_email', done: 1, total: 1));
    await tester.pump();
    expect(find.text('Chat 2 of 4 done · 37 keywords so far'), findsOneWidget);
    final bar = tester
        .widget<LinearProgressIndicator>(find.byType(LinearProgressIndicator));
    expect(bar.value, 0.5);

    await tester.pumpAndSettle(const Duration(seconds: 3));
    expect(find.text('ai agents explained'), findsOneWidget);
  });

  testWidgets('a partial batch says which chats failed and keeps the rest',
      (tester) async {
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState())
      ..answer('action.generate_keywords', {
        'keywords': ['ai agents explained', 'ai agents for kids'],
        'partial': true,
        'chats': [
          {'index': 0, 'requested': 25, 'received': 2, 'ok': true},
          {
            'index': 1,
            'requested': 25,
            'received': 0,
            'ok': false,
            'error': {'code': 'TIMEOUT', 'message': 'no answer in 240 s'},
          },
        ],
      });
    await _openDialog(tester, bridge);
    await _generate(tester);

    expect(find.text('1 of 2 chats failed — showing what the others found.'),
        findsOneWidget);
    expect(find.text('Chat 2: no answer in 240 s'), findsOneWidget);
    expect(find.text('ai agents for kids'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Add 2 to list'), findsOneWidget);
  });

  testWidgets('a blank topic is refused before anything is sent',
      (tester) async {
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState());
    await _openDialog(tester, bridge);

    await tester.tap(find.widgetWithText(FilledButton, 'Generate'));
    await tester.pumpAndSettle();

    expect(find.text('A topic is required.'), findsOneWidget);
    expect(bridge.callCount('action.generate_keywords'), 0);
  });

  testWidgets('known phrases are greyed and unticked; Add hands over the rest',
      (tester) async {
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState())
      ..answer('action.generate_keywords', {
        'keywords': [
          'how to build ai agents at home',
          'AI Agents Tutorial',
          'best ai agent frameworks for beginners',
        ],
        'dropped': 2,
      });
    final added = await _openDialog(
      tester,
      bridge,
      current: ['ai agents tutorial'],
    );
    await _generate(tester);

    expect(
        find.text('2 new phrases · 3 already known or dropped as duplicates.'),
        findsOneWidget);
    // The one already in the box (case-insensitively) cannot be ticked.
    final known = tester.widget<CheckboxListTile>(
      find.widgetWithText(CheckboxListTile, 'AI Agents Tutorial'),
    );
    expect(known.enabled, isFalse);
    expect(known.value, isFalse);
    expect(
        find.text('Already in the list or already searched'), findsOneWidget);

    // Untick one of the two new ones.
    await tester.tap(
      find.widgetWithText(CheckboxListTile, 'how to build ai agents at home'),
    );
    await tester.pumpAndSettle();
    expect(find.widgetWithText(FilledButton, 'Add 1 to list'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'Add 1 to list'));
    await tester.pumpAndSettle();
    expect(added, ['best ai agent frameworks for beginners']);
    expect(find.byType(GenerateKeywordsDialog), findsNothing);
  });

  testWidgets('a parse failure reads as code and message, with Retry',
      (tester) async {
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState())
      ..failWith(
        'action.generate_keywords',
        'ACTION_PARSE_FAILED',
        'Gemini answered with prose, not a list.',
      )
      ..answer('action.generate_keywords', {
        'keywords': ['ai agent memory explained simply'],
      });
    await _openDialog(tester, bridge);
    await _generate(tester);

    expect(
      find.textContaining(
        'ACTION_PARSE_FAILED: Gemini answered with prose, not a list.',
      ),
      findsOneWidget,
    );
    expect(find.textContaining('Exception'), findsNothing);

    await tester.tap(find.widgetWithText(FilledButton, 'Retry'));
    await tester.pumpAndSettle();
    expect(bridge.callCount('action.generate_keywords'), 2);
    expect(find.text('ai agent memory explained simply'), findsOneWidget);
  });

  testWidgets('a bridge problem points at Settings', (tester) async {
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState())
      ..failWith(
        'action.generate_keywords',
        'EXTENSION_NOT_CONNECTED',
        'No extension is connected.',
      );
    await _openDialog(tester, bridge);
    await _generate(tester);

    expect(
      find.textContaining('Fix this in Settings → Gemini in browser.'),
      findsOneWidget,
    );
  });

  group('GenerateKeywordsButton', () {
    Widget button(FakeGeminiBridge bridge) => _harness(
          bridge,
          GenerateKeywordsButton(controller: TextEditingController()),
        );

    testWidgets('is absent where there is no bridge', (tester) async {
      await tester.pumpWidget(button(FakeGeminiBridge(available: false)));
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.auto_awesome), findsNothing);
    });

    testWidgets(
        'is disabled with a reason while no extension is connected and the '
        'app may not open a window itself', (tester) async {
      SharedPreferences.setMockInitialValues({
        'gratovo.gemini.autoOpenWindow': false,
      });
      await tester.pumpWidget(button(FakeGeminiBridge(
        initialState: const GeminiBridgeState.listening(port: 8765),
      )));
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.auto_awesome), findsOneWidget);
      expect(
        find.byTooltip(
          'The Gemini extension is not connected — see Settings → Gemini in browser.',
        ),
        findsOneWidget,
      );
    });

    testWidgets(
        'is enabled with no extension connected when the app opens the '
        'window itself (the default)', (tester) async {
      await tester.pumpWidget(button(FakeGeminiBridge(
        initialState: const GeminiBridgeState.listening(port: 8765),
      )));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Generate keywords with Gemini'), findsOneWidget);
    });

    testWidgets('opens the dialog when connected', (tester) async {
      await tester.pumpWidget(button(
        FakeGeminiBridge(initialState: connectedGeminiState()),
      ));
      await tester.pumpAndSettle();
      expect(
        find.byTooltip('Generate keywords with Gemini'),
        findsOneWidget,
      );
      await tester.tap(find.byIcon(Icons.auto_awesome));
      await tester.pumpAndSettle();
      expect(find.byType(GenerateKeywordsDialog), findsOneWidget);
    });
  });
}
