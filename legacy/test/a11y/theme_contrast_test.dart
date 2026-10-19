import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/theme/app_theme.dart';

/// WCAG 2.1 contrast, measured on the theme's own color roles.
///
/// This is deliberately NOT `meetsGuideline(textContrastGuideline)`. That
/// matcher rasterises the screen and reads a histogram out of the pixels,
/// which makes it a poor fit here for two reasons: it is sensitive to how
/// much background happens to fall inside a semantics node (the same
/// [GradientText] app-bar title passes on one screen and fails on another
/// purely because a neighbouring pill widened the node), and it cannot see a
/// role that no screen in the test happens to paint. Measuring the roles
/// themselves is exact, covers every pair whether or not a screen exercises
/// it, and says which token to change when it fails.
///
/// The numbers these assert were arrived at by a contrast pass over both
/// themes; the surfaces each pair is checked against are the real ones the
/// app paints on (see `AppColors`' surface ramp).

double _linear(double channel) => channel <= 0.03928
    ? channel / 12.92
    : math.pow((channel + 0.055) / 1.055, 2.4).toDouble();

double _luminance(Color c) =>
    0.2126 * _linear(c.r) + 0.7152 * _linear(c.g) + 0.0722 * _linear(c.b);

/// The WCAG contrast ratio between two opaque colors, 1.0 to 21.0.
double contrastRatio(Color a, Color b) {
  final la = _luminance(a);
  final lb = _luminance(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

/// [fg] composited over [bg] at [alpha] — what a tinted chip or badge
/// actually puts behind its own label.
Color _tint(Color fg, double alpha, Color bg) =>
    Color.alphaBlend(fg.withValues(alpha: alpha), bg);

/// WCAG AA for body text.
const _aaText = 4.5;

/// WCAG AA for a boundary or an icon that carries meaning on its own.
const _aaNonText = 3.0;

void _expectAtLeast(
  String what,
  Color fg,
  Color bg,
  double minimum,
) {
  final actual = contrastRatio(fg, bg);
  expect(
    actual,
    greaterThanOrEqualTo(minimum),
    reason: '$what is ${actual.toStringAsFixed(2)}:1, under the '
        '${minimum.toStringAsFixed(1)}:1 floor. Foreground '
        '#${fg.toARGB32().toRadixString(16).padLeft(8, '0').substring(2)} on '
        '#${bg.toARGB32().toRadixString(16).padLeft(8, '0').substring(2)}.',
  );
}

void main() {
  for (final theme in <ThemeData>[AppTheme.dark, AppTheme.light]) {
    final name = theme.brightness.name;
    final scheme = theme.colorScheme;
    final card = theme.cardTheme.color!;
    final scaffold = theme.scaffoldBackgroundColor;
    final status = theme.extension<GratovoStatusColors>()!;

    group('$name theme', () {
      test('body text reads on every surface it lands on', () {
        for (final (surfaceName, surface) in [
          ('surface', scheme.surface),
          ('card', card),
          ('scaffold', scaffold),
        ]) {
          _expectAtLeast(
              'onSurface on $surfaceName', scheme.onSurface, surface, _aaText);
          _expectAtLeast('onSurfaceVariant on $surfaceName',
              scheme.onSurfaceVariant, surface, _aaText);
        }
      });

      test('a filled role carries its own label', () {
        _expectAtLeast(
            'onPrimary on primary', scheme.onPrimary, scheme.primary, _aaText);
        _expectAtLeast('onSecondary on secondary', scheme.onSecondary,
            scheme.secondary, _aaText);
        _expectAtLeast('onTertiary on tertiary', scheme.onTertiary,
            scheme.tertiary, _aaText);
        _expectAtLeast(
            'onError on error', scheme.onError, scheme.error, _aaText);
        _expectAtLeast('onPrimaryContainer on primaryContainer',
            scheme.onPrimaryContainer, scheme.primaryContainer, _aaText);
        _expectAtLeast('onSecondaryContainer on secondaryContainer',
            scheme.onSecondaryContainer, scheme.secondaryContainer, _aaText);
        _expectAtLeast('onTertiaryContainer on tertiaryContainer',
            scheme.onTertiaryContainer, scheme.tertiaryContainer, _aaText);
        _expectAtLeast('onErrorContainer on errorContainer',
            scheme.onErrorContainer, scheme.errorContainer, _aaText);
        _expectAtLeast('onInverseSurface on inverseSurface',
            scheme.onInverseSurface, scheme.inverseSurface, _aaText);
      });

      test('an accent role used AS text reads on surface and on a card', () {
        // primary, secondary, tertiary and error are all read as a text or
        // icon color in feature code, not only as a fill — see e.g. the CRM
        // card's tertiary hint and every `colorScheme.error` message.
        for (final (roleName, role) in [
          ('primary', scheme.primary),
          ('secondary', scheme.secondary),
          ('tertiary', scheme.tertiary),
          ('error', scheme.error),
        ]) {
          _expectAtLeast(
              '$roleName as text on surface', role, scheme.surface, _aaText);
          _expectAtLeast('$roleName as text on card', role, card, _aaText);
        }
      });

      test('a status tone reads as the label of its own StatusBadge', () {
        // StatusBadge paints the label in the status color over a 15% tint of
        // that same color — the tint lifts the background toward the text, so
        // this is the tightest surface any status tone lands on.
        for (final (toneName, tone) in [
          ('success', status.success),
          ('warning', status.warning),
          ('info', status.info),
        ]) {
          _expectAtLeast('$toneName on a card', tone, card, _aaText);
          _expectAtLeast('$toneName in a badge on a card', tone,
              _tint(tone, 0.15, card), _aaText);
          _expectAtLeast('$toneName in a badge on a surface', tone,
              _tint(tone, 0.15, scheme.surface), _aaText);
        }
      });

      test('a boundary that carries meaning clears the non-text floor', () {
        _expectAtLeast(
            'outline on surface', scheme.outline, scheme.surface, _aaNonText);
        _expectAtLeast('outline on card', scheme.outline, card, _aaNonText);
        _expectAtLeast(
            'outlineVariant on card', scheme.outlineVariant, card, 1.3);
      });

      test('a gradient heading reads on the app bar wash behind it', () {
        // GradientAppBar lays `wash(brand)` over the surface; GradientText
        // paints the title in the `heading` ramp. Both ends of the title's
        // ramp are checked against both ends of the bar's.
        final gradients = theme.extension<GratovoGradients>()!;
        final washed = GratovoGradients.wash(gradients.brand);
        final bar = [
          for (final stop in washed.colors)
            Color.alphaBlend(stop, scheme.surface),
        ];
        for (final text in gradients.heading.colors) {
          for (final behind in bar) {
            _expectAtLeast(
                'a heading stop on the app bar', text, behind, _aaNonText);
          }
        }
      });
    });
  }
}
