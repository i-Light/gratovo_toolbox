import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_conflict_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/conflicts/presentation/conflicts_screen.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

Widget _harness({String? channelId}) {
  return ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      // A fresh repository per harness, so a test that resolves the seeded
      // conflict cannot leave the next one with an empty page.
      conflictRepositoryProvider
          .overrideWith((ref) => MockConflictRepository()),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: ConflictsScreen(channelId: channelId),
    ),
  );
}

void _sizeTo(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets('shows both versions and what they started from', (tester) async {
    _sizeTo(tester, const Size(1400, 2400));

    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Notes on Tech With Taha'), findsOneWidget);

    // Both people are named, because "your version lost" is only answerable if
    // you can see whose it lost to.
    expect(find.text('Sara wrote'), findsOneWidget);
    expect(find.text('Omar wrote'), findsOneWidget);

    expect(find.textContaining('two-week lead time'), findsWidgets);
    expect(find.textContaining('2x his usual rate'), findsWidgets);
    // The shared base, which is what makes the two versions legible as
    // branches rather than as two unrelated paragraphs.
    expect(find.textContaining('Both started from'), findsOneWidget);
  });

  testWidgets('keeping one version settles the conflict', (tester) async {
    _sizeTo(tester, const Size(1400, 2400));

    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(find.text('Keep this one'), findsNWidgets(2));

    // The first is Sara's — theirs is shown before mine.
    await tester.tap(find.text('Keep this one').first);
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    // It leaves the open section and turns up in the settled one, rather than
    // disappearing — the other person needs to find out what happened to their
    // text somewhere.
    expect(find.text('Keep this one'), findsNothing);
    expect(find.textContaining('Settled by'), findsOneWidget);
  });

  testWidgets('a free-text conflict offers a hand-written third answer',
      (tester) async {
    _sizeTo(tester, const Size(1400, 2400));

    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    await tester.tap(find.text('Write something else'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    // Seeded with both paragraphs, because for notes the usual right answer is
    // that both additions survive and the person only has to tidy them.
    final field = tester.widget<TextField>(find.byType(TextField).last);
    expect(field.controller!.text, contains('two-week lead time'));
    expect(field.controller!.text, contains('2x his usual rate'));
  });

  testWidgets('narrowing to a channel with no conflicts says so',
      (tester) async {
    _sizeTo(tester, const Size(1400, 2400));

    await tester.pumpWidget(_harness(channelId: 'inf_999'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('No conflicts.'), findsOneWidget);
    expect(find.text('Sara wrote'), findsNothing);
  });

  testWidgets('lays out on a phone-width window', (tester) async {
    _sizeTo(tester, const Size(390, 2400));

    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Sara wrote'), findsOneWidget);
  });
}
