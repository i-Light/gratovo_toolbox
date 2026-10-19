import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/archived_channel.dart';
import 'package:gratovo_toolbox/data/models/bulk_archive_due.dart';
import 'package:gratovo_toolbox/data/models/bulk_rejection.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/keyword_view_sample.dart';
import 'package:gratovo_toolbox/data/repositories/archive_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/archive/presentation/widgets/bulk_clean_dialog.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The bulk clean, which is the most destructive control in the app.
///
/// What is worth pinning is not that it works — it is the shape of the flow:
/// you cannot reach the confirm button without a count from the database, and
/// editing any bound, on either range, takes the button away again. Most tests
/// here are about that order, because the failure mode is not an exception, it
/// is a person tagging four thousand channels against a number that described a
/// different range.
void main() {
  late _RecordingArchiveRepository repo;

  Widget harness() {
    return ProviderScope(
      overrides: [archiveRepositoryProvider.overrideWithValue(repo)],
      child: MaterialApp(
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: ElevatedButton(
                onPressed: () => showBulkCleanDialog(context),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// Types a bound and settles. The settle is not optional: every edit
  /// invalidates the last count and rebuilds the buttons, and a test that taps
  /// Check before that lands taps a button that is still disabled.
  Future<void> setBound(
    WidgetTester tester,
    String label,
    String value,
  ) async {
    await tester.enterText(find.widgetWithText(TextField, label), value);
    await tester.pumpAndSettle();
  }

  Future<void> check(WidgetTester tester) async {
    await tester.tap(find.widgetWithText(OutlinedButton, 'Check the range'));
    await tester.pumpAndSettle();
  }

  Future<void> open(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1200, 1600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(harness());
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  setUp(() => repo = _RecordingArchiveRepository());

  testWidgets('no bounds at all cannot even be checked', (tester) async {
    // The database refuses this too. Refusing it here as well means the person
    // is told why by a hint under the fields rather than by an error toast.
    await open(tester);

    expect(find.text('Set at least one end of one range.'), findsOneWidget);
    final check = tester.widget<OutlinedButton>(
      find.widgetWithText(OutlinedButton, 'Check the range'),
    );
    expect(check.onPressed, isNull);
    expect(repo.calls, isEmpty);
  });

  testWidgets('an average-views bound alone is enough to check',
      (tester) async {
    // The second range stands on its own. A channel with 80,000 subscribers
    // whose videos do 300 views is exactly the one a subscriber sweep cannot
    // reach, so requiring a subscriber bound alongside would defeat it.
    await open(tester);

    await setBound(tester, 'To (median views)', '500');
    await check(tester);

    expect(repo.calls.single.request.maxMedianViews, 500);
    expect(repo.calls.single.request.maxSubscribers, isNull);
    expect(find.widgetWithText(FilledButton, 'Tag 12'), findsOneWidget);
  });

  testWidgets('both ranges are carried through to the applied request',
      (tester) async {
    await open(tester);

    await setBound(tester, 'From (subscribers)', '100');
    await setBound(tester, 'To (subscribers)', '1000');
    await setBound(tester, 'From (median views)', '10');
    await setBound(tester, 'To (median views)', '500');
    await check(tester);

    await tester.tap(find.widgetWithText(FilledButton, 'Tag 12'));
    await tester.pumpAndSettle();

    final applied = repo.calls.last.request;
    expect(applied.minSubscribers, 100);
    expect(applied.maxSubscribers, 1000);
    expect(applied.minMedianViews, 10);
    expect(applied.maxMedianViews, 500);
  });

  testWidgets('editing an average-views bound also takes the count away',
      (tester) async {
    // The same rule as the subscriber bounds, and it has to be: a count that
    // described "any average views" must not sit under a button that would act
    // on "under 500".
    await open(tester);
    await setBound(tester, 'To (subscribers)', '1000');
    await check(tester);
    expect(find.widgetWithText(FilledButton, 'Tag 12'), findsOneWidget);

    await setBound(tester, 'To (median views)', '500');
    await tester.pumpAndSettle();

    expect(find.widgetWithText(FilledButton, 'Tag 12'), findsNothing);
    expect(find.text('12 channels match'), findsNothing);
  });

  testWidgets('the confirm button does not exist until the range is checked',
      (tester) async {
    await open(tester);

    await setBound(tester, 'To (subscribers)', '1000');
    await tester.pumpAndSettle();

    // Enabled now, but still nothing to confirm.
    expect(find.widgetWithText(FilledButton, 'Tag 12'), findsNothing);

    await check(tester);

    expect(find.text('12 channels match'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Tag 12'), findsOneWidget);
    expect(repo.calls.single.dryRun, isTrue,
        reason: 'checking must never write');
  });

  testWidgets('the skipped counts are shown, not summarised away',
      (tester) async {
    await open(tester);
    await setBound(tester, 'To (subscribers)', '1000');
    await check(tester);

    expect(
      find.textContaining('already tagged and counting down'),
      findsOneWidget,
    );
    expect(
      find.textContaining('there are deals or outreach histories'),
      findsOneWidget,
    );
    // The one that would otherwise be invisible: a channel missing a number the
    // ranges need is in NO range, which is not the same as being outside them.
    expect(
      find.textContaining('missing a number these ranges need'),
      findsOneWidget,
    );
  });

  testWidgets('editing the range takes the confirm button away',
      (tester) async {
    await open(tester);
    await setBound(tester, 'To (subscribers)', '1000');
    await check(tester);
    expect(find.widgetWithText(FilledButton, 'Tag 12'), findsOneWidget);

    // A count that described "under 1,000" must not sit under a button that
    // would act on "under 10,000".
    await setBound(tester, 'To (subscribers)', '10000');
    await tester.pumpAndSettle();

    expect(find.widgetWithText(FilledButton, 'Tag 12'), findsNothing);
    expect(find.text('12 channels match'), findsNothing);
  });

  testWidgets('turning on immediate deletion also invalidates the count',
      (tester) async {
    // Same range, but a different act: fifteen days out versus gone now. The
    // person has to look at the number again knowing which one they are agreeing
    // to.
    await open(tester);
    await setBound(tester, 'To (subscribers)', '1000');
    await check(tester);

    // Right after a check, the button offers to run it again.
    expect(find.widgetWithText(OutlinedButton, 'Re-check'), findsOneWidget);

    await tester.tap(find.byType(Checkbox));
    await tester.pumpAndSettle();

    expect(find.widgetWithText(FilledButton, 'Tag 12'), findsNothing);
    // Back to the un-checked state, label and all: the previous count did not
    // describe this act.
    expect(
        find.widgetWithText(OutlinedButton, 'Check the range'), findsOneWidget);

    await check(tester);

    // And the confirm button now says what it does, rather than "Tag".
    expect(find.widgetWithText(FilledButton, 'Delete 12 now'), findsOneWidget);
  });

  testWidgets('confirming sends the real request and returns the outcome',
      (tester) async {
    await open(tester);
    await setBound(tester, 'From (subscribers)', '100');
    await setBound(tester, 'To (subscribers)', '1000');
    await check(tester);

    await tester.tap(find.widgetWithText(FilledButton, 'Tag 12'));
    await tester.pumpAndSettle();

    expect(repo.calls, hasLength(2));
    final applied = repo.calls.last;
    expect(applied.dryRun, isFalse);
    expect(applied.request.minSubscribers, 100);
    expect(applied.request.maxSubscribers, 1000);
    expect(applied.request.label, ChannelTag.irrelevant);
    expect(applied.request.immediate, isFalse);
    // Dismissed, so the page behind it knows to refresh.
    expect(find.byType(AlertDialog), findsNothing);
  });

  testWidgets('the label choice is carried through', (tester) async {
    await open(tester);
    await setBound(tester, 'To (subscribers)', '1000');
    await tester.tap(find.byType(DropdownButtonFormField<ChannelTag>));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Haram stuff').last);
    await tester.pumpAndSettle();

    await check(tester);
    await tester.tap(find.widgetWithText(FilledButton, 'Tag 12'));
    await tester.pumpAndSettle();

    expect(repo.calls.last.request.label, ChannelTag.haramStuff);
  });

  testWidgets('a range that matches nothing offers no confirm button',
      (tester) async {
    repo.matched = 0;
    await open(tester);
    await setBound(tester, 'To (subscribers)', '1');
    await check(tester);

    expect(find.text('No channel matches this range'), findsOneWidget);
    expect(find.byType(FilledButton), findsNothing);
  });

  testWidgets('a refused request says so instead of pretending',
      (tester) async {
    // What a `basic` account would see if it reached this dialog: the database
    // refuses it, and the dialog reports the refusal rather than showing zero.
    repo.throws = true;
    await open(tester);
    await setBound(tester, 'To (subscribers)', '1000');
    await check(tester);

    expect(find.text("Couldn't run the bulk clean."), findsOneWidget);
    expect(find.byType(FilledButton), findsNothing);
  });

  testWidgets('and says what actually went wrong, not only that it did',
      (tester) async {
    // The sentence above is the same one for a refused permission, a rejected
    // range and a statement Postgres cancelled for running too long -- three
    // problems, three different answers, and for a long time this dialog was
    // the only place any of them surfaced and it showed none of them. The raw
    // exception goes underneath it.
    repo.throws = true;
    await open(tester);
    await setBound(tester, 'To (subscribers)', '1000');
    await check(tester);

    expect(
      find.textContaining('only full authority may bulk-reject'),
      findsOneWidget,
    );
  });

  testWidgets('an immediate clean shows how far its deletions have got',
      (tester) async {
    // The deletions are batched -- they cannot be one request -- so a clean of
    // any real size is a minute of work after the confirm. A dialog that shows
    // nothing for that minute is one people kill halfway through.
    repo.sweepGate = Completer<void>();
    await open(tester);
    await setBound(tester, 'To (subscribers)', '1000');
    await tester.tap(find.text('Delete now, skipping the 7 days'));
    await tester.pumpAndSettle();
    await check(tester);
    await tester.tap(find.widgetWithText(FilledButton, 'Delete 12 now'));
    await tester.pump();

    expect(find.text('Deleting 5 of 12…'), findsOneWidget);

    repo.sweepGate!.complete();
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
  });

  testWidgets('a running clean can be closed, and can be stopped',
      (tester) async {
    // The state this replaces: every button disabled, nothing on screen saying
    // what was happening, and Escape the only key that did anything. Whatever
    // the server is doing, a modal has to be closable and a destructive loop
    // has to be stoppable.
    repo.sweepGate = Completer<void>();
    await open(tester);
    await setBound(tester, 'To (subscribers)', '1000');
    await tester.tap(find.text('Delete now, skipping the 7 days'));
    await tester.pumpAndSettle();
    await check(tester);
    await tester.tap(find.widgetWithText(FilledButton, 'Delete 12 now'));
    await tester.pump();

    expect(
      find.textContaining('This keeps running if you close it'),
      findsOneWidget,
    );

    await tester.tap(find.widgetWithText(TextButton, 'Stop'));
    await tester.pump();
    expect(
      find.textContaining('Stopping after this batch'),
      findsOneWidget,
    );

    // And out, while the sweep is still in flight.
    await tester.tap(find.widgetWithText(TextButton, 'Close'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);

    repo.sweepGate!.complete();
    await tester.pumpAndSettle();
  });
}

class _Call {
  const _Call(this.request, this.dryRun);
  final BulkRejectionRequest request;
  final bool dryRun;
}

class _RecordingArchiveRepository implements ArchiveRepository {
  final List<_Call> calls = [];
  int matched = 12;
  bool throws = false;

  /// Held open to freeze an immediate clean mid-sweep, the way a real one is
  /// frozen by a server working through a batch.
  Completer<void>? sweepGate;

  @override
  Future<BulkRejectionOutcome> bulkReject(
    BulkRejectionRequest request, {
    bool dryRun = true,
    void Function(int swept, int total)? onSweepProgress,
    bool Function()? shouldStop,
  }) async {
    calls.add(_Call(request, dryRun));
    if (throws) throw StateError('only full authority may bulk-reject');
    final gate = sweepGate;
    if (gate != null && !dryRun && request.immediate) {
      onSweepProgress?.call(5, matched);
      await gate.future;
    }
    return BulkRejectionOutcome(
      matched: matched,
      tagged: dryRun ? 0 : matched,
      archived: dryRun || !request.immediate ? 0 : matched,
      skippedAlreadyTagged: 3,
      skippedProtected: 2,
      skippedUnknownSize: 5,
    );
  }

  @override
  Future<int> count() async => 0;

  @override
  Future<Set<String>> archivedIdsAmong(List<String> channelIds) async =>
      const {};

  @override
  Future<List<ArchivedChannel>> getPage({
    required int offset,
    required int limit,
    ArchiveQuery query = const ArchiveQuery(),
  }) async =>
      const [];

  @override
  Future<List<ArchivedChannel>> getAll() async => const [];

  @override
  Future<List<KeywordViewSample>> keywordViewSamples() async => const [];

  @override
  Future<void> unarchive(String channelId) async {}

  @override
  Future<void> updateLabel(String channelId, ChannelTag label) async {}

  @override
  Future<BulkArchiveDueOutcome> bulkManageArchiveDue(
    BulkArchiveDueRequest request, {
    bool dryRun = true,
    void Function(int swept, int total)? onSweepProgress,
    bool Function()? shouldStop,
  }) async {
    return BulkArchiveDueOutcome(
      matched: matched,
      updated: dryRun ? 0 : matched,
      archived: 0,
      skippedProtected: 2,
      skippedUnknown: 5,
    );
  }
}
