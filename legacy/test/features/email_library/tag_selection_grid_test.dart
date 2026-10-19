import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/email_tag.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/tag_selection_grid.dart';

void main() {
  testWidgets('the chip area scrolls on desktop without taking the editor down',
      (tester) async {
    // Enough of a vocabulary to overflow `maxRows` and give the area somewhere
    // to scroll to.
    final tags = [
      for (var i = 0; i < 120; i++)
        EmailTag(id: 't$i', kind: EmailTagKind.niche, label: 'Niche number $i'),
    ];

    tester.view.physicalSize = const Size(900, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: SizedBox.shrink())),
    );

    // In a dialog, like the record editor this control actually lives in: a
    // ModalRoute is what puts a PrimaryScrollController above it for a
    // hand-written Scrollbar to latch onto and then assert on, since a desktop
    // scroll view never attaches to one.
    unawaited(
      showDialog<void>(
        context: tester.element(find.byType(Scaffold)),
        builder: (_) => AlertDialog(
          content: SizedBox(
            width: 600,
            child: TagSelectionGrid(
              tags: tags,
              selectedIds: const {},
              onToggle: (_) {},
              onAdd: (_) {},
              searchHint: 'search',
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final pointer = TestPointer(1, PointerDeviceKind.mouse);
    final area = tester.getCenter(find.byType(SingleChildScrollView).last);
    tester.binding.handlePointerEvent(pointer.hover(area));
    tester.binding.handlePointerEvent(pointer.scroll(const Offset(0, 80)));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
  }, variant: TargetPlatformVariant.desktop());
}
