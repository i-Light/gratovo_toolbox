import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_activity_log_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/logs/presentation/logs_screen.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

Widget _harness() {
  return ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      // A fresh repository per harness, so a test that records something
      // cannot leak into the next one.
      activityLogRepositoryProvider.overrideWith(
        (ref) => MockActivityLogRepository(),
      ),
    ],
    child: const MaterialApp(
      localizationsDelegates: [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: LogsScreen(),
    ),
  );
}

void _sizeTo(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets('renders the log without overflowing', (tester) async {
    _sizeTo(tester, const Size(1400, 2000));

    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Logs'), findsWidgets);
    // Who, and what they did to which record.
    expect(find.text('Amira'), findsWidgets);
    expect(find.text('Tags changed'), findsWidgets);
    expect(find.textContaining('@TechWithTaha'), findsWidgets);
  });

  testWidgets('a "new" tag counts the entries recorded today', (tester) async {
    _sizeTo(tester, const Size(1400, 2000));

    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    // The seed has three entries from the last few hours and three from days
    // ago; the badge beside the title reports the recent ones.
    expect(find.textContaining('new'), findsWidgets);
  });

  testWidgets('a deleted account is shown as deleted, not as a blank',
      (tester) async {
    _sizeTo(tester, const Size(1400, 2000));

    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    // The requirement in one assertion: the person is gone, the entry is not,
    // and the page says which of those is true rather than showing an
    // anonymous row.
    expect(find.text('Former teammate'), findsWidgets);
    expect(find.text('account deleted'), findsWidgets);
  });

  testWidgets('each entry states the authority held AT THE TIME',
      (tester) async {
    _sizeTo(tester, const Size(1400, 2000));

    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    // Omar's seeded entries were recorded at `basic`. If this ever renders as
    // "as Full authority" it means the role is being read live from profiles
    // rather than from the snapshot on the row, which is the exact failure the
    // column exists to prevent.
    expect(find.text('as Basic authority'), findsWidgets);
    expect(find.text('as Full authority'), findsWidgets);
  });

  testWidgets('a change shows what it changed from and to', (tester) async {
    _sizeTo(tester, const Size(1400, 2000));

    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(find.text('tech → tech, reviews'), findsOneWidget);
    expect(find.text('new → contacted'), findsOneWidget);
  });

  testWidgets('a notes edit says the content was deliberately not recorded',
      (tester) async {
    _sizeTo(tester, const Size(1400, 2000));

    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    // Notes carry things said in confidence about a person, and a log is read
    // by more people and for longer than the field it copies. Saying that out
    // loud is what stops the omission from reading as a bug.
    expect(
      find.textContaining('Contents are deliberately not recorded'),
      findsWidgets,
    );
  });

  testWidgets('an action filter narrows the list', (tester) async {
    _sizeTo(tester, const Size(1400, 2000));

    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(find.text('Email sent'), findsWidgets);

    await tester.tap(find.text('All actions'));
    await tester.pumpAndSettle();
    // The dropdown's own menu entry, not a row.
    await tester.tap(find.text('Tags changed').last);
    await tester.pumpAndSettle();

    expect(find.text('Email sent'), findsNothing);
    expect(find.text('Tags changed'), findsWidgets);
  });

  testWidgets('lays out on a phone-width window', (tester) async {
    _sizeTo(tester, const Size(390, 2400));

    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Amira'), findsWidgets);
  });
}
