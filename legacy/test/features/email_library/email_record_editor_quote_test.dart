import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/email_library_providers.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/email_record_editor.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/mention_text_field.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

import '../../data/repositories/email_library/memory_local_db.dart';

/// The body — the only field that hands its selection anywhere.
final _body = find.byWidgetPredicate(
  (widget) => widget is MentionTextField && widget.onQuoteSelection != null,
);

/// The context note — the only field that paints quotes.
final _context = find.byWidgetPredicate(
  (widget) => widget is MentionTextField && widget.highlightQuotes,
);

TextEditingController _controllerOf(WidgetTester tester, Finder field) =>
    tester.widget<MentionTextField>(field).controller;

Future<void> _pumpEditor(WidgetTester tester) async {
  final db = MemoryLocalDb();
  addTearDown(db.close);

  // Tall enough for the whole form to be on screen at once: the gesture under
  // test is a real click at a real position, and a body scrolled out of the
  // dialog would simply not be there to hit.
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
          body: EmailRecordEditor(
            record: EmailRecord.blank(audience: EmailAudience.influencer),
            isNew: true,
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// Selects [start]..[end] of the body and right-clicks it, which is the whole
/// gesture: the field has to be focused for the selection to be a real one.
Future<void> _quote(WidgetTester tester, int start, int end) async {
  final field = find.descendant(of: _body, matching: find.byType(TextField));
  await tester.tap(field);
  await tester.pump();
  _controllerOf(tester, _body).selection =
      TextSelection(baseOffset: start, extentOffset: end);
  await tester.pump();

  final gesture = await tester.startGesture(
    tester.getCenter(field),
    kind: PointerDeviceKind.mouse,
    buttons: kSecondaryButton,
  );
  await gesture.up();
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a right-clicked excerpt lands in the empty context note',
      (tester) async {
    await _pumpEditor(tester);
    await tester.enterText(
      find.descendant(of: _body, matching: find.byType(TextField)),
      'Hi there,\nI saw your latest video and loved it.',
    );
    await tester.pump();

    await _quote(tester, 10, 30);

    expect(_controllerOf(tester, _context).text, '«I saw your latest vi»');
  });

  testWidgets('the excerpt lands where the note was last being typed',
      (tester) async {
    await _pumpEditor(tester);
    await tester.enterText(
      find.descendant(of: _body, matching: find.byType(TextField)),
      'Hi there, I saw your video',
    );
    await tester.enterText(
      find.descendant(of: _context, matching: find.byType(TextField)),
      'Sent after the reply.',
    );
    // The caret parked mid-sentence, exactly as leaving off there would leave
    // it — which is the position the excerpt has to respect.
    _controllerOf(tester, _context).selection =
        const TextSelection.collapsed(offset: 10);
    await tester.pump();

    await _quote(tester, 10, 25);

    expect(
      _controllerOf(tester, _context).text,
      'Sent after «I saw your vide» the reply.',
    );
  });

  testWidgets('a second excerpt follows the first rather than overwriting it',
      (tester) async {
    await _pumpEditor(tester);
    await tester.enterText(
      find.descendant(of: _body, matching: find.byType(TextField)),
      'Hi there, I saw your video',
    );
    await tester.pump();

    await _quote(tester, 0, 9);
    await _quote(tester, 10, 25);

    expect(
      _controllerOf(tester, _context).text,
      '«Hi there,» «I saw your vide»',
    );
  });
}
