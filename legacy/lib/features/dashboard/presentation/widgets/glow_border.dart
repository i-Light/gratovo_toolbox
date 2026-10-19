import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Draws a highlighted outline on a card's rounded rectangle. When [animate] is
/// on, a bright arc travels around it; otherwise it settles to a plain colored
/// border. One [AnimationController], a single stroked `RRect`, fenced off by a
/// [RepaintBoundary] — and the ticker is stopped whenever it is not animating,
/// so a static outline costs nothing per frame.
///
/// Shared between the dashboard's analytics section (filtered / pipeline-busy)
/// and its "New finds" tile (searching / backfilling / failed).
class GlowBorder extends StatefulWidget {
  const GlowBorder({
    super.key,
    required this.color,
    required this.baseAlpha,
    required this.animate,
    required this.child,
  });

  final Color color;

  /// Opacity of the full-perimeter outline when no arc is travelling over it.
  final double baseAlpha;

  final bool animate;
  final Widget child;

  @override
  State<GlowBorder> createState() => _GlowBorderState();
}

class _GlowBorderState extends State<GlowBorder>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2000),
  );

  @override
  void initState() {
    super.initState();
    if (widget.animate) _controller.repeat();
  }

  @override
  void didUpdateWidget(GlowBorder old) {
    super.didUpdateWidget(old);
    if (widget.animate && !_controller.isAnimating) {
      _controller.repeat();
    } else if (!widget.animate && _controller.isAnimating) {
      _controller.stop();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      // Pass our own constraints straight through, so the wrapped card keeps
      // the width it would have had unwrapped (a loose Stack would let a
      // small-content card shrink while the painted outline still filled the
      // slot).
      fit: StackFit.passthrough,
      children: [
        widget.child,
        Positioned.fill(
          child: IgnorePointer(
            child: RepaintBoundary(
              child: AnimatedBuilder(
                animation: _controller,
                builder: (context, _) => CustomPaint(
                  painter: _GlowBorderPainter(
                    progress: _controller.value,
                    color: widget.color,
                    baseAlpha: widget.baseAlpha,
                    sweep: widget.animate,
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _GlowBorderPainter extends CustomPainter {
  _GlowBorderPainter({
    required this.progress,
    required this.color,
    required this.baseAlpha,
    required this.sweep,
  });

  final double progress;
  final Color color;

  /// Opacity of the flat outline. Ignored while [sweep] is on, which fades it
  /// back so the travelling arc reads as the brighter thing.
  final double baseAlpha;

  /// Whether to overlay the travelling arc. When false, just the flat outline.
  final bool sweep;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final rrect = RRect.fromRectAndRadius(
      rect.deflate(2.2),
      const Radius.circular(18),
    );

    // The full-perimeter outline: faded under a travelling arc, at the caller's
    // weight without one.
    canvas.drawRRect(
      rrect,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4
        ..color = color.withValues(alpha: sweep ? 0.25 : baseAlpha),
    );
    if (!sweep) return;

    // A bright arc swept around the outline by `progress`.
    canvas.drawRRect(
      rrect,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4
        ..shader = SweepGradient(
          transform: GradientRotation(progress * 2 * math.pi),
          colors: [
            color.withValues(alpha: 0),
            color.withValues(alpha: 0),
            color.withValues(alpha: 0.9),
            color.withValues(alpha: 0),
          ],
          stops: const [0.0, 0.6, 0.78, 1.0],
        ).createShader(rect),
    );
  }

  @override
  bool shouldRepaint(_GlowBorderPainter old) =>
      old.progress != progress ||
      old.color != color ||
      old.baseAlpha != baseAlpha ||
      old.sweep != sweep;
}
