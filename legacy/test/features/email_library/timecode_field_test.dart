import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/timecode_field.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Pumps the field on its own, with just enough app around it for
/// `AppLocalizations.of` to resolve.
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
            width: 200,
            child: TimecodeField(controller: controller),
          ),
        ),
      ),
    ),
  );
}

/// The text in the hours, minutes and seconds boxes, left to right.
List<String> _segments(WidgetTester tester) => tester
    .widgetList<TextField>(find.byType(TextField))
    .map((field) => field.controller!.text)
    .toList();

/// Spins the wheel over one segment. Negative dy is a scroll up, which counts
/// up — the direction every desktop spinner moves.
Future<void> _scroll(WidgetTester tester, int segment, double dy) async {
  final pointer = TestPointer(1, PointerDeviceKind.mouse);
  final centre = tester.getCenter(find.byType(TextField).at(segment));
  await tester.sendEventToBinding(pointer.hover(centre));
  await tester.sendEventToBinding(pointer.scroll(Offset(0, dy)));
  await tester.pump();
}

void main() {
  testWidgets('shows the controller text split into three padded boxes',
      (tester) async {
    final controller = TextEditingController(text: '1:05:30');
    addTearDown(controller.dispose);

    await _pump(tester, controller);

    expect(_segments(tester), ['01', '05', '30']);
  });

  testWidgets('an empty timecode leaves every box blank', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);

    expect(_segments(tester), ['', '', '']);
  });

  testWidgets('scrolling up over a segment counts it up', (tester) async {
    final controller = TextEditingController(text: '1:05:30');
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _scroll(tester, 2, -50);

    expect(_segments(tester), ['01', '05', '31']);
    expect(controller.text, '1:05:31');
  });

  testWidgets('seconds wrap from 00 down to 59', (tester) async {
    final controller = TextEditingController(text: '0:00:00');
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _scroll(tester, 2, 50);

    expect(_segments(tester), ['00', '00', '59']);
    expect(controller.text, '0:00:59');
  });

  testWidgets('hours wrap from 23 up to 00', (tester) async {
    final controller = TextEditingController(text: '23:00:00');
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _scroll(tester, 0, -50);

    expect(_segments(tester), ['00', '00', '00']);
    expect(controller.text, '0:00:00');
  });

  testWidgets('spinning one segment of a blank field zeroes the others',
      (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await _scroll(tester, 1, -50);

    expect(_segments(tester), ['00', '01', '00']);
    expect(controller.text, '0:01:00');
  });

  testWidgets('arrow keys move a focused segment the same way the wheel does',
      (tester) async {
    final controller = TextEditingController(text: '0:00:10');
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await tester.tap(find.byType(TextField).at(2));
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pump();

    expect(controller.text, '0:00:11');
  });

  testWidgets('a value past the segment limit is refused, not clamped',
      (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    // 65 minutes is a typo, and the second keystroke is what is wrong with it,
    // so the field is typed into one digit at a time the way a person would.
    await tester.enterText(find.byType(TextField).at(1), '6');
    await tester.enterText(find.byType(TextField).at(1), '65');
    await tester.pump();

    expect(_segments(tester)[1], '6');
    expect(controller.text, '0:06:00');
  });

  testWidgets('typing two digits moves on to the next segment', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    await tester.enterText(find.byType(TextField).at(0), '12');
    await tester.pump();

    final minutes = tester.widget<TextField>(find.byType(TextField).at(1));
    expect(minutes.focusNode!.hasFocus, isTrue);
  });

  testWidgets('clearing the controller from outside empties the boxes',
      (tester) async {
    final controller = TextEditingController(text: '1:05:30');
    addTearDown(controller.dispose);

    await _pump(tester, controller);
    // What "save and add another" does between records.
    controller.clear();
    await tester.pump();

    expect(_segments(tester), ['', '', '']);
  });
}
