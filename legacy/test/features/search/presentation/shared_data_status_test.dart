import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/features/search/application/pipeline_warmup_controller.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/shared_data_status.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The line above the Start button that says whether the team's shared data
/// has already been fetched in the background.
///
/// Worth testing because it is the *only* thing telling anyone that the
/// fifty-second download which used to happen at Start still happens at all.
/// A wrong state here does not break a search — it just tells somebody a run
/// will begin immediately when it is about to spend a minute downloading, or
/// the other way round.
class _FixedWarmup extends PipelineWarmupNotifier {
  _FixedWarmup(this.initial);

  final PipelineWarmupState initial;

  @override
  PipelineWarmupState build() => initial;

  // No process, ever: these tests are about what the line says.
  @override
  void warmInBackground({Duration delay = const Duration(seconds: 2)}) {}

  @override
  Future<void> refresh({bool force = false}) async {}
}

Widget _harness(PipelineWarmupState warmup) {
  return ProviderScope(
    overrides: [
      pipelineWarmupProvider.overrideWith(() => _FixedWarmup(warmup)),
    ],
    child: const MaterialApp(
      localizationsDelegates: [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: SharedDataStatus()),
    ),
  );
}

void main() {
  testWidgets('a pull in flight says a search started now will wait for it',
      (tester) async {
    await tester.pumpWidget(
      _harness(const PipelineWarmupState(status: PipelineWarmupStatus.running)),
    );
    await tester.pump();

    expect(find.textContaining('waits a few seconds'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    // Nothing to refresh while a refresh is already happening.
    expect(find.text('Refresh now'), findsNothing);
  });

  testWidgets('a pull that just landed reads as up to date', (tester) async {
    await tester.pumpWidget(
      _harness(PipelineWarmupState(
        status: PipelineWarmupStatus.ready,
        completedAt: DateTime.now(),
      )),
    );
    await tester.pump();

    expect(find.textContaining('up to date'), findsOneWidget);
  });

  testWidgets('an older pull shows its real age rather than rounding to fresh',
      (tester) async {
    await tester.pumpWidget(
      _harness(PipelineWarmupState(
        status: PipelineWarmupStatus.ready,
        completedAt: DateTime.now().subtract(const Duration(minutes: 40)),
      )),
    );
    await tester.pump();

    expect(find.textContaining('40 min ago'), findsOneWidget);
  });

  testWidgets('nothing tried yet says the refresh happens before you search',
      (tester) async {
    await tester.pumpWidget(
      _harness(const PipelineWarmupState(status: PipelineWarmupStatus.idle)),
    );
    await tester.pump();

    expect(find.textContaining('before you search'), findsOneWidget);
  });

  testWidgets('a failed pull says the search will do it, not that it broke',
      (tester) async {
    await tester.pumpWidget(
      _harness(const PipelineWarmupState(
        status: PipelineWarmupStatus.failed,
        error: "'python' is not recognized",
      )),
    );
    await tester.pump();

    expect(find.textContaining('fetch it itself'), findsOneWidget);
  });

  testWidgets('a build with no local pipeline shows nothing at all',
      (tester) async {
    await tester.pumpWidget(
      _harness(
        const PipelineWarmupState(status: PipelineWarmupStatus.unavailable),
      ),
    );
    await tester.pump();

    expect(find.byType(Text), findsNothing);
  });
}
