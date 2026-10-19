import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/pipeline_warmup_controller.dart';
import 'package:gratovo_toolbox/features/search/presentation/search_screen.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/hermetic_search.dart';

/// The Search page while a run is going.
///
/// Driven through a stand-in notifier rather than a real process: what is
/// under test is the page reacting to run state, and launching Python from a
/// widget test is neither possible nor the point.
///
/// The first test earns its place twice over. It checks the counter, and it
/// checks that pushing run state through the screen does not throw — the
/// keyword box's controller notifies its own `EditableText` when the progress
/// changes, and doing that from inside `build` is the kind of error that only
/// shows up once a run is actually running.
/// The page's shared-data line asks for a background pull as it mounts, and
/// a real one launches `search.py --pull-only`. Neither the process nor its
/// timing is what these tests are about, so they get a notifier that reports
/// a pull already done and never starts one.
class _WarmPipeline extends PipelineWarmupNotifier {
  @override
  PipelineWarmupState build() => PipelineWarmupState(
        status: PipelineWarmupStatus.ready,
        completedAt: DateTime.now(),
      );

  @override
  void warmInBackground({Duration delay = const Duration(seconds: 2)}) {}

  @override
  Future<void> refresh({bool force = false}) async {}
}

class _FakeRun extends ActiveSearchRunNotifier {
  _FakeRun(this.initial);

  final SearchRun? initial;

  @override
  SearchRun? build() => initial;
}

SearchRun _run({
  required SearchRunStatus status,
  String? currentKeyword,
  int index = 0,
  List<String> completed = const [],
  int total = 3,
  List<String> active = const [],
  SearchRouteUsage? route,
}) {
  return SearchRun(
    id: 'test',
    keywords: const ['alpha', 'beta', 'gamma'],
    startedBy: 'This device',
    startedAt: DateTime.now(),
    status: status,
    keywordTotal: total,
    completedKeywords: completed,
    currentKeyword: currentKeyword,
    currentKeywordIndex: index,
    currentStep: 'Scanned 40 search result(s) — 12 channel(s) so far...',
    channelsFound: 12,
    activeKeywords: active,
    route: route,
  );
}

Widget _harness(SearchRun? run) {
  return ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      // A widget test reports itself as Android, so without this the page
      // renders the "you need the installed desktop app" notice instead of
      // any button at all. What is under test is the running/stopped states,
      // not the platform gate — that has its own reasoning in
      // app_capabilities.dart.
      capabilitiesProvider.overrideWithValue(
        const AppCapabilities(
          isDesktopDevice: true,
          isNative: true,
          canRunSearch: true,
          canEditSearchInputs: true,
          canTuneScrapingSettings: true,
        ),
      ),
      activeSearchRunControllerProvider.overrideWith(() => _FakeRun(run)),
      pipelineWarmupProvider.overrideWith(_WarmPipeline.new),
      // With no live run the panel reads the newest row of this machine's own
      // `gratovo.db`. On a developer's machine that row is often a run that is
      // still `running`, which paints a pulsing dot and a ticking clock that
      // `pumpAndSettle` can never outwait -- the two `_harness(null)` tests
      // below timed out there and passed on a clean checkout.
      ...hermeticSearchOverrides(),
    ],
    child: const MaterialApp(
      localizationsDelegates: [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: SearchScreen(),
    ),
  );
}

void _sizeTo(WidgetTester tester) {
  tester.view.physicalSize = const Size(1400, 2000);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

/// The saved keyword box, restored the way a real app start restores it.
void _saved({List<String> completed = const []}) {
  SharedPreferences.setMockInitialValues({
    'gratovo.search.keywordsText': ['alpha', 'beta', 'gamma'].join('\n'),
    'gratovo.search.completedKeywords': completed,
  });
}

void main() {
  testWidgets('the counter becomes a position while a run is going',
      (tester) async {
    _saved(completed: const ['alpha']);
    _sizeTo(tester);
    await tester.pumpWidget(
      _harness(_run(
        status: SearchRunStatus.running,
        currentKeyword: 'beta',
        index: 2,
        completed: const ['alpha'],
      )),
    );
    // Not pumpAndSettle: a running run has a one-second clock ticking in the
    // progress panel, and settling waits for a tree with no pending timers.
    await tester.pump();
    await tester.pump();

    expect(find.text('1/3 keywords'), findsOneWidget);
    expect(find.text('3 keywords'), findsNothing);
    expect(find.text('Keyword 2 of 3 — beta'), findsOneWidget);
    expect(
      find.text('Scanned 40 search result(s) — 12 channel(s) so far...'),
      findsOneWidget,
    );
    // Stop replaces Start for the duration.
    expect(find.text('Stop searching'), findsOneWidget);
    expect(find.text('Start searching'), findsNothing);
  });

  testWidgets('a stopped run puts the counter back to a plain total',
      (tester) async {
    _saved(completed: const ['alpha']);
    _sizeTo(tester);
    await tester.pumpWidget(
      _harness(_run(
        status: SearchRunStatus.stopped,
        completed: const ['alpha'],
      )),
    );
    await tester.pumpAndSettle();

    expect(find.text('3 keywords'), findsOneWidget);
    expect(find.textContaining('1/3'), findsNothing);
    expect(find.text('Stop searching'), findsNothing);
  });

  testWidgets('a part-finished list offers to resume where it stopped',
      (tester) async {
    _saved(completed: const ['alpha']);
    _sizeTo(tester);
    await tester.pumpWidget(
      _harness(_run(
        status: SearchRunStatus.stopped,
        completed: const ['alpha'],
      )),
    );
    await tester.pumpAndSettle();

    expect(find.text('Resume searching'), findsOneWidget);
    expect(find.text('Start from the top'), findsOneWidget);
    expect(
      find.text('1 of 3 done — Start resumes at “beta”.'),
      findsOneWidget,
    );
  });

  testWidgets('a finished keyword can be put back in the queue on its own',
      (tester) async {
    // The whole point of the sheet: before it, the only way out of "done" was
    // Start from the top, which drops every keyword's progress.
    _saved(completed: const ['alpha', 'beta']);
    _sizeTo(tester);
    await tester.pumpWidget(_harness(null));
    await tester.pumpAndSettle();

    expect(find.text('2 done'), findsOneWidget);
    await tester.tap(find.text('2 done'));
    await tester.pumpAndSettle();
    expect(find.text('Redo a finished keyword'), findsOneWidget);

    // Scoped to the sheet: "alpha" is also sitting in the keyword box behind.
    await tester.tap(
      find.descendant(of: find.byType(ListTile), matching: find.text('alpha')),
    );
    await tester.pumpAndSettle();

    // Still open on the one that is left, so reopening two is two taps rather
    // than two trips through the button.
    expect(find.text('Redo a finished keyword'), findsOneWidget);
    expect(
      find.descendant(of: find.byType(ListTile), matching: find.text('alpha')),
      findsNothing,
    );
    expect(find.text('1 done'), findsOneWidget);
  });

  testWidgets(
      'connections: AWS reads "in use" only once requests went through it',
      (tester) async {
    _saved();
    _sizeTo(tester);
    await tester.pumpWidget(_harness(_run(
      status: SearchRunStatus.running,
      currentKeyword: 'alpha',
      index: 1,
      route: const SearchRouteUsage(
        gateways: 3,
        proxies: 1,
        includesDirect: true,
        pacing: 'fast',
        awsRequests: 12,
        directRequests: 4,
        lastKind: 'aws',
        lastLabel: 'AWS Gateway 2 (eu-west-1)',
      ),
    )));
    await tester.pump();
    await tester.pump();

    expect(find.text('AWS in use · 12 requests'), findsOneWidget);
    // A proxy is configured but nothing has gone through one yet.
    expect(find.text('Proxies ready · not used yet'), findsOneWidget);
    expect(find.text('This computer · 4 requests'), findsOneWidget);
    expect(find.text('One keyword at a time · Fast speed'), findsOneWidget);
    expect(find.text('Last request through AWS Gateway 2 (eu-west-1)'),
        findsOneWidget);
  });

  testWidgets('connections: a gateway nothing went through is not "in use"',
      (tester) async {
    _saved();
    _sizeTo(tester);
    await tester.pumpWidget(_harness(_run(
      status: SearchRunStatus.running,
      route: const SearchRouteUsage(gateways: 2, directRequests: 7),
    )));
    await tester.pump();
    await tester.pump();

    expect(find.text('AWS ready · not used yet'), findsOneWidget);
    expect(find.textContaining('AWS in use'), findsNothing);
  });

  testWidgets('connections: without AWS or proxies it says so', (tester) async {
    _saved();
    _sizeTo(tester);
    await tester.pumpWidget(_harness(_run(
      status: SearchRunStatus.running,
      route: const SearchRouteUsage(directRequests: 9),
    )));
    await tester.pump();
    await tester.pump();

    expect(
      find.text('No AWS or proxies: every request goes out from this computer'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('route-last')), findsNothing);
  });

  testWidgets('parallel: the other keywords in flight are listed',
      (tester) async {
    _saved();
    _sizeTo(tester);
    await tester.pumpWidget(_harness(_run(
      status: SearchRunStatus.running,
      currentKeyword: 'gamma',
      index: 3,
      active: const ['alpha', 'beta', 'gamma'],
      route: const SearchRouteUsage(
        gateways: 3,
        workers: 3,
        parallel: true,
        awsRequests: 30,
      ),
    )));
    await tester.pump();
    await tester.pump();

    expect(find.text('Keyword 3 of 3 — gamma'), findsOneWidget);
    expect(find.text('Also running: alpha, beta'), findsOneWidget);
    expect(find.text('3 keywords at a time · Normal speed'), findsOneWidget);
  });

  testWidgets('with no run at all the page is just a keyword box and Start',
      (tester) async {
    _saved();
    _sizeTo(tester);
    await tester.pumpWidget(_harness(null));
    await tester.pumpAndSettle();

    expect(find.text('3 keywords'), findsOneWidget);
    expect(find.text('Start searching'), findsOneWidget);
    expect(find.text('Start from the top'), findsNothing);
  });
}
