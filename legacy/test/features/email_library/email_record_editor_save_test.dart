import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/local_db/local_db.dart';
import 'package:gratovo_toolbox/core/toast/toast_overlay.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/email_library_providers.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/sqlite_email_library_repository.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/email_record_editor.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

import '../../data/repositories/email_library/memory_local_db.dart';

/// A [LocalDb] that reads fine but throws on any write, so the editor's save
/// path fails the way a locked or migrated-out-from-under-it file would.
class _WriteFailsDb implements LocalDb {
  _WriteFailsDb(this._inner);

  final MemoryLocalDb _inner;

  @override
  List<Map<String, Object?>> select(String sql,
          [List<Object?> parameters = const []]) =>
      _inner.select(sql, parameters);

  @override
  void execute(String sql, [List<Object?> parameters = const []]) =>
      throw Exception('disk is on fire');

  @override
  void transaction(void Function() body) => throw Exception('disk is on fire');

  @override
  void close() => _inner.close();
}

void main() {
  testWidgets('a failed save shows a message and keeps the dialog open',
      (tester) async {
    final seedDb = MemoryLocalDb();
    addTearDown(seedDb.close);
    // Seed one row through a working repo, then hand the editor a db whose
    // writes throw.
    await SqliteEmailLibraryRepository(seedDb).saveRecord(
      EmailRecord(
        id: 'x',
        audience: EmailAudience.influencer,
        subject: 'Subject x',
        body: 'body',
        critique: 'crit x',
        createdAt: DateTime.utc(2026, 1, 1),
        updatedAt: DateTime.utc(2026, 3, 2),
      ),
    );
    final db = _WriteFailsDb(seedDb);

    tester.view.physicalSize = const Size(1400, 3000);
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
          // Mounted the same way app.dart mounts it, so the save-failed
          // toast this test asserts on actually renders.
          builder: (context, child) => ToastOverlay(child: child!),
          home: Scaffold(
            body: EmailRecordEditor(
              record: EmailRecord(
                id: 'x',
                audience: EmailAudience.influencer,
                subject: 'Subject x',
                body: 'body',
                critique: 'crit x',
                createdAt: DateTime.utc(2026, 1, 1),
                updatedAt: DateTime.utc(2026, 3, 2),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final l10n = await AppLocalizations.delegate.load(const Locale('en'));

    await tester.enterText(find.byType(EditableText).last, 'a change');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, l10n.commonSave));
    await tester.pumpAndSettle();

    // No unhandled exception, the failure is surfaced, and the form is still up.
    expect(tester.takeException(), isNull);
    expect(find.text(l10n.emailLibrarySaveFailed), findsOneWidget);
    expect(find.byType(EmailRecordEditor), findsOneWidget);
  });
}
