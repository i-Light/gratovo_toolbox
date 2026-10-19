import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/theme/app_theme.dart';

/// Paints [text] with a gradient fill instead of a flat color.
///
/// A [ShaderMask] over a plain [Text]: size, weight, letter-spacing and
/// line-height all come from the ambient [DefaultTextStyle] merged with the
/// optional [style], exactly as a normal text run — only the paint changes.
///
/// Follows the two-tier rule: the default is the luminous two-stop
/// [GratovoGradients.heading]; `important: true` switches to the three-stop
/// [GratovoGradients.hero] for a screen's single headline string. Pass an
/// explicit [gradient] to override both.
///
/// Fine for headings and short labels; keep it off running body text, where
/// a gradient fill just hurts readability.
class GradientText extends StatelessWidget {
  const GradientText(
    this.text, {
    super.key,
    this.gradient,
    this.important = false,
    this.style,
    this.textAlign,
    this.maxLines,
    this.overflow,
  });

  final String text;

  /// Overrides [important] when set. Defaults to the two-tier pick.
  final Gradient? gradient;

  /// Use the three-stop [GratovoGradients.hero] instead of the two-stop
  /// [GratovoGradients.brand].
  final bool important;

  final TextStyle? style;
  final TextAlign? textAlign;
  final int? maxLines;
  final TextOverflow? overflow;

  @override
  Widget build(BuildContext context) {
    final gradients = GratovoGradients.of(context);
    // Text wants its own luminous ramp, not [brand]: [brand] is mid-toned so
    // it can carry white button labels, which left gradient headings reading
    // *dimmer* than the copy around them. `important` keeps the three-stop
    // hero for a screen's one headline string (the wordmark).
    final effectiveGradient =
        gradient ?? (important ? gradients.hero : gradients.heading);

    // Start from the ambient DefaultTextStyle (so this reads as a normal text
    // run inside an AppBar title, a ListTile, a heading slot), layer the
    // caller's [style] on top, then force opaque white — srcIn keeps only
    // this child's alpha coverage and takes RGB from the shader, so the
    // child's own color is irrelevant except that it must be fully opaque.
    final resolved = DefaultTextStyle.of(context)
        .style
        .merge(style)
        .copyWith(color: Colors.white);

    return ShaderMask(
      blendMode: BlendMode.srcIn,
      shaderCallback: (bounds) => effectiveGradient.createShader(
        Rect.fromLTWH(0, 0, bounds.width, bounds.height),
      ),
      child: Text(
        text,
        style: resolved,
        textAlign: textAlign,
        maxLines: maxLines,
        overflow: overflow,
      ),
    );
  }
}
