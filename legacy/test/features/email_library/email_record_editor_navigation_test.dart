import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/email_library_providers.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/sqlite_email_library_repository.dart';
import 'package:gratovo_toolbox/features/email_library/application/email_library_controller.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/email_form_fields.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/email_record_editor.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/mention_text_field.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

import '../../data/repositories/email_library/memory_local_db.dart';

/// The critique field is the one unambiguous `GrowingTextField` in the editor,
/// so its text is how a test tells which record is on screen.
String _critiqueText(WidgetTester tester) => tester
    .widget<GrowingTextField>(find.byType(GrowingTextField))
    .controller
    .text;

EmailRecord _record({
  required String id,
  required String critique,
  required DateTime updatedAt,
}) {
  return EmailRecord(
    id: id,
    audience: EmailAudience.influencer,
    subject: 'Subject $id',
    critique: critique,
    createdAt: DateTime.utc(2026, 1, 1),
    updatedAt: updatedAt,
  );
}

/// Seeds three influencer records and opens the editor on the middle one.
///
/// The default sort is `updated_at DESC`, so the list is [a, b, c] and the
/// editor starts at index 1.
Future<void> _pumpOnMiddleRecord(WidgetTester tester) async {
  final db = MemoryLocalDb();
  addTearDown(db.close);
  final repository = SqliteEmailLibraryRepository(db);
  await repository.saveRecord(
    _record(id: 'a', critique: 'crit-A', updatedAt: DateTime.utc(2026, 3, 3)),
  );
  await repository.saveRecord(
    _record(id: 'b', critique: 'crit-B', updatedAt: DateTime.utc(2026, 3, 2)),
  );
  await repository.saveRecord(
    _record(id: 'c', critique: 'crit-C', updatedAt: DateTime.utc(2026, 3, 1)),
  );

  tester.view.physicalSize = const Size(1200, 2400);
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
        home: Scaffold(
          body: Consumer(
            builder: (context, ref, _) {
              final records = ref.watch(emailRecordsProvider);
              return records.when(
                loading: () => const SizedBox.shrink(),
                error: (error, _) => Text('$error'),
                data: (items) => EmailRecordEditor(
                  record: items.firstWhere((r) => r.id == 'b'),
                ),
              );
            },
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  expect(_critiqueText(tester), 'crit-B');
}

void main() {
  testWidgets('Right and Left step to the next and previous record',
      (tester) async {
    await _pumpOnMiddleRecord(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(_critiqueText(tester), 'crit-C');

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    await tester.pumpAndSettle();
    expect(_critiqueText(tester), 'crit-A');
  });

  testWidgets('an arrow key at the end of the list does nothing',
      (tester) async {
    await _pumpOnMiddleRecord(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    await tester.pumpAndSettle();
    expect(_critiqueText(tester), 'crit-A');

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    await tester.pumpAndSettle();
    expect(_critiqueText(tester), 'crit-A');
  });

  testWidgets('the arrows are inert while a field holds focus', (tester) async {
    await _pumpOnMiddleRecord(tester);

    await tester.tap(find.byType(GrowingTextField));
    await tester.pumpAndSettle();

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(_critiqueText(tester), 'crit-B');
  });

  testWidgets('the arrows resume stepping once focus leaves the field',
      (tester) async {
    await _pumpOnMiddleRecord(tester);

    // Into a field, then a tap-away drops focus — the dialog should take it
    // back rather than let Left/Right fall through to focus traversal.
    await tester.tap(find.byType(GrowingTextField));
    await tester.pumpAndSettle();
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(_critiqueText(tester), 'crit-C');
  });

  testWidgets(
      'Tab from the last field walks save-and-another, then save, then cancel',
      (tester) async {
    await _pumpOnMiddleRecord(tester);
    final l10n = await AppLocalizations.delegate.load(const Locale('en'));

    bool focusIsOn(String label) {
      final focusContext = tester.binding.focusManager.primaryFocus?.context;
      if (focusContext == null) return false;
      return find
          .descendant(
            of: find.byWidget(focusContext.widget),
            matching: find.text(label),
          )
          .evaluate()
          .isNotEmpty;
    }

    // Start in the context note — the last field in the form.
    await tester.tap(find.byType(MentionTextField).last);
    await tester.pumpAndSettle();

    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pumpAndSettle();
    expect(focusIsOn(l10n.emailLibrarySaveAndAnother), isTrue);

    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pumpAndSettle();
    expect(focusIsOn(l10n.commonSave), isTrue);

    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pumpAndSettle();
    expect(focusIsOn(l10n.commonCancel), isTrue);
  });

  testWidgets('unsaved edits prompt before the step, and cancel stays put',
      (tester) async {
    await _pumpOnMiddleRecord(tester);

    await tester.enterText(find.byType(GrowingTextField), 'a new thought');
    // Move focus off the field so the arrow reaches the dialog handler.
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    final l10n = await AppLocalizations.delegate.load(const Locale('en'));
    expect(find.text(l10n.emailLibraryDiscardTitle), findsOneWidget);

    await tester.tap(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.text(l10n.commonCancel),
      ),
    );
    await tester.pumpAndSettle();
    expect(_critiqueText(tester), 'a new thought');

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    await tester.tap(find.text(l10n.emailLibraryDiscard));
    await tester.pumpAndSettle();
    expect(_critiqueText(tester), 'crit-C');
  });
}
