import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/theme/app_theme.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/mention_text_field.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

Future<void> _pump(WidgetTester tester, TextEditingController controller) {
  return tester.pumpWidget(
    MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: 400,
            child: MentionTextField(controller: controller, minLines: 4),
          ),
        ),
      ),
    ),
  );
}

/// Types [text] into the field and settles, the way the widget sees a person
/// typing: the whole value plus a caret at the end.
Future<void> _type(WidgetTester tester, String text) async {
  await tester.enterText(find.byType(TextField), text);
  await tester.pump();
}

/// The keywords currently offered, in the order the list shows them.
List<String> _suggestions(WidgetTester tester) => tester
    .widgetList<Text>(find.descendant(
      of: find.byType(ListView),
      matching: find.byType(Text),
    ))
    .map((text) => text.data ?? '')
    .where((data) => data.startsWith('@'))
    .toList();

/// The layer the pills are drawn on. The painter itself is private, so it is
/// found by the only thing about it that is public: being the one [CustomPaint]
/// with a painter that this widget mounts.
final _pillLayer = find.descendant(
  of: find.byType(MentionTextField),
  matching: find.byWidgetPredicate(
    (widget) => widget is CustomPaint && widget.painter != null,
  ),
);

/// Pumps the field with a "+" row that hands back [added] when taken, and
/// records the query it was asked with.
Future<List<String>> _pumpWithAdd(
  WidgetTester tester,
  TextEditingController controller, {
  String? added,
  List<String> keywords = kEmailMentionKeywords,
}) async {
  final asked = <String>[];
  await tester.pumpWidget(
    MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: 400,
            child: MentionTextField(
              controller: controller,
              minLines: 4,
              keywords: keywords,
              onAddKeyword: (query) async {
                asked.add(query);
                return added;
              },
            ),
          ),
        ),
      ),
    ),
  );
  return asked;
}

/// Pumps a field that hands its right-clicked selection to [quoted].
Future<void> _pumpQuoting(
  WidgetTester tester,
  TextEditingController controller,
  List<String> quoted,
) {
  return tester.pumpWidget(
    MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: 400,
            child: MentionTextField(
              controller: controller,
              minLines: 4,
              onQuoteSelection: quoted.add,
            ),
          ),
        ),
      ),
    ),
  );
}

/// Right-clicks the middle of the field, the way a mouse does it.
Future<void> _rightClick(WidgetTester tester) async {
  final gesture = await tester.startGesture(
    tester.getCenter(find.byType(TextField)),
    kind: PointerDeviceKind.mouse,
    buttons: kSecondaryButton,
  );
  await gesture.up();
  await tester.pumpAndSettle();
}

void main() {
  group('asMentionToken', () {
    test('a plain word is already a token', () {
      expect(asMentionToken('campaign'), 'campaign');
    });

    test('spaces fold into underscores so the word can be matched again', () {
      expect(asMentionToken('reply to'), 'reply_to');
    });

    test('punctuation and surrounding junk are dropped', () {
      expect(asMentionToken('  @niche-name!  '), 'niche_name');
    });

    test('nothing usable is null rather than an empty keyword', () {
      expect(asMentionToken('  ---  '), isNull);
    });
  });

  group('the add-a-keyword row', () {
    testWidgets('is not offered when there is no way to add one', (
      tester,
    ) async {
      final controller = TextEditingController();
      addTearDown(controller.dispose);

      await _pump(tester, controller);
      await _type(tester, 'Hi @');

      expect(find.byIcon(Icons.add), findsNothing);
    });

    testWidgets('sits under the matches when there is', (tester) async {
      final controller = TextEditingController();
      addTearDown(controller.dispose);

      await _pumpWithAdd(tester, controller);
      await _type(tester, 'Hi @');

      expect(find.byIcon(Icons.add), findsOneWidget);
      expect(_suggestions(tester), hasLength(kEmailMentionKeywords.length));
    });

    testWidgets('keeps the menu open when nothing matches', (tester) async {
      final controller = TextEditingController();
      addTearDown(controller.dispose);

      await _pumpWithAdd(tester, controller);
      await _type(tester, 'Hi @campaign');

      // The one case the "+" exists for: the keyword is not in the vocabulary
      // yet, so the menu has nothing to offer except adding it.
      expect(find.byIcon(Icons.add), findsOneWidget);
      expect(_suggestions(tester), isEmpty);
    });

    testWidgets('names the keyword it would add', (tester) async {
      final controller = TextEditingController();
      addTearDown(controller.dispose);

      await _pumpWithAdd(tester, controller);
      await _type(tester, 'Hi @reply to');

      expect(find.text('Add "@reply_to"'), findsNothing);
      await _type(tester, 'Hi @reply_to');
      expect(find.text('Add "@reply_to"'), findsOneWidget);
    });

    testWidgets('clicking it asks with what was typed, then inserts the answer',
        (tester) async {
      final controller = TextEditingController();
      addTearDown(controller.dispose);

      final asked = await _pumpWithAdd(
        tester,
        controller,
        added: 'campaign',
      );
      await _type(tester, 'Hi @camp');
      await tester.tap(find.byIcon(Icons.add));
      await tester.pumpAndSettle();

      expect(asked, ['camp']);
      expect(controller.text, 'Hi @campaign ');
    });

    testWidgets('tab takes it once the highlight reaches it', (tester) async {
      final controller = TextEditingController();
      addTearDown(controller.dispose);

      final asked = await _pumpWithAdd(tester, controller, added: 'campaign');
      await _type(tester, 'Hi @');
      // Past the last keyword and around onto the "+".
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pumpAndSettle();

      expect(asked, ['']);
      expect(controller.text, 'Hi @campaign ');
    });

    testWidgets('a cancelled add leaves the text as it was', (tester) async {
      final controller = TextEditingController();
      addTearDown(controller.dispose);

      await _pumpWithAdd(tester, controller);
      await _type(tester, 'Hi @camp');
      await tester.tap(find.byIcon(Icons.add));
      await tester.pumpAndSettle();

      expect(controller.text, 'Hi @camp');
    });

    testWidgets('a keyword added this way is offered from then on', (
      tester,
    ) async {
      final controller = TextEditingController();
      addTearDown(controller.dispose);

      // What the editor does: the vocabulary it passes in has grown.
      await _pumpWithAdd(
        tester,
        controller,
        keywords: [...kEmailMentionKeywords, 'campaign'],
      );
      await _type(tester, 'Hi @camp');

      expect(_suggestions(tester), ['@campaign']);
    });
  });

  group('mentionRangesIn', () {
    List<String> found(String text) =>
        mentionRangesIn(text, kEmailMentionKeywords)
            .map((range) => text.substring(range.start, range.end))
            .toList();

    test('finds every recognised keyword', () {
      expect(found('Hi @receiver, from @sender.'), ['@receiver', '@sender']);
    });

    test('a half-typed keyword is not a mention yet', () {
      expect(found('Hi @rec'), isEmpty);
    });

    test('a word that is not a keyword is left alone', () {
      expect(found('Ping @moustafa about it'), isEmpty);
    });

    test('matching ignores case', () {
      expect(found('Hi @Receiver'), ['@Receiver']);
    });

    test('an email address is not a mention', () {
      expect(found('sam@brand and @brand'), ['@brand']);
    });
  });

  testWidgets('a recognised keyword is painted with a pill behind it', (
    tester,
  ) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _type(tester, 'Hi @receiver ');

    expect(tester.renderObject(_pillLayer), paints..rrect());
  });

  testWidgets('nothing is painted until a keyword is complete', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _type(tester, 'Hi @rec');

    expect(tester.renderObject(_pillLayer), paintsNothing);
  });

  // The app's own theme fills every input with an opaque card color, and a
  // field that painted that fill itself would cover the pill layer beneath it.
  // Pumped under the real themes rather than the bare default, because the
  // default is unfilled and would never catch this.
  for (final theme
      in {'light': AppTheme.light, 'dark': AppTheme.dark}.entries) {
    testWidgets('the pill survives the real ${theme.key} theme', (
      tester,
    ) async {
      final controller = TextEditingController(text: 'Hi @receiver there');
      addTearDown(controller.dispose);

      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          theme: theme.value,
          home: Scaffold(
            body: Center(
              child: SizedBox(
                width: 400,
                child: MentionTextField(controller: controller, minLines: 4),
              ),
            ),
          ),
        ),
      );

      expect(tester.renderObject(_pillLayer), paints..rrect());
      expect(
        tester.widget<TextField>(find.byType(TextField)).decoration!.filled,
        isFalse,
      );
    });
  }

  testWidgets('nothing is suggested until an @ is typed', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _type(tester, 'Hi there');

    expect(find.byType(ListView), findsNothing);
  });

  testWidgets('a bare @ offers every keyword', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _type(tester, 'Hi @');

    expect(
      _suggestions(tester),
      kEmailMentionKeywords.map((keyword) => '@$keyword').toList(),
    );
  });

  testWidgets('typing narrows the list', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _type(tester, 'Hi @re');

    expect(_suggestions(tester), ['@receiver']);
  });

  testWidgets('matching is case-insensitive', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _type(tester, 'Hi @BR');

    expect(_suggestions(tester), ['@brand']);
  });

  testWidgets('a fragment that matches nothing closes the list',
      (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _type(tester, 'Hi @zz');

    expect(find.byType(ListView), findsNothing);
  });

  testWidgets('tab inserts the highlighted keyword and a trailing space',
      (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _type(tester, 'Hi @re');
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();

    expect(controller.text, 'Hi @receiver ');
    expect(controller.selection.baseOffset, 'Hi @receiver '.length);
    expect(find.byType(ListView), findsNothing);
  });

  testWidgets('arrow keys pick a different keyword', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _type(tester, '@');
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();

    expect(controller.text, '@${kEmailMentionKeywords[1]} ');
  });

  testWidgets('the highlight wraps past the end of the list', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _type(tester, '@');
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();

    expect(controller.text, '@${kEmailMentionKeywords.last} ');
  });

  testWidgets('escape dismisses without inserting anything', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _type(tester, 'Hi @re');
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pump();

    expect(find.byType(ListView), findsNothing);
    expect(controller.text, 'Hi @re');
  });

  testWidgets('clicking a suggestion inserts it', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _type(tester, 'Hi @');
    await tester.tap(find.text('@product'));
    await tester.pump();

    expect(controller.text, 'Hi @product ');
  });

  testWidgets('an email address is not a mention', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _type(tester, 'sam@br');

    expect(find.byType(ListView), findsNothing);
  });

  testWidgets('typing past the keyword closes the list', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _type(tester, 'Hi @receiver and');

    expect(find.byType(ListView), findsNothing);
  });

  testWidgets('tab still moves focus when no list is open', (tester) async {
    final controller = TextEditingController();
    final focusNode = FocusNode();
    addTearDown(controller.dispose);
    addTearDown(focusNode.dispose);

    // A second stop to traverse to, since Tab in a tree with nowhere to go
    // leaves focus where it is and would prove nothing.
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: Column(
            children: [
              MentionTextField(controller: controller, focusNode: focusNode),
              ElevatedButton(onPressed: () {}, child: const Text('Save')),
            ],
          ),
        ),
      ),
    );
    await _type(tester, 'Hi');
    expect(focusNode.hasFocus, isTrue);

    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();

    // The field let the keystroke go rather than eating it, which is the whole
    // reason the interception is conditional on the list being open.
    expect(controller.text, 'Hi');
    expect(focusNode.hasFocus, isFalse);
  });

  group('asQuoteToken', () {
    test('wraps an excerpt in the marks the pill is drawn from', () {
      expect(asQuoteToken('a warm intro'), '«a warm intro»');
    });

    test('a body\'s line breaks are flattened onto one line', () {
      expect(
        asQuoteToken('Hi there,\n\n  I saw your  video'),
        '«Hi there, I saw your video»',
      );
    });

    test('marks already inside it are dropped rather than nested', () {
      expect(asQuoteToken('he said «no»'), '«he said no»');
    });

    test('whitespace alone is nothing to quote', () {
      expect(asQuoteToken('  \n '), isNull);
    });
  });

  group('quoteRangesIn', () {
    List<String> found(String text) => quoteRangesIn(text)
        .map((range) => text.substring(range.start, range.end))
        .toList();

    test('finds every closed pair', () {
      expect(
          found('She opened «cold» and closed «warm».'), ['«cold»', '«warm»']);
    });

    test('an unclosed mark is not a quote yet', () {
      expect(found('She opened «cold'), isEmpty);
    });
  });

  testWidgets('a quote is painted with a pill when the field highlights them',
      (tester) async {
    final controller = TextEditingController(text: 'Sent after «a warm intro»');
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 400,
              child: MentionTextField(
                controller: controller,
                minLines: 4,
                highlightQuotes: true,
              ),
            ),
          ),
        ),
      ),
    );

    expect(tester.renderObject(_pillLayer), paints..rrect());
  });

  testWidgets('the field an excerpt came from does not paint the marks',
      (tester) async {
    final controller = TextEditingController(text: 'Sent after «a warm intro»');
    addTearDown(controller.dispose);

    await _pump(tester, controller);

    expect(tester.renderObject(_pillLayer), paintsNothing);
  });

  testWidgets('right-clicking a selection hands it over', (tester) async {
    final controller = TextEditingController();
    final quoted = <String>[];
    addTearDown(controller.dispose);

    await _pumpQuoting(tester, controller, quoted);
    await _type(tester, 'Hi there, I saw your video');
    controller.selection =
        const TextSelection(baseOffset: 10, extentOffset: 25);
    await tester.pump();
    await _rightClick(tester);

    expect(quoted, ['I saw your vide']);
    // The gesture answered the click, so the menu it would have raised is not
    // left on top of the result.
    expect(find.byType(AdaptiveTextSelectionToolbar), findsNothing);
  });

  testWidgets('right-clicking with nothing selected keeps the usual menu',
      (tester) async {
    final controller = TextEditingController();
    final quoted = <String>[];
    addTearDown(controller.dispose);

    await _pumpQuoting(tester, controller, quoted);
    await _type(tester, 'Hi there, I saw your video');
    await _rightClick(tester);

    expect(quoted, isEmpty);
    expect(find.byType(AdaptiveTextSelectionToolbar), findsOneWidget);
  });

  testWidgets('a selection of pure whitespace is not worth quoting',
      (tester) async {
    final controller = TextEditingController();
    final quoted = <String>[];
    addTearDown(controller.dispose);

    await _pumpQuoting(tester, controller, quoted);
    await _type(tester, 'Hi   there');
    controller.selection = const TextSelection(baseOffset: 2, extentOffset: 5);
    await tester.pump();
    await _rightClick(tester);

    expect(quoted, isEmpty);
  });
}
