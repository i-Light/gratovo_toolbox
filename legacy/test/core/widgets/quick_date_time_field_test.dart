import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/widgets/quick_date_time_field.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// A Friday, late afternoon — the shape the composer opens on.
final _friday = DateTime(2026, 9, 4, 16, 23);

/// Pumps the field on its own with just enough app around it for
/// `AppLocalizations.of` to resolve, pinned to English so the boxes read
/// `4-Fri` and `9-Sep` rather than their Arabic spellings.
Future<void> _pump(
  WidgetTester tester,
  DateTime value, {
  ValueChanged<DateTime>? onChanged,
  DateTime? notBefore,
}) {
  return tester.pumpWidget(
    MaterialApp(
      locale: const Locale('en'),
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: Center(
          child: QuickDateTimeField(
            value: value,
            notBefore: notBefore,
            onChanged: onChanged ?? (_) {},
          ),
        ),
      ),
    ),
  );
}

Finder _seg(String name) => find.byKey(ValueKey('quickDateTime.$name'));

/// Spins the wheel over one box. Negative dy is a scroll up, which counts up.
Future<void> _scroll(WidgetTester tester, String name, double dy) async {
  final pointer = TestPointer(1, PointerDeviceKind.mouse);
  final centre = tester.getCenter(_seg(name));
  await tester.sendEventToBinding(pointer.hover(centre));
  await tester.sendEventToBinding(pointer.scroll(Offset(0, dy)));
  await tester.pump();
}

Future<void> _arrow(
  WidgetTester tester,
  String name,
  LogicalKeyboardKey key,
) async {
  await tester.tap(_seg(name));
  await tester.pump();
  await tester.sendKeyEvent(key);
  await tester.pump();
}

void main() {
  testWidgets('shows the moment it was given, box by box', (tester) async {
    await _pump(tester, _friday);

    expect(find.text('4-Fri'), findsOneWidget);
    expect(find.text('9-Sep'), findsOneWidget);
    expect(find.text('26'), findsOneWidget);
    expect(find.text('16'), findsOneWidget);
    expect(find.text('23'), findsOneWidget);
  });

  testWidgets('a scroll up over the day box moves to the next day',
      (tester) async {
    DateTime? changed;
    await _pump(tester, _friday, onChanged: (value) => changed = value);

    await _scroll(tester, 'day', -1);

    expect(changed, DateTime(2026, 9, 5, 16, 23));
  });

  testWidgets('the arrow keys spin the box that has focus', (tester) async {
    DateTime? changed;
    await _pump(tester, _friday, onChanged: (value) => changed = value);

    await _arrow(tester, 'minute', LogicalKeyboardKey.arrowUp);
    expect(changed, DateTime(2026, 9, 4, 16, 24));

    await _arrow(tester, 'hour', LogicalKeyboardKey.arrowDown);
    expect(changed, DateTime(2026, 9, 4, 15, 23));
  });

  testWidgets('a month step keeps the day inside the month it lands in',
      (tester) async {
    DateTime? changed;
    await _pump(
      tester,
      DateTime(2026, 3, 31, 9),
      onChanged: (value) => changed = value,
    );

    await _scroll(tester, 'month', -1);

    expect(
      changed,
      DateTime(2026, 4, 30, 9),
      reason: '31 April is 1 May if you let DateTime roll it',
    );
  });

  testWidgets('the floor is landed on, not scrolled past', (tester) async {
    DateTime? changed;
    await _pump(
      tester,
      _friday,
      notBefore: DateTime(2026, 9, 4),
      onChanged: (value) => changed = value,
    );

    await _scroll(tester, 'day', 1);

    expect(
      changed,
      DateTime(2026, 9, 4),
      reason: 'yesterday is not a thing anyone means to be reminded on',
    );
  });
}
