import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/toast/toast_overlay.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/email_library_providers.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/sqlite_email_library_repository.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_providers.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/email_library_screen.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

import '../../data/repositories/email_library/memory_local_db.dart';
import '../../support/memory_outreach_file_store.dart';

/// The Email Critique Library's slice 3: the factory's bench run comes in as
/// "Test drafts", each one rated Good / Bad from the list, and any record can
/// be marked as one of the owner's own examples.
String _latest() => jsonEncode({
      'runAt': '2026-10-01T19:56',
      'drafts': [
        for (final id in ['a', 'b'])
          {
            'id': '2026-10-01T19:56/$id',
            'caseTitle': 'Case $id',
            'variant': 'A',
            'knobs': {'reader': 'creator', 'stage': 'first'},
            'subject': 'Subject $id',
            'body': 'Body $id\n\nInterested?\n\nMo',
            'lint': {'words': 50, 'flags': []},
            'judge': {'score': 8, 'roast': 'Roast $id'},
            'repeat': [],
          },
      ],
    });

late MemoryLocalDb _db;

Future<void> _pump(WidgetTester tester, MemoryOutreachFileStore store) async {
  tester.view.physicalSize = const Size(1400, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  _db = MemoryLocalDb();
  addTearDown(_db.close);
  // A video record already in the library, typed in long ago.
  await SqliteEmailLibraryRepository(_db).saveRecord(EmailRecord(
    id: 'v',
    audience: EmailAudience.influencer,
    subject: 'From a video',
    body: 'Video body',
    createdAt: DateTime.utc(2026, 1, 1),
    updatedAt: DateTime.utc(2026, 1, 1),
  ));
  await tester.pumpWidget(ProviderScope(
    overrides: [
      emailLibraryDbProvider.overrideWithValue(_db),
      outreachFileStoreProvider.overrideWithValue(store),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      builder: (context, child) => ToastOverlay(child: child!),
      home: const Scaffold(body: EmailLibraryView()),
    ),
  ));
  await tester.pumpAndSettle();
}

Future<List<EmailRecord>> _drafts() =>
    SqliteEmailLibraryRepository(_db).listRecords(
      audience: EmailAudience.influencer,
      source: EmailRecordSource.testDraft,
    );

Finder _key(String key) => find.byKey(ValueKey(key));

void main() {
  testWidgets('opening the library imports the bench run once', (tester) async {
    final store = MemoryOutreachFileStore({'bench/latest.json': _latest()});
    await _pump(tester, store);
    expect(find.textContaining('2 test drafts imported'), findsOneWidget);
    expect(find.text('Subject a'), findsOneWidget);
    expect(find.text('From a video'), findsOneWidget);
    expect(find.text('Test draft'), findsNWidgets(2));
    expect(find.text('Not rated'), findsNWidgets(2));
    await tester.pump(const Duration(seconds: 6));

    // The "Test drafts" filter leaves the video record out.
    await tester.tap(_key('email-source-test-draft'));
    await tester.pumpAndSettle();
    expect(find.text('From a video'), findsNothing);
    expect(find.text('Subject b'), findsOneWidget);

    // A second import of the same run adds nothing.
    expect(
      await SqliteEmailLibraryRepository(_db)
          .importRecords([(await _drafts()).first]),
      0,
    );
  });

  testWidgets('no bench run, no import and no message', (tester) async {
    await _pump(tester, MemoryOutreachFileStore());
    expect(find.textContaining('imported'), findsNothing);
    expect(await _drafts(), isEmpty);
  });

  testWidgets('Good rates at once; Bad asks why; tapping again unrates',
      (tester) async {
    await _pump(
        tester, MemoryOutreachFileStore({'bench/latest.json': _latest()}));
    await tester.pump(const Duration(seconds: 6));
    final ids = {for (final r in await _drafts()) r.subject: r.id};

    await tester.tap(_key('email-verdict-${ids['Subject a']}-good'));
    await tester.pumpAndSettle();
    var a = (await _drafts()).firstWhere((r) => r.subject == 'Subject a');
    expect(a.verdict, EmailVerdict.good);
    expect(a.verdictAt, isNotNull);

    await tester.tap(_key('email-verdict-${ids['Subject b']}-bad'));
    await tester.pumpAndSettle();
    await tester.enterText(_key('email-verdict-note'), 'Asks for rates');
    await tester.pump();
    await tester.tap(_key('email-verdict-save'));
    await tester.pumpAndSettle();
    final b = (await _drafts()).firstWhere((r) => r.subject == 'Subject b');
    expect(b.verdict, EmailVerdict.bad);
    expect(b.verdictNote, 'Asks for rates');
    expect(find.text('Asks for rates'), findsOneWidget);

    await tester.tap(_key('email-verdict-${ids['Subject a']}-good'));
    await tester.pumpAndSettle();
    a = (await _drafts()).firstWhere((r) => r.subject == 'Subject a');
    expect(a.verdict, isNull);
  });

  testWidgets('a video record can be marked as my example in the editor',
      (tester) async {
    await _pump(tester, MemoryOutreachFileStore());
    await tester.tap(find.text('From a video'));
    await tester.pumpAndSettle();
    // Not a draft: no verdict, the "My example" switch instead.
    expect(_key('editor-verdict-good'), findsNothing);
    await tester.ensureVisible(_key('editor-my-example'));
    await tester.tap(_key('editor-my-example'));
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();

    final mine = await SqliteEmailLibraryRepository(_db).listRecords(
      audience: EmailAudience.influencer,
      source: EmailRecordSource.mine,
    );
    expect(mine.single.id, 'v');
    expect(find.text('My example'), findsOneWidget);
    await tester.pump(const Duration(seconds: 6));
  });
}
