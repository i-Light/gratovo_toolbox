import 'dart:ui' as ui;

import 'package:flutter/foundation.dart' show ValueListenable;
import 'package:flutter/gestures.dart' show PointerHoverEvent, PointerExitEvent;
import 'package:flutter/material.dart';

/// ============================================================================
/// EDIT ME — every visual knob for the glow lives here.
/// ============================================================================
class GlowConfig {
  const GlowConfig._();

  /// Radius of the glow circle, in logical pixels.
  static const double radius = 250;

  /// Colors of the radial gradient, center → edge. Keep the last one fully
  /// transparent (alpha 0x00) so the glow fades out instead of cutting off.
  static const List<Color> colors = [
    // ui.Color.fromARGB(80, 241, 147, 84),
    ui.Color.fromARGB(72, 246, 176, 90),
    ui.Color.fromARGB(30, 246, 176, 90),
  ];
  // 1 for transparent color dynamically calculated down below
  static const List<double> stops = [0, 0.6, 1];

  /// How the glow blends with whatever's painted directly beneath it on the
  /// same layer (the card's own background/border, since we wrap just the
  /// card and don't isolate with a RepaintBoundary). Try BlendMode.plus,
  /// .screen, .softLight, .lighten, .overlay.
  static const BlendMode blendMode = BlendMode.overlay;
}

/// Wraps [child] — a card — with a small glow that follows the mouse while
/// it's over the card.
///
/// Usage: just wrap the card widget with it.
/// ```dart
/// MouseGlow(child: Card(...))
/// ```
///
/// No animation controller, no ticker: the cursor position lives in a
/// `ValueNotifier` that feeds a `CustomPainter` directly, so hovering only
/// ever repaints this one small circle — never triggers a widget rebuild.
class MouseGlow extends StatefulWidget {
  const MouseGlow({super.key, required this.child});

  final Widget child;

  @override
  State<MouseGlow> createState() => _MouseGlowState();
}

class _MouseGlowState extends State<MouseGlow> {
  final ValueNotifier<Offset?> _position = ValueNotifier(null);

  @override
  void dispose() {
    _position.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      opaque: false,
      onHover: (PointerHoverEvent event) =>
          _position.value = event.localPosition,
      onExit: (PointerExitEvent event) => _position.value = null,
      child: Stack(
        // clipBehavior: Clip.antiAlias,
        children: [
          widget.child,
          Positioned.fill(
            child: IgnorePointer(
              child: CustomPaint(painter: _GlowPainter(_position)),
            ),
          ),
        ],
      ),
    );
  }
}

/// Paints one radial-gradient circle at [position]'s current value.
class _GlowPainter extends CustomPainter {
  _GlowPainter(this.position) : super(repaint: position) {
    _paint.blendMode = GlowConfig.blendMode;
  }

  final ValueListenable<Offset?> position;
  final Paint _paint = Paint();

  @override
  void paint(Canvas canvas, Size size) {
    final center = position.value;
    if (center == null) return;

    _paint.shader = ui.Gradient.radial(
      center,
      GlowConfig.radius,
      [...GlowConfig.colors, GlowConfig.colors.last.withAlpha(0)],
      GlowConfig.stops,
    );
    canvas.drawCircle(center, GlowConfig.radius, _paint);
  }

  // Repaints are driven by [position] (passed as `repaint` above), so
  // there's nothing else to compare here.
  @override
  bool shouldRepaint(covariant _GlowPainter oldDelegate) => false;
}
