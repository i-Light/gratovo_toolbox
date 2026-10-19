import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/toast/toast_overlay.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/email_library_providers.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/sqlite_email_library_repository.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/copy_range_dialog.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

import '../../data/repositories/email_library/memory_local_db.dart';

void main() {
  late MemoryLocalDb db;
  late SqliteEmailLibraryRepository repository;

  setUp(() {
    db = MemoryLocalDb();
    repository = SqliteEmailLibraryRepository(db);
  });

  tearDown(() => db.close());

  Future<void> seed({
    required String id,
    required String subject,
    required String body,
    required String context,
    required String critique,
    DateTime? videoDate,
    int? timecodeSeconds,
    List<String> stageTagIds = const [],
  }) {
    return repository.saveRecord(
      EmailRecord(
        id: id,
        audience: EmailAudience.influencer,
        subject: subject,
        body: body,
        context: context,
        critique: critique,
        videoDate: videoDate,
        timecodeSeconds: timecodeSeconds,
        stageTagIds: stageTagIds,
        createdAt: DateTime.utc(2026, 1, 1),
        updatedAt: DateTime.utc(2026, 1, 1),
      ),
    );
  }

  /// The text in one segment of one end's date field. Both ends carry the
  /// editor's video-date field, so its segment keys appear twice — the end's
  /// own key is what tells them apart.
  String box(WidgetTester tester, String end, String segment) {
    final field = find.descendant(
      of: find.byKey(ValueKey('copyRange.$end')),
      matching: find.byKey(ValueKey('videoDate.$segment')),
    );
    if (segment == 'month') {
      return tester
          .widget<Text>(find.descendant(of: field, matching: find.byType(Text)))
          .data!;
    }
    return tester
        .widget<TextField>(
          find.descendant(of: field, matching: find.byType(TextField)),
        )
        .controller!
        .text;
  }

  /// Spins the wheel over one segment. Negative dy is a scroll up, which counts
  /// the segment up.
  Future<void> spin(
    WidgetTester tester,
    String end,
    String segment,
    double dy,
  ) async {
    final pointer = TestPointer(1, PointerDeviceKind.mouse);
    final centre = tester.getCenter(
      find.descendant(
        of: find.byKey(ValueKey('copyRange.$end')),
        matching: find.byKey(ValueKey('videoDate.$segment')),
      ),
    );
    await tester.sendEventToBinding(pointer.hover(centre));
    await tester.sendEventToBinding(pointer.scroll(Offset(0, dy)));
    await tester.pumpAndSettle();
  }

  Future<void> pumpDialog(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1400, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [emailLibraryDbProvider.overrideWithValue(db)],
        child: MaterialApp(
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          // Mounted the same way app.dart mounts it, so a toast raised by
          // the dialog under test (e.g. a failed clipboard write) actually
          // renders instead of only updating provider state unseen.
          builder: (context, child) => ToastOverlay(child: child!),
          home: const Scaffold(
            body: CopyRangeDialog(audience: EmailAudience.influencer),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
      'the preview shows date, timecode, critique length, recency '
      'and tags — and none of the email itself', (tester) async {
    await seed(
      id: 'a',
      subject: 'A subject nobody should see here',
      body: 'A body nobody should see here',
      context: 'Context nobody should see here',
      critique: 'Four words of critique',
      videoDate: DateTime(2025, 6, 12),
      timecodeSeconds: 2462,
      stageTagIds: const ['stage-follow-up'],
    );

    await pumpDialog(tester);

    // Shown.
    expect(find.textContaining('Jun 12, 2025'), findsOneWidget);
    expect(find.textContaining('41:02'), findsOneWidget);
    expect(find.text('4 words of critique'), findsOneWidget);
    expect(find.text('Never copied'), findsOneWidget);
    expect(find.text('Follow-up'), findsOneWidget);

    // Not shown — this is the whole point of the preview.
    expect(
        find.textContaining('A subject nobody should see here'), findsNothing);
    expect(find.textContaining('A body nobody should see here'), findsNothing);
    expect(find.textContaining('Context nobody should see here'), findsNothing);
    expect(find.textContaining('Four words of critique'), findsNothing);
  });

  testWidgets('records with no video date are left out of every range',
      (tester) async {
    await seed(
      id: 'dated',
      subject: 's',
      body: 'b',
      context: 'c',
      critique: 'one two three',
      videoDate: DateTime(2025, 6, 12),
    );
    await seed(
      id: 'dateless',
      subject: 's2',
      body: 'b2',
      context: 'c2',
      critique: 'four five six seven',
      // No video date.
    );

    await pumpDialog(tester);

    expect(find.text('1 record'), findsOneWidget);
    expect(find.text('3 words of critique'), findsOneWidget);
    expect(find.text('4 words of critique'), findsNothing);
  });

  testWidgets('the summary counts what is worth a second look', (tester) async {
    await seed(
      id: 'ok',
      subject: 's',
      body: 'b',
      context: 'c',
      critique: 'a real teardown here',
      videoDate: DateTime(2025, 6, 12),
    );
    await seed(
      id: 'empty',
      subject: 's2',
      body: 'b2',
      context: 'c2',
      critique: '',
      videoDate: DateTime(2025, 6, 13),
    );
    await repository.markRecordsCopied(['ok'], DateTime.now().toUtc());

    await pumpDialog(tester);

    expect(
      find.text('2 records  ·  1 copied before  ·  1 with no critique'),
      findsOneWidget,
    );
    expect(find.text('Copied today'), findsOneWidget);
    expect(find.text('No critique'), findsOneWidget);
  });

  testWidgets('copying writes the payload and stamps the records',
      (tester) async {
    // The real clipboard is not available in a test binding, so intercept the
    // platform channel and keep what the dialog tried to write.
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = (call.arguments as Map)['text'] as String?;
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );

    await seed(
      id: 'a',
      subject: 'Collab?',
      body: 'Hi @receiver, saw your video.',
      context: 'First contact.',
      critique: 'Fan energy in the opener.',
      videoDate: DateTime(2025, 6, 12),
    );

    await pumpDialog(tester);
    await tester.tap(find.text('Copy 1 record'));
    await tester.pumpAndSettle();

    // The payload carries the brief and the full record — the preview hides
    // the email, the clipboard must not.
    expect(copied, isNotNull);
    expect(copied, startsWith('# Build an outreach handbook'));
    expect(copied, contains('Collab?'));
    expect(copied, contains('Hi @receiver, saw your video.'));
    expect(copied, contains('First contact.'));
    expect(copied, contains('Fan energy in the opener.'));

    // And the record now knows it has been used.
    expect((await repository.getRecord('a'))!.lastCopiedAt, isNotNull);
  });

  testWidgets('the preview scrolls on desktop without taking the dialog down',
      (tester) async {
    // Enough records that the preview has somewhere to scroll to.
    for (var i = 0; i < 30; i++) {
      await seed(
        id: 'r$i',
        subject: 's$i',
        body: 'b$i',
        context: 'c$i',
        critique: 'a critique',
        videoDate: DateTime(2025, 6, 1 + (i % 28)),
      );
    }

    tester.view.physicalSize = const Size(1400, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [emailLibraryDbProvider.overrideWithValue(db)],
        child: const MaterialApp(
          localizationsDelegates: [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(body: SizedBox.shrink()),
        ),
      ),
    );

    unawaited(
      showCopyRangeDialog(
        tester.element(find.byType(Scaffold)),
        audience: EmailAudience.influencer,
      ),
    );
    await tester.pumpAndSettle();

    final pointer = TestPointer(1, PointerDeviceKind.mouse);
    final list = tester.getCenter(find.byType(ListView));
    tester.binding.handlePointerEvent(pointer.hover(list));
    tester.binding.handlePointerEvent(pointer.scroll(const Offset(0, 160)));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Copy 30 records'), findsOneWidget);
  },
      // Desktop, and opened through `showDialog` — both matter. The scroll
      // behaviour only wraps a list in its own Scrollbar on desktop, and a
      // ModalRoute is what puts a PrimaryScrollController above the dialog for
      // a hand-written Scrollbar to latch onto and then assert on, since a
      // `primary: false` list never attaches to it.
      variant: TargetPlatformVariant.desktop());

  testWidgets('a failed clipboard write leaves the records unstamped',
      (tester) async {
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          throw PlatformException(code: 'no-clipboard');
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );

    await seed(
      id: 'a',
      subject: 's',
      body: 'b',
      context: 'c',
      critique: 'crit',
      videoDate: DateTime(2025, 6, 12),
    );

    await pumpDialog(tester);
    await tester.tap(find.text('Copy 1 record'));
    await tester.pumpAndSettle();

    // A copy that did not happen must not be recorded as one.
    expect((await repository.getRecord('a'))!.lastCopiedAt, isNull);
    expect(find.textContaining('Could not copy'), findsOneWidget);
  });

  group('the range ends', () {
    Future<void> seedSpan() async {
      await seed(
        id: 'oldest',
        subject: 's',
        body: 'b',
        context: 'c',
        critique: 'a critique',
        videoDate: DateTime(2026, 7, 31),
      );
      await seed(
        id: 'newest',
        subject: 's2',
        body: 'b2',
        context: 'c2',
        critique: 'another critique',
        videoDate: DateTime(2026, 8, 5),
      );
    }

    testWidgets('open on the oldest and newest video date in the tab',
        (tester) async {
      await seedSpan();
      await pumpDialog(tester);

      expect(box(tester, 'from', 'day'), '31');
      expect(box(tester, 'from', 'month'), '7-July');
      expect(box(tester, 'from', 'year'), '26');

      expect(box(tester, 'to', 'day'), '05');
      expect(box(tester, 'to', 'month'), '8-August');
      expect(box(tester, 'to', 'year'), '26');

      // Which is to say: everything the tab has.
      expect(find.text('Copy 2 records'), findsOneWidget);
    });

    testWidgets('do not scroll past the newest video date', (tester) async {
      await seedSpan();
      await pumpDialog(tester);

      await spin(tester, 'to', 'day', -60);

      expect(box(tester, 'to', 'day'), '05');
      expect(find.text('Copy 2 records'), findsOneWidget);
    });

    testWidgets('or before the oldest one', (tester) async {
      await seedSpan();
      await pumpDialog(tester);

      await spin(tester, 'from', 'month', 60);

      expect(box(tester, 'from', 'month'), '7-July');
      expect(box(tester, 'from', 'day'), '31');
      expect(find.text('Copy 2 records'), findsOneWidget);
    });

    testWidgets('narrow the batch when they are spun inwards', (tester) async {
      await seedSpan();
      await pumpDialog(tester);

      // A month up from 31 July is 31 August, past the newest video date — so
      // it settles on that date, and the range is now the last day alone.
      await spin(tester, 'from', 'month', -60);

      expect(box(tester, 'from', 'day'), '05');
      expect(box(tester, 'from', 'month'), '8-August');
      expect(find.text('Copy 1 record'), findsOneWidget);
      expect(find.text('another critique'), findsNothing);
      expect(find.text('2 words of critique'), findsOneWidget);
    });

    testWidgets('fall back to a wide range when nothing in the tab is dated',
        (tester) async {
      await seed(
        id: 'dateless',
        subject: 's',
        body: 'b',
        context: 'c',
        critique: 'a critique',
      );
      await pumpDialog(tester);

      // No span to fit them to, so the wheels keep the editor's own ranges and
      // the dialog says what it always says about undated records.
      expect(find.byKey(const ValueKey('copyRange.from')), findsOneWidget);
      expect(
        find.text('No records with a video date in this range.'),
        findsOneWidget,
      );
    });
  });
}
