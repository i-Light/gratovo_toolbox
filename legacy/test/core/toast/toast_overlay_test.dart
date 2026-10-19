import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/toast/toast_overlay.dart';

/// End-to-end wiring: [AppToast] raises a toast, [ToastOverlay] (mounted the
/// same way `app.dart` mounts it — above the app's content) renders and
/// animates it, and it dismisses itself or on request.
void main() {
  Widget harness(WidgetBuilder bodyBuilder) {
    return ProviderScope(
      child: MaterialApp(
        builder: (context, child) => ToastOverlay(child: child!),
        home: Builder(builder: bodyBuilder),
      ),
    );
  }

  testWidgets(
    'AppToast.error shows the message with the error icon, then '
    'dismisses itself after its display duration',
    (tester) async {
      await tester.pumpWidget(harness(
        (context) => Scaffold(
          body: ElevatedButton(
            onPressed: () => AppToast.error(context, 'Something broke'),
            child: const Text('trigger'),
          ),
        ),
      ));

      expect(find.text('Something broke'), findsNothing);

      await tester.tap(find.text('trigger'));
      await tester.pumpAndSettle();

      expect(find.text('Something broke'), findsOneWidget);
      expect(find.byIcon(Icons.error_outline), findsOneWidget);

      // Error toasts hold for 6 seconds (ToastSeverity.displayDuration).
      await tester.pump(const Duration(seconds: 7));
      await tester.pumpAndSettle();

      expect(find.text('Something broke'), findsNothing);
    },
  );

  testWidgets('tapping the close button dismisses a toast early',
      (tester) async {
    await tester.pumpWidget(harness(
      (context) => Scaffold(
        body: ElevatedButton(
          onPressed: () => AppToast.success(context, 'Saved'),
          child: const Text('trigger'),
        ),
      ),
    ));

    await tester.tap(find.text('trigger'));
    await tester.pumpAndSettle();
    expect(find.text('Saved'), findsOneWidget);
    expect(find.byIcon(Icons.check_circle_outline), findsOneWidget);

    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();

    expect(find.text('Saved'), findsNothing);
  });

  testWidgets('two toasts raised in quick succession both show, newest first',
      (tester) async {
    await tester.pumpWidget(harness(
      (context) => Scaffold(
        body: Column(
          children: [
            ElevatedButton(
              onPressed: () => AppToast.info(context, 'First'),
              child: const Text('first'),
            ),
            ElevatedButton(
              onPressed: () => AppToast.warning(context, 'Second'),
              child: const Text('second'),
            ),
          ],
        ),
      ),
    ));

    await tester.tap(find.text('first'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('second'));
    await tester.pumpAndSettle();

    expect(find.text('First'), findsOneWidget);
    expect(find.text('Second'), findsOneWidget);
    // Newest on top: "Second"'s Y position is above "First"'s.
    final firstY = tester.getTopLeft(find.text('First')).dy;
    final secondY = tester.getTopLeft(find.text('Second')).dy;
    expect(secondY, lessThan(firstY));
  });
}
