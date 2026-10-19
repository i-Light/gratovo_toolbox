import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/gemini_bridge_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

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
        home: Scaffold(
          body: SingleChildScrollView(
            child: GeminiBridgeCard(
              titleColors: LinearGradient(colors: [Colors.white, Colors.white]),
            ),
          ),
        ),
      ),
    );

/// The card starts folded; every test opens it first.
Future<void> _open(WidgetTester tester, FakeGeminiBridge bridge) async {
  tester.view.physicalSize = const Size(1200, 2600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(_harness(bridge));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Gemini in browser'));
  await tester.pumpAndSettle();
}

Map<String, Object?> _diagnostics({required bool sendFound}) => {
      'url': 'https://gemini.google.com/app',
      'elements': {
        'promptBox': {
          'found': true,
          'strategy': 'css#1',
          'tried': [
            {
              'strategy': 'css#1',
              'matched': 1,
              'visible': 1,
              'describe': "css 'rich-textarea'"
            },
          ],
          'element': {
            'tag': 'rich-textarea',
            'rect': {'x': 1, 'y': 2, 'w': 3, 'h': 4}
          },
        },
        'sendButton': {
          'found': sendFound,
          'strategy': sendFound ? 'attr#1' : null,
          'tried': [
            {
              'strategy': 'attr#1',
              'matched': 0,
              'visible': 0,
              'describe': 'attr aria-label ~ /send/i'
            },
            {
              'strategy': 'icon#2',
              'matched': 2,
              'visible': 0,
              'describe': 'icon ~ /send/'
            },
          ],
          'lastKnown': {
            'strategy': 'attr#1',
            'at': 1758300000000,
            'element': {
              'tag': 'button',
              'aria': 'Send message',
              'classes': 'send-button'
            },
          },
          'suggestions': [
            {
              'strategy': {
                'type': 'attr',
                'attr': 'aria-label',
                'match': 'submit'
              },
              'candidate': {
                'tag': 'button',
                'aria': 'Submit',
                'classes': 'submit-button'
              },
              'reason': 'same icon, aria changed',
            },
            {
              'strategy': {'type': 'css', 'value': 'button.submit-button'},
            },
          ],
        },
      },
    };

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('shows the connected account, model and the extension folder',
      (tester) async {
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState());
    await _open(tester, bridge);

    // Chip in the header and the status line in the body both say who.
    expect(
      find.textContaining(
          'Connected as Moustafa Khaled (moustafa@example.com)'),
      findsWidgets,
    );
    expect(find.textContaining('Model: 2.5 Pro'), findsOneWidget);
    // Firefox (the default) gets its add-on from the app: no folder to load.
    expect(find.byIcon(Icons.copy_outlined), findsNothing);
    // Up, so the button offers Stop rather than Start.
    expect(find.widgetWithText(FilledButton, 'Stop'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Start'), findsNothing);
  });

  testWidgets(
      'the signed-in account is shown and can be pinned for actions in one '
      'click; the account field follows', (tester) async {
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState());
    await _open(tester, bridge);

    expect(
      find.text('Signed in as Moustafa Khaled (moustafa@example.com)'),
      findsOneWidget,
    );
    await tester.tap(find.text('Use moustafa@example.com for actions'));
    await tester.pumpAndSettle();

    final container = ProviderScope.containerOf(
      tester.element(find.byType(GeminiBridgeCard)),
    );
    expect(
      container.read(geminiBridgeSettingsProvider).accountMatch,
      'moustafa@example.com',
    );
    expect(find.text('Use moustafa@example.com for actions'), findsNothing);
    expect(find.text('Actions use moustafa@example.com.'), findsOneWidget);
    expect(
      find.widgetWithText(TextFormField, 'moustafa@example.com'),
      findsOneWidget,
      reason: 'a field nobody is editing shows the value saved from above',
    );
  });

  testWidgets('with the browser closed the last account seen is still shown',
      (tester) async {
    SharedPreferences.setMockInitialValues({
      'gratovo.gemini.lastAccountName': 'Ana',
      'gratovo.gemini.lastAccountEmail': 'ana@example.com',
    });
    await _open(tester, FakeGeminiBridge());

    expect(
      find.text('Last seen signed in: Ana (ana@example.com)'),
      findsOneWidget,
    );
  });

  testWidgets(
      'Save writes only the fields edited here: saved values that loaded or '
      'were remembered after the card was built survive', (tester) async {
    SharedPreferences.setMockInitialValues({
      'gratovo.gemini.accountMatch': 'ana@example.com',
    });
    await _open(tester, FakeGeminiBridge());
    final container = ProviderScope.containerOf(
      tester.element(find.byType(GeminiBridgeCard)),
    );
    // The loaded value is in its field, not the default it was built with.
    expect(
      find.widgetWithText(TextFormField, 'ana@example.com'),
      findsOneWidget,
    );

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Keywords gem URL'),
      'https://gemini.google.com/gem/kw',
    );
    // The account memory writes while the edit is pending.
    await container.read(geminiBridgeSettingsProvider.notifier).edit(
          (s) => s.copyWith(
            lastAccountName: 'Ana',
            lastAccountEmail: 'ana@example.com',
          ),
        );
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();

    final saved = container.read(geminiBridgeSettingsProvider);
    expect(saved.keywordsGem, 'https://gemini.google.com/gem/kw');
    expect(saved.accountMatch, 'ana@example.com');
    expect(saved.lastAccountEmail, 'ana@example.com');
    expect(saved.lastAccountName, 'Ana');
  });

  testWidgets(
      'choosing Edge saves at once and offers the extension folder as one '
      'copy button', (tester) async {
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState());
    await _open(tester, bridge);

    await tester.tap(find.text('Firefox (recommended)'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Microsoft Edge').last);
    await tester.pumpAndSettle();

    final container = ProviderScope.containerOf(
      tester.element(find.byType(GeminiBridgeCard)),
    );
    expect(
      container.read(geminiBridgeSettingsProvider).browser,
      GeminiBrowserKind.edge,
    );
    final copy = find.byIcon(Icons.copy_outlined);
    expect(copy, findsOneWidget);
    final tooltip = tester.widget<IconButton>(
      find.ancestor(of: copy, matching: find.byType(IconButton)),
    );
    expect(tooltip.tooltip, contains(r'C:\gratovo\pipeline\gemini_extension'));
  });

  testWidgets('Detect browsers lists what is installed and the add-on state',
      (tester) async {
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState())
      ..answerBrowserInfo(const GeminiBrowserInfo(
        selected: 'firefox',
        browsers: [
          GeminiBrowserEntry(
            id: 'firefox',
            name: 'Mozilla Firefox',
            version: '156.0',
            channel: 'release',
            installed: true,
          ),
          GeminiBrowserEntry(id: 'chrome', name: 'Google Chrome'),
        ],
        addon: GeminiAddonStatus(state: GeminiAddonState.temporary),
      ));
    await _open(tester, bridge);

    await tester.tap(find.widgetWithText(OutlinedButton, 'Detect browsers'));
    await tester.pumpAndSettle();

    expect(bridge.calls.single.method, 'bridge.browser_info');
    expect(bridge.calls.single.params['browser'], 'firefox');
    expect(find.text('Mozilla Firefox 156.0 · release'), findsOneWidget);
    expect(find.textContaining('Google Chrome'), findsNothing,
        reason: 'only installed browsers are listed');
    expect(find.textContaining('Add-on: added for this browser session'),
        findsOneWidget);
  });

  testWidgets('Start brings the bridge up; Stop takes it down', (tester) async {
    final bridge = FakeGeminiBridge();
    await _open(tester, bridge);
    expect(find.text('Stopped'), findsWidgets);

    await tester.tap(find.widgetWithText(FilledButton, 'Start'));
    await tester.pumpAndSettle();
    expect(bridge.state.isConnected, isTrue);
    expect(find.widgetWithText(FilledButton, 'Stop'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'Stop'));
    await tester.pumpAndSettle();
    expect(bridge.wasStopped, isTrue);
    expect(find.widgetWithText(FilledButton, 'Start'), findsOneWidget);
  });

  testWidgets('Test lays out bridge.status as readable facts', (tester) async {
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState())
      ..answer('bridge.status', {
        'listening': true,
        'port': 8765,
        'extensionConnected': true,
        'status': {
          'account': {
            'name': 'Moustafa Khaled',
            'email': 'moustafa@example.com'
          },
          'model': {'name': '2.5 Pro'},
          'signedOut': false,
        },
      });
    await _open(tester, bridge);

    await tester.tap(find.widgetWithText(OutlinedButton, 'Test'));
    await tester.pumpAndSettle();

    expect(bridge.callCount('bridge.status'), 1);
    expect(find.text('Daemon listening on port 8765'), findsOneWidget);
    expect(find.text('Extension connected'), findsOneWidget);
    expect(
      find.text('Account: Moustafa Khaled (moustafa@example.com)'),
      findsOneWidget,
    );
    expect(find.text('Signed in'), findsOneWidget);
  });

  testWidgets('a failed Test reads as code and message, never an exception',
      (tester) async {
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState())
      ..failWith('bridge.status', 'UNAVAILABLE', 'python was not found');
    await _open(tester, bridge);

    await tester.tap(find.widgetWithText(OutlinedButton, 'Test'));
    await tester.pumpAndSettle();

    expect(
      find.textContaining('UNAVAILABLE: python was not found'),
      findsOneWidget,
    );
    expect(find.textContaining('GeminiBridgeException'), findsNothing);
  });

  testWidgets('Save writes the fields to the settings provider',
      (tester) async {
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState());
    await _open(tester, bridge);

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Keywords gem URL'),
      'https://gemini.google.com/gem/abc',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Default model'),
      'Pro',
    );
    await tester.enterText(find.widgetWithText(TextFormField, 'Port'), '9000');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();

    final element = tester.element(find.byType(GeminiBridgeCard));
    final settings =
        ProviderScope.containerOf(element).read(geminiBridgeSettingsProvider);
    expect(settings.keywordsGem, 'https://gemini.google.com/gem/abc');
    expect(settings.defaultModel, 'Pro');
    expect(settings.port, 9000);
  });

  testWidgets(
      'diagnostics: a missing element shows tried, last known and '
      'suggestions; Apply fix heals and re-runs', (tester) async {
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState())
      ..answer('diagnostics', _diagnostics(sendFound: false))
      ..answer('diagnostics', _diagnostics(sendFound: true))
      ..answer('bridge.heal', {
        'element': 'sendButton',
        'strategy': {'type': 'attr', 'attr': 'aria-label', 'match': 'submit'},
      });
    await _open(tester, bridge);

    await tester.tap(find.widgetWithText(FilledButton, 'Run diagnostics'));
    await tester.pumpAndSettle();

    expect(find.text('1 of 2 elements missing.'), findsOneWidget);
    expect(find.text('promptBox'), findsOneWidget);
    expect(find.text('Found by: css#1'), findsOneWidget);
    expect(find.text('sendButton'), findsOneWidget);
    // The missing one opens by itself with everything the resolver knows.
    expect(
      find.text('attr aria-label ~ /send/i — 0 matched, 0 visible'),
      findsOneWidget,
    );
    expect(find.text('How it used to be found'), findsOneWidget);
    expect(find.textContaining("button.send-button aria='Send message'"),
        findsOneWidget);
    expect(find.text('attr aria-label ~ /submit/'), findsOneWidget);
    expect(find.text('same icon, aria changed'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Apply fix'), findsNWidgets(2));

    await tester.tap(find.widgetWithText(FilledButton, 'Apply fix').first);
    await tester.pumpAndSettle();

    final heal = bridge.lastCall('bridge.heal');
    expect(heal, isNotNull);
    expect(heal!.params, {'element': 'sendButton', 'pick': 0});
    expect(bridge.callCount('diagnostics'), 2);
    expect(find.text('All 2 elements found.'), findsOneWidget);
    expect(find.text('Found by: attr#1'), findsOneWidget);
    expect(find.text('Copy JSON'), findsOneWidget);
  });

  testWidgets('diagnostics failure is shown as code and message',
      (tester) async {
    final bridge = FakeGeminiBridge(initialState: connectedGeminiState())
      ..failWith(
        'diagnostics',
        'EXTENSION_NOT_CONNECTED',
        'No extension is connected.',
      );
    await _open(tester, bridge);

    await tester.tap(find.widgetWithText(FilledButton, 'Run diagnostics'));
    await tester.pumpAndSettle();

    expect(
      find.textContaining(
        'EXTENSION_NOT_CONNECTED: No extension is connected.',
      ),
      findsOneWidget,
    );
  });

  testWidgets(
      'while the daemon opens the window it says so: starting the browser, '
      'adding the add-on, then nothing once the browser is up', (tester) async {
    final bridge = FakeGeminiBridge();
    await _open(tester, bridge);
    expect(find.byKey(const ValueKey('gemini-window-activity')), findsNothing);

    // The event arrives on a stream (a microtask), so the card rebuilds on
    // the frame after; the spinner never settles, so no pumpAndSettle.
    Future<void> settleEvent(WidgetTester tester) async {
      await tester.pump();
      await tester.pump();
    }

    GeminiEvent daemon(String state) => GeminiEvent(
          event: 'daemon',
          data: {'state': state, 'browser': 'firefox', 'message': '…'},
        );
    bridge.emit(daemon('browser_launching'));
    await settleEvent(tester);
    expect(find.text('Starting Firefox…'), findsOneWidget);

    bridge.emit(daemon('addon_installing'));
    await settleEvent(tester);
    expect(find.text('Adding the Gemini add-on…'), findsOneWidget);

    bridge.emit(daemon('browser_ready'));
    await settleEvent(tester);
    expect(find.byKey(const ValueKey('gemini-window-activity')), findsNothing);
  });
}
