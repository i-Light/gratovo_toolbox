import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_news_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/news/application/news_controller.dart';
import 'package:gratovo_toolbox/features/news/presentation/news_screen.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

Widget _harness(Widget child) {
  return ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      newsRepositoryProvider.overrideWithValue(MockNewsRepository()),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: child,
    ),
  );
}

void _sizeTo(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets('renders stories, newest first', (tester) async {
    _sizeTo(tester, const Size(1400, 1600));

    await tester.pumpWidget(_harness(const NewsScreen()));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(
      find.text('Creator fund payouts double for short-form video'),
      findsOneWidget,
    );
    expect(find.text('Industry news'), findsOneWidget);
  });

  testWidgets('shows a failing feed as failing, with its reason',
      (tester) async {
    // Wide enough for the sources panel, which is where a broken feed becomes
    // visible. Without it, a feed whose certificate expired looks exactly like
    // a feed with no news.
    _sizeTo(tester, const Size(1400, 1600));

    await tester.pumpWidget(_harness(const NewsScreen()));
    await tester.pumpAndSettle();

    expect(find.text('Digiday'), findsOneWidget);
    expect(
      find.textContaining('certificate has expired'),
      findsOneWidget,
    );
  });

  testWidgets('an undated story renders without claiming a date',
      (tester) async {
    _sizeTo(tester, const Size(1400, 1600));

    await tester.pumpWidget(_harness(const NewsScreen()));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('No date'), findsOneWidget);
  });

  testWidgets('filtering to a source with no stories says so', (tester) async {
    _sizeTo(tester, const Size(1400, 1600));

    late WidgetRef capturedRef;
    await tester.pumpWidget(
      _harness(
        Consumer(
          builder: (context, ref, _) {
            capturedRef = ref;
            return const NewsScreen();
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    // src_3 (Digiday) is the failing feed, so it has no stored stories.
    capturedRef.read(newsFilterProvider.notifier).showSource('src_3');
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    // Not the "nothing has ever been fetched" message, which names a command
    // the user does not need to run.
    expect(find.text('No stories from this source yet.'), findsOneWidget);
  });

  testWidgets('shows the "new since last fetch" badge, starting at zero',
      (tester) async {
    _sizeTo(tester, const Size(1400, 1600));

    await tester.pumpWidget(_harness(const NewsScreen()));
    await tester.pumpAndSettle();

    expect(find.byTooltip('New stories since the last fetch'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byTooltip('New stories since the last fetch'),
        matching: find.text('0'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('clearing the stored stories empties the list', (tester) async {
    SharedPreferences.setMockInitialValues({});
    _sizeTo(tester, const Size(1400, 1600));

    await tester.pumpWidget(_harness(const NewsScreen()));
    await tester.pumpAndSettle();
    expect(find.byType(NewsItemCard), findsWidgets);

    await tester.tap(find.byTooltip('Clear stored stories'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byType(NewsItemCard), findsNothing);
  });

  testWidgets('lays out on a phone-width window', (tester) async {
    // The narrow branch swaps the sources panel for niche chips. Worth its own
    // test: it is a different widget tree, not a reflow of the same one.
    _sizeTo(tester, const Size(390, 844));

    await tester.pumpWidget(_harness(const NewsScreen()));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('All niches'), findsOneWidget);
    expect(find.byType(NewsItemCard), findsWidgets);
  });
}
