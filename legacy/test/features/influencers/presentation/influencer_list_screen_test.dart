import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_filter_controller.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/influencer_list_screen.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Renders the real list screen against the mock repository.
///
/// This covers what `flutter analyze` cannot: that the providers are wired up,
/// that the paging notifier resolves, and that a row and a card both lay out
/// without overflowing. Those are the failures that only appear when the
/// widget tree is actually built.
Widget _harness(Widget child) {
  return ProviderScope(
    overrides: [
      // supabaseBootProvider throws by design unless main() overrides it, so
      // every test that pumps a real screen has to supply one. A boot with no
      // config is the right shape here: it puts the app in its
      // no-backend state, which is exactly when the mock repositories are
      // what the screen talks to.
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      // The screen's own default already resolves to the mock when there is no
      // session, but overriding explicitly means the test does not silently
      // depend on that fallback continuing to exist.
      influencerRepositoryProvider
          .overrideWithValue(MockInfluencerRepository()),
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

void main() {
  testWidgets('renders channels with their metrics and status tags',
      (tester) async {
    // Tall enough that the whole first page lays out, so an overflow anywhere
    // in a row would be reported rather than clipped off-screen.
    tester.view.physicalSize = const Size(1400, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(_harness(const InfluencerListScreen()));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    // Real names, not handles — the model widening is what made these
    // available to the row at all.
    expect(find.text('Tech With Taha'), findsOneWidget);
    expect(find.text('@TechWithTaha'), findsOneWidget);

    // The dynamic tag: the one seeded channel with a closed deal shows days
    // since it, and NOT its pipeline stage.
    expect(find.text('112d since deal'), findsOneWidget);
    expect(find.text('Paid'), findsNothing);

    // A channel with attempts but no deal shows the attempt count.
    expect(find.text('2 attempts'), findsOneWidget);
  });

  testWidgets('switching to cards keeps the same channels on screen',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(_harness(const InfluencerListScreen()));
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.grid_view));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Tech With Taha'), findsOneWidget);
  });

  testWidgets('a filter that matches nothing says so, not "no influencers yet"',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 2000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    late WidgetRef capturedRef;
    await tester.pumpWidget(
      _harness(
        Consumer(
          builder: (context, ref, _) {
            capturedRef = ref;
            return const InfluencerListScreen();
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    capturedRef
        .read(influencerFilterProvider.notifier)
        .toggleIncludeCountry('ZZ'); // no seeded channel is in ZZ
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    // The distinction that matters: "your filter is too narrow" calls for a
    // different action than "run a search to find some".
    expect(find.text('No channels match these filters.'), findsOneWidget);
    expect(
      find.textContaining('run a search to find some'),
      findsNothing,
    );
  });

  testWidgets('excluding a channel tag narrows the list', (tester) async {
    tester.view.physicalSize = const Size(1400, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    late WidgetRef capturedRef;
    await tester.pumpWidget(
      _harness(
        Consumer(
          builder: (context, ref, _) {
            capturedRef = ref;
            return const InfluencerListScreen();
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    final notifier = capturedRef.read(influencerFilterProvider.notifier);
    notifier.toggleExcludeChannelTag(ChannelTag.irrelevant);
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    // Pixel Plays is the one seeded channel tagged `irrelevant`, so excluding
    // that tag hides it while leaving an untagged channel visible.
    expect(find.text('Pixel Plays'), findsNothing);
    expect(find.text('Tech With Taha'), findsOneWidget);
  });

  testWidgets('the search can look in descriptions too, never nowhere',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 2000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    late WidgetRef capturedRef;
    await tester.pumpWidget(
      _harness(
        Consumer(
          builder: (context, ref, _) {
            capturedRef = ref;
            return const InfluencerListScreen();
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    Set<InfluencerSearchScope> scopes() =>
        capturedRef.read(influencerFilterProvider).searchIn;
    expect(scopes(), {InfluencerSearchScope.names});

    await tester.tap(find.byKey(const Key('influencer-search-scope')));
    await tester.pumpAndSettle();
    await tester
        .tap(find.byKey(const Key('search-scope-videoDescriptions')).first);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('search-scope-names')).first);
    await tester.pumpAndSettle();
    expect(scopes(), {InfluencerSearchScope.videoDescriptions});

    // The last place left stays ticked.
    await tester
        .tap(find.byKey(const Key('search-scope-videoDescriptions')).first);
    await tester.pumpAndSettle();
    expect(scopes(), {InfluencerSearchScope.videoDescriptions});
    expect(tester.takeException(), isNull);
  });
}
