import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/server_address_fields.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _shipped = SupabaseConfig(
  url: 'https://shipped.supabase.co',
  anonKey: 'eyJshipped_anon_key_value_9f3c',
);

const _custom = SupabaseConfig(
  url: 'https://custom.supabase.co',
  anonKey: 'eyJcustom_anon_key_value_77aa',
);

const _urlKey = 'gratovo.supabase.url';
const _anonKey = 'gratovo.supabase.anonKey';

Future<void> _pump(
  WidgetTester tester, {
  required SupabaseConfig running,
  SupabaseConfig shipped = _shipped,
}) async {
  tester.view.physicalSize = const Size(900, 1400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        supabaseBootProvider.overrideWithValue(SupabaseBoot(config: running)),
        shippedSupabaseConfigProvider.overrideWithValue(shipped),
      ],
      child: const MaterialApp(
        localizationsDelegates: [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: SingleChildScrollView(child: ServerAddressFields()),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

bool _enabled(WidgetTester tester, String key) =>
    tester.widget<ButtonStyleButton>(find.byKey(Key(key))).onPressed != null;

String _status(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const Key('server-status'))).data!;

Future<void> _settleToasts(WidgetTester tester) async {
  // AppToast schedules its own dismissal; let it run out so no timer is
  // left pending when the test ends.
  await tester.pump(const Duration(seconds: 10));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('at the shipped values: says so, nothing to reset or save',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    await _pump(tester, running: _shipped);

    expect(find.text('https://shipped.supabase.co'), findsWidgets);
    // The key is shown masked under the fields, never in full.
    expect(find.text('eyJs…9f3c', findRichText: true), findsNothing);
    expect(
      find.textContaining('eyJs…9f3c', findRichText: true),
      findsOneWidget,
    );
    expect(_status(tester), 'Using the defaults this build shipped with.');
    expect(_enabled(tester, 'server-reset'), isFalse);
    expect(_enabled(tester, 'server-save'), isFalse);
  });

  testWidgets('typing marks the fields unsaved; typing it back does not',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    await _pump(tester, running: _shipped);

    final url = find.byType(TextField).first;
    await tester.enterText(url, _custom.url);
    await tester.pump();
    expect(_status(tester), 'Unsaved changes.');
    expect(_enabled(tester, 'server-save'), isTrue);
    expect(_enabled(tester, 'server-reset'), isTrue);

    await tester.enterText(url, _shipped.url);
    await tester.pump();
    expect(_enabled(tester, 'server-save'), isFalse);
    expect(_enabled(tester, 'server-reset'), isFalse);
  });

  testWidgets('saving a different server asks for a restart', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await _pump(tester, running: _shipped);

    await tester.enterText(find.byType(TextField).first, _custom.url);
    await tester.pump();
    await tester.tap(find.byKey(const Key('server-save')));
    await tester.pumpAndSettle();

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(_urlKey), _custom.url);
    // The key was left as shipped, so nothing is stored for it.
    expect(prefs.containsKey(_anonKey), isFalse);
    expect(_status(tester), 'Restart the app to use these values.');
    expect(_enabled(tester, 'server-save'), isFalse);
    await _settleToasts(tester);
  });

  testWidgets('reset goes back to the shipped pair and drops the override',
      (tester) async {
    SharedPreferences.setMockInitialValues({
      _urlKey: _custom.url,
      _anonKey: _custom.anonKey,
    });
    await _pump(tester, running: _custom);

    expect(_status(tester), 'This computer uses its own values.');
    expect(_enabled(tester, 'server-reset'), isTrue);

    await tester.tap(find.byKey(const Key('server-reset')));
    await tester.pumpAndSettle();

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.containsKey(_urlKey), isFalse);
    expect(prefs.containsKey(_anonKey), isFalse);
    final fields = tester.widgetList<TextField>(find.byType(TextField));
    expect(fields.map((f) => f.controller!.text), [
      _shipped.url,
      _shipped.anonKey,
    ]);
    // This process still talks to the custom server: the reset only takes
    // effect after a restart, and the card says so.
    expect(_status(tester), 'Restart the app to use these values.');
    expect(_enabled(tester, 'server-reset'), isFalse);
    await _settleToasts(tester);
  });

  testWidgets('a stored copy of the shipped values can still be cleared',
      (tester) async {
    SharedPreferences.setMockInitialValues({
      _urlKey: _shipped.url,
      _anonKey: _shipped.anonKey,
    });
    await _pump(tester, running: _shipped);

    expect(_enabled(tester, 'server-reset'), isTrue);
    await tester.tap(find.byKey(const Key('server-reset')));
    await tester.pumpAndSettle();

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.containsKey(_urlKey), isFalse);
    // Nothing the next launch uses changed, so no restart is asked for.
    expect(find.text('Restart the app to use these values.'), findsNothing);
    expect(_status(tester), 'Using the defaults this build shipped with.');
    await _settleToasts(tester);
  });

  testWidgets('a build that shipped no server says so and offers to clear',
      (tester) async {
    SharedPreferences.setMockInitialValues({_urlKey: _custom.url});
    await _pump(
      tester,
      running: _custom,
      shipped: const SupabaseConfig(url: '', anonKey: ''),
    );

    expect(
      find.text('This build shipped without a server address. '
          'Enter one above.'),
      findsOneWidget,
    );
    expect(find.text('Clear saved values'), findsOneWidget);
    expect(find.text('Reset to defaults'), findsNothing);
  });
}
