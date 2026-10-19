import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/video_date_field.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Pumps the field on its own with just enough app around it for
/// `AppLocalizations.of` to resolve, pinned to English so the month box reads
/// `4-April` and not its Arabic spelling.
Future<void> _pump(
  WidgetTester tester,
  DateTime? value, {
  ValueChanged<DateTime?>? onChanged,
  DateTime? firstDate,
  DateTime? lastDate,
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
          child: SizedBox(
            width: 260,
            child: VideoDateField(
              value: value,
              firstDate: firstDate,
              lastDate: lastDate,
              onChanged: onChanged ?? (_) {},
            ),
          ),
        ),
      ),
    ),
  );
}

Finder _seg(String name) => find.byKey(ValueKey('videoDate.$name'));

/// The text shown in one box. The day and year boxes are text fields; the
/// month box is a plain label.
String _box(WidgetTester tester, String name) {
  if (name == 'month') {
    return tester
        .widget<Text>(
            find.descendant(of: _seg(name), matching: find.byType(Text)))
        .data!;
  }
  return tester
      .widget<TextField>(
        find.descendant(of: _seg(name), matching: find.byType(TextField)),
      )
      .controller!
      .text;
}

/// Spins the wheel over one box. Negative dy is a scroll up, which counts up.
Future<void> _scroll(WidgetTester tester, String name, double dy) async {
  final pointer = TestPointer(1, PointerDeviceKind.mouse);
  final centre = tester.getCenter(_seg(name));
  await tester.sendEventToBinding(pointer.hover(centre));
  await tester.sendEventToBinding(pointer.scroll(Offset(0, dy)));
  await tester.pump();
}

void main() {
  testWidgets('splits an incoming date across the day, month and year boxes',
      (tester) async {
    await _pump(tester, DateTime(2026, 4, 9));

    expect(_box(tester, 'day'), '09');
    expect(_box(tester, 'month'), '4-April');
    expect(_box(tester, 'year'), '26');
  });

  testWidgets('a null value leaves every box empty', (tester) async {
    await _pump(tester, null);

    expect(_box(tester, 'day'), '');
    expect(_box(tester, 'month'), '—');
    expect(_box(tester, 'year'), '');
  });

  testWidgets('scrolling up over the day box counts it up', (tester) async {
    DateTime? captured;
    await _pump(tester, DateTime(2026, 4, 9), onChanged: (v) => captured = v);

    await _scroll(tester, 'day', -50);

    expect(_box(tester, 'day'), '10');
    expect(captured, DateTime(2026, 4, 10));
  });

  testWidgets('the day box wraps from 31 round to 01', (tester) async {
    await _pump(tester, DateTime(2026, 1, 31));

    await _scroll(tester, 'day', -50);

    expect(_box(tester, 'day'), '01');
  });

  testWidgets('the year box wraps from 50 round to 24', (tester) async {
    DateTime? captured;
    await _pump(tester, DateTime(2050, 4, 9), onChanged: (v) => captured = v);
    expect(_box(tester, 'year'), '50');

    await _scroll(tester, 'year', -50);

    expect(_box(tester, 'year'), '24');
    expect(captured, DateTime(2024, 4, 9));
  });

  testWidgets(
      'spinning one box of an empty field fills the other two with '
      'their defaults', (tester) async {
    DateTime? captured;
    await _pump(tester, null, onChanged: (v) => captured = v);

    await _scroll(tester, 'month', -50);

    expect(_box(tester, 'day'), '01');
    expect(_box(tester, 'month'), '1-January');
    expect(_box(tester, 'year'), '26');
    expect(captured, DateTime(2026, 1, 1));
  });

  testWidgets('a day that outruns the chosen month is pulled back to its last',
      (tester) async {
    DateTime? captured;
    await _pump(tester, DateTime(2026, 1, 31), onChanged: (v) => captured = v);

    // January -> February, with 31 still in the day box.
    await _scroll(tester, 'month', -50);

    expect(_box(tester, 'month'), '2-February');
    expect(_box(tester, 'day'), '28');
    expect(captured, DateTime(2026, 2, 28));
  });

  testWidgets(
      'arrow keys move a focused number box the same way the wheel does',
      (tester) async {
    DateTime? captured;
    await _pump(tester, DateTime(2026, 4, 9), onChanged: (v) => captured = v);

    await tester.tap(
      find.descendant(of: _seg('day'), matching: find.byType(TextField)),
    );
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pump();

    expect(captured, DateTime(2026, 4, 10));
  });

  testWidgets('typing a day into the box rebuilds the date', (tester) async {
    DateTime? captured;
    await _pump(tester, DateTime(2026, 4, 9), onChanged: (v) => captured = v);

    await tester.enterText(
      find.descendant(of: _seg('day'), matching: find.byType(TextField)),
      '15',
    );
    await tester.pump();

    expect(captured, DateTime(2026, 4, 15));
  });

  testWidgets('a value the parent drops to null empties the boxes',
      (tester) async {
    await _pump(tester, DateTime(2026, 4, 9));
    expect(_box(tester, 'day'), '09');

    await _pump(tester, null);

    expect(_box(tester, 'day'), '');
    expect(_box(tester, 'month'), '—');
    expect(_box(tester, 'year'), '');
  });

  group('bounds', () {
    testWidgets(
        'the wheel stops on the last allowed date instead of running '
        'past it', (tester) async {
      DateTime? reported;
      await _pump(
        tester,
        DateTime(2026, 8, 5),
        lastDate: DateTime(2026, 8, 5),
        onChanged: (value) => reported = value,
      );

      await _scroll(tester, 'day', -60);

      expect(_box(tester, 'day'), '05');
      expect(reported, DateTime(2026, 8, 5));
    });

    testWidgets('and on the first one at the other end', (tester) async {
      DateTime? reported;
      await _pump(
        tester,
        DateTime(2026, 7, 31),
        firstDate: DateTime(2026, 7, 31),
        onChanged: (value) => reported = value,
      );

      await _scroll(tester, 'day', 60);

      expect(_box(tester, 'day'), '31');
      expect(reported, DateTime(2026, 7, 31));
    });

    testWidgets(
        'a spin that overshoots lands on the bound, not one notch '
        'short of it', (tester) async {
      DateTime? reported;
      await _pump(
        tester,
        DateTime(2026, 3, 20),
        firstDate: DateTime(2026, 1, 10),
        lastDate: DateTime(2026, 8, 5),
        onChanged: (value) => reported = value,
      );

      // A year up from March 2026 is March 2027 — past the newest video date,
      // so it settles on that date rather than refusing to move.
      await _scroll(tester, 'year', -60);

      expect(reported, DateTime(2026, 8, 5));
      expect(_box(tester, 'day'), '05');
      expect(_box(tester, 'month'), '8-August');
      expect(_box(tester, 'year'), '26');
    });

    testWidgets(
        'inside the bounds the wheel behaves exactly as it does '
        'without them', (tester) async {
      DateTime? reported;
      await _pump(
        tester,
        DateTime(2026, 3, 20),
        firstDate: DateTime(2026, 1, 10),
        lastDate: DateTime(2026, 8, 5),
        onChanged: (value) => reported = value,
      );

      await _scroll(tester, 'day', -60);

      expect(_box(tester, 'day'), '21');
      expect(reported, DateTime(2026, 3, 21));
    });

    testWidgets(
        'a typed date outside them is left alone until the box loses '
        'focus', (tester) async {
      DateTime? reported;
      await _pump(
        tester,
        DateTime(2026, 3, 20),
        firstDate: DateTime(2026, 1, 10),
        lastDate: DateTime(2026, 8, 5),
        onChanged: (value) => reported = value,
      );

      await tester.enterText(
        find.descendant(of: _seg('year'), matching: find.byType(TextField)),
        '45',
      );
      await tester.pump();

      // Still 2045 while it is being typed — a "4" on the way to "45" has to
      // be allowed to land, and rewriting the box mid-keystroke is the bug
      // that rule exists to prevent.
      expect(_box(tester, 'year'), '45');

      await tester.tap(
        find.descendant(of: _seg('day'), matching: find.byType(TextField)),
      );
      await tester.pumpAndSettle();

      expect(_box(tester, 'year'), '26');
      expect(reported, DateTime(2026, 8, 5));
    });

    testWidgets('with no bounds the wheel still runs the whole segment range',
        (tester) async {
      await _pump(tester, DateTime(2026, 8, 5));
      await _scroll(tester, 'day', -60);
      expect(_box(tester, 'day'), '06');
    });
  });
}
