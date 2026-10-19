import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/scroll/smooth_wheel_scroll.dart';

void main() {
  // The glide is desktop-only, and tests run as Android by default.
  final desktop = TargetPlatformVariant.only(TargetPlatform.windows);

  /// A list under [SmoothWheelScroll], optionally opted out of the glide.
  Future<ScrollController> pumpList(
    WidgetTester tester, {
    required bool optOut,
  }) async {
    final controller = ScrollController();
    Widget list = SizedBox(
      height: 200,
      width: 240,
      child: ListView.builder(
        controller: controller,
        itemCount: 50,
        itemExtent: 38,
        itemBuilder: (_, index) => Text('row $index'),
      ),
    );
    if (optOut) list = NoSmoothWheelScroll(child: list);
    await tester.pumpWidget(
      MaterialApp(home: SmoothWheelScroll(child: Center(child: list))),
    );
    return controller;
  }

  void wheel(WidgetTester tester, double delta) {
    final pointer = TestPointer(1, PointerDeviceKind.mouse);
    final center = tester.getCenter(find.byType(ListView));
    tester.binding.handlePointerEvent(pointer.hover(center));
    tester.binding.handlePointerEvent(pointer.scroll(Offset(0, delta)));
  }

  testWidgets('a wheel notch glides to its target over several frames',
      (tester) async {
    final controller = await pumpList(tester, optOut: false);

    wheel(tester, 120);
    await tester.pump();
    // The instant jump Flutter applied has been rewound; the glide has not
    // ticked yet, so the list has not moved at all.
    expect(controller.offset, 0);

    await tester.pump(const Duration(milliseconds: 16));
    expect(controller.offset, greaterThan(0));
    expect(controller.offset, lessThan(120));

    await tester.pumpAndSettle();
    expect(controller.offset, 120);
  }, variant: desktop);

  testWidgets('NoSmoothWheelScroll leaves the per-notch jump alone',
      (tester) async {
    final controller = await pumpList(tester, optOut: true);

    wheel(tester, 120);
    await tester.pump();
    expect(controller.offset, 120);
  }, variant: desktop);
}
