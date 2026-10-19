import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/widgets/stepped_number_field.dart';

/// [SteppedNumberField] has three ways in — type, wheel, arrows — and two commit
/// timings — immediate for the wheel and arrows, deferred to submit/blur for
/// typing. Both halves are worth pinning: a filter that fires an aggregate per
/// keystroke, or one that silently drops a number you tabbed away from, each
/// looks like working software.
void main() {
  Future<int?> Function() pumpField(
    WidgetTester tester, {
    int? initial,
    int step = 1,
  }) {
    int? committed = initial;
    return () async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Column(
              children: [
                SteppedNumberField(
                  label: 'Min',
                  value: initial,
                  step: step,
                  onCommitted: (value) => committed = value,
                ),
                const TextField(
                  decoration: InputDecoration(labelText: 'elsewhere'),
                ),
              ],
            ),
          ),
        ),
      );
      return committed;
    };
  }

  Future<void> scroll(WidgetTester tester, double dy) async {
    final center = tester.getCenter(find.byType(SteppedNumberField));
    final pointer = TestPointer(1, PointerDeviceKind.mouse);
    await tester.sendEventToBinding(pointer.hover(center));
    await tester.sendEventToBinding(pointer.scroll(Offset(0, dy)));
    await tester.pump();
  }

  testWidgets('typing commits on submit, not per keystroke', (tester) async {
    var commits = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SteppedNumberField(
            label: 'Min',
            value: null,
            onCommitted: (_) => commits++,
          ),
        ),
      ),
    );

    await tester.enterText(find.byType(TextField), '1000');
    expect(commits, 0, reason: 'nothing fires while the digits are going in');

    await tester.testTextInput.receiveAction(TextInputAction.done);
    // Submit commits, and the blur that follows commits the same value again —
    // idempotent, and the same as the field this replaced. The point is that it
    // was zero until the edit was finished.
    expect(commits, greaterThan(0));
  });

  testWidgets('typing commits on focus loss', (tester) async {
    final read = pumpField(tester);
    await read();

    await tester.enterText(find.byType(SteppedNumberField), '250');
    await tester.tap(find.widgetWithText(TextField, 'elsewhere'));
    await tester.pump();

    expect(await read(), 250);
  });

  testWidgets('the wheel nudges by one step and commits at once',
      (tester) async {
    final read = pumpField(tester, initial: 100, step: 10);
    await read();

    await scroll(tester, -1); // up
    expect(await read(), 110);

    await scroll(tester, 1); // down
    expect(await read(), 100);
  });

  testWidgets('Shift multiplies the step by ten', (tester) async {
    final read = pumpField(tester, initial: 0, step: 10);
    await read();

    await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await scroll(tester, -1);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);

    expect(await read(), 100);
  });

  testWidgets('the down arrow clamps at zero and never goes negative',
      (tester) async {
    final read = pumpField(tester, initial: 5, step: 10);
    await read();

    await tester.tap(find.byIcon(Icons.keyboard_arrow_down));
    await tester.pump();

    expect(await read(), 0);
  });

  testWidgets('the up arrow fills an empty field from zero', (tester) async {
    final read = pumpField(tester, initial: null, step: 10);
    await read();

    await tester.tap(find.byIcon(Icons.keyboard_arrow_up));
    await tester.pump();

    expect(await read(), 10);
  });

  testWidgets('a downward nudge on an empty field leaves it empty',
      (tester) async {
    final read = pumpField(tester, initial: null, step: 10);
    await read();

    await tester.tap(find.byIcon(Icons.keyboard_arrow_down));
    await tester.pump();

    expect(await read(), isNull);
  });
}
