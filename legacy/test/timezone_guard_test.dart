import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Guard for the timezone subsystem (plan §9, Stage 4).
///
/// Every instant in the app is stored UTC and only shifted into a wall clock
/// at render time, by `InstantFormatter` / `TzClock` against the user's
/// chosen display zone. A raw `DateFormat(...)` in a feature or widget
/// bypasses that and renders the device's local zone instead — a silent,
/// per-user-visible bug once someone picks a non-device display zone.
///
/// `lib/core/time/` is the one place allowed to touch `DateFormat` directly;
/// it is the implementation of the seam. Everything else must go through
/// `instantFormatterProvider`.
void main() {
  test('no raw DateFormat outside lib/core/time', () {
    final libDir = Directory('lib');
    final offenders = <String>[];

    final datePattern = RegExp(r'\bDateFormat\b');

    for (final entity in libDir.listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;

      final path = entity.path.replaceAll(r'\', '/');
      // Allowed: the seam itself, and generated l10n (its DateFormat use is
      // driven by the arb files, which the same guard covers via review).
      if (path.startsWith('lib/core/time/')) continue;
      if (path.startsWith('lib/l10n/gen/')) continue;

      final lines = entity.readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        final line = lines[i];
        // Skip comment lines — doc comments legitimately name the class.
        final trimmed = line.trimLeft();
        if (trimmed.startsWith('//') ||
            trimmed.startsWith('*') ||
            trimmed.startsWith('///')) {
          continue;
        }
        if (datePattern.hasMatch(line)) {
          offenders.add('$path:${i + 1}: ${line.trim()}');
        }
      }
    }

    expect(
      offenders,
      isEmpty,
      reason: 'Render instants through instantFormatterProvider, not a raw '
          'DateFormat:\n${offenders.join('\n')}',
    );
  });

  test('parseDate normalises to UTC (arb DateTime placeholders stay String)',
      () {
    // A cheap tripwire for a regression that reverts the flip: if any arb
    // placeholder is re-typed as DateTime, gen-l10n would format it in the
    // device zone again.
    final en = File('lib/l10n/app_en.arb').readAsStringSync();
    expect(
      en.contains('"type": "DateTime"'),
      isFalse,
      reason: 'arb date placeholders must be String and pre-formatted by the '
          'caller via instantFormatterProvider.',
    );
  });
}
