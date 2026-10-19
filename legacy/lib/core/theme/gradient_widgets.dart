import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/theme/app_theme.dart';

export 'package:gratovo_toolbox/core/theme/gradient_text.dart';

/// The two-tier gradient rule, as a shared flag: `important: false` (default)
/// picks the two-stop [GratovoGradients.brand], `important: true` picks the
/// three-stop [GratovoGradients.hero].
LinearGradient _pick(BuildContext context, {required bool important}) {
  final g = GratovoGradients.of(context);
  return important ? g.hero : g.brand;
}

/// A drop-in [AppBar] replacement that lays a translucent brand wash over the
/// themed bar color via [AppBar.flexibleSpace]. Same core API as [AppBar]
/// (title/leading/actions/bottom); reach for a plain [AppBar] only when you
/// need one of its rarer knobs.
class GradientAppBar extends StatelessWidget implements PreferredSizeWidget {
  const GradientAppBar({
    super.key,
    this.title,
    this.leading,
    this.actions,
    this.bottom,
    this.automaticallyImplyLeading = true,
    this.important = false,
  });

  final Widget? title;
  final Widget? leading;
  final List<Widget>? actions;
  final PreferredSizeWidget? bottom;
  final bool automaticallyImplyLeading;

  /// Use the three-stop hero gradient. Off by default — an app bar is
  /// chrome, not the screen's headline.
  final bool important;

  @override
  Size get preferredSize =>
      Size.fromHeight(kToolbarHeight + (bottom?.preferredSize.height ?? 0));

  @override
  Widget build(BuildContext context) {
    return AppBar(
      title: title,
      leading: leading,
      actions: actions,
      bottom: bottom,
      automaticallyImplyLeading: automaticallyImplyLeading,
      flexibleSpace: DecoratedBox(
        decoration: BoxDecoration(
          gradient: GratovoGradients.wash(_pick(context, important: important)),
        ),
      ),
    );
  }
}

/// A primary action rendered as a solid brand-gradient fill with white
/// label. Use for the one main call to action on a screen; leave secondary
/// and destructive actions as ordinary [OutlinedButton]/[TextButton].
///
/// `important: true` swaps the two-stop fill for the three-stop hero
/// gradient — for the rare button that is the whole point of the screen
/// (Start a search, Send, Sign in).
class GradientButton extends StatelessWidget {
  const GradientButton({
    super.key,
    required this.onPressed,
    required this.child,
    this.icon,
    this.important = false,
    this.padding = const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
  });

  final VoidCallback? onPressed;
  final Widget child;
  final Widget? icon;
  final bool important;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    final radius = BorderRadius.circular(12);
    return Opacity(
      opacity: enabled ? 1 : 0.45,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: _pick(context, important: important),
          borderRadius: radius,
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            onTap: onPressed,
            borderRadius: radius,
            child: Padding(
              padding: padding,
              child: DefaultTextStyle.merge(
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 15,
                  fontWeight: FontWeight.bold,
                ),
                child: IconTheme.merge(
                  data: const IconThemeData(color: Colors.white, size: 18),
                  child: icon == null
                      ? child
                      : Row(
                          mainAxisSize: MainAxisSize.min,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            icon!,
                            const SizedBox(width: 8),
                            child,
                          ],
                        ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A rounded container whose background is a brand gradient. Defaults to a
/// [GratovoGradients.wash] — a faint tint that lifts a panel off the flat
/// card color without shouting. Pass `wash: false` for a full-strength fill
/// (white content only), `important: true` for the three-stop hero gradient.
class GradientPanel extends StatelessWidget {
  const GradientPanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.borderRadius = 16,
    this.wash = true,
    this.important = false,
    this.washFrom = 0.18,
    this.washTo = 0.04,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double borderRadius;
  final bool wash;
  final bool important;
  final double washFrom;
  final double washTo;

  @override
  Widget build(BuildContext context) {
    final base = _pick(context, important: important);
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        gradient: wash
            ? GratovoGradients.wash(base, from: washFrom, to: washTo)
            : base,
        borderRadius: BorderRadius.circular(borderRadius),
      ),
      child: child,
    );
  }
}

/// A [Card] with a faint top-to-bottom brand-gradient wash over its themed
/// surface color — the treatment the dashboard stat tiles use.
///
/// Reach for it deliberately, on a card that is a screen's headline or a
/// section of its own (the dashboard tiles, the keyword panel) — not as a
/// blanket replacement for [Card]. A whole page of washed cards stacked up
/// reads as muddy, and on a very wide card a diagonal wash looks like a
/// lighting glitch, which is why this one runs straight down.
///
/// The wash is a plain [LinearGradient] in a [BoxDecoration] — a GPU shader,
/// no `Opacity` layer or blur — so it costs the same as a plain card.
///
/// * default — the two-stop [GratovoGradients.brand] wash (blue → magenta).
/// * `important: true` — the three-stop [GratovoGradients.hero] wash, for a
///   screen's headline cards (the dashboard tiles).
/// * `intensity` — scales the wash alpha around the app default of 1.0.
class GratovoCard extends StatelessWidget {
  const GratovoCard({
    super.key,
    required this.child,
    this.margin,
    this.color,
    this.clipBehavior = Clip.antiAlias,
    this.important = false,
    this.intensity = 1.0,
  });

  final Widget child;
  final EdgeInsetsGeometry? margin;
  final Color? color;

  /// Defaults to [Clip.antiAlias] (unlike [Card]'s [Clip.none]): the wash
  /// fills a rectangle, and without the clip it would square off the card's
  /// rounded corners.
  final Clip clipBehavior;

  final bool important;
  final double intensity;

  /// Wash strength, as [GratovoGradients.wash] `from` / `to` alpha at
  /// `intensity == 1`. This is used deliberately on a handful of feature
  /// surfaces now, not blanket-applied, so it can be strong enough to
  /// actually see — a barely-there tint just reads as a flat card that
  /// rendered slightly wrong.
  static const _washFrom = 0.32;
  static const _washTo = 0.15;

  @override
  Widget build(BuildContext context) {
    final washed = GratovoGradients.wash(
      _pick(context, important: important),
      from: _washFrom * intensity,
      to: _washTo * intensity,
    );
    return Card(
      margin: margin,
      color: color,
      clipBehavior: clipBehavior,
      child: DecoratedBox(
        decoration: BoxDecoration(
          // Straight down, not on the base gradient's diagonal — even on a
          // card several times wider than it is tall.
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: washed.colors,
            stops: washed.stops,
          ),
        ),
        child: child,
      ),
    );
  }
}

/// A full-bleed brand "room tone" for a screen body: a single-hue wash
/// anchored at one edge that fades to nothing before it reaches the other,
/// so content still sits on a clean surface.
///
/// This is the gradient treatment for big single-view screens — Scratchpad,
/// Outreach — where a per-card wash would just be noise but a faint
/// atmosphere behind the whole page reads well. Wrap the [Scaffold.body] in
/// it; it paints behind, and passes the child straight through.
///
/// Deliberately blue only (the [GratovoGradients] first stop), not the full
/// brand sweep — a screen background is the last place that wants pink.
class GradientBackdrop extends StatelessWidget {
  const GradientBackdrop({
    super.key,
    required this.child,
    this.from = Alignment.topCenter,
    this.strength = 0.16,
    this.extent = 0.6,
    this.colors,
    this.fade = true,
  });

  final Widget child;

  /// The edge the wash is strongest at; it fades toward the opposite edge.
  final Alignment from;

  /// Alpha of the wash at [from].
  final double strength;

  /// How far across the screen the wash has fully faded (0–1). Only
  /// meaningful when [fade] is true.
  final double extent;

  /// Custom gradient colors. If null, uses the default blue from [GratovoGradients.brand].
  /// Pass a list of colors to create a custom gradient wash.
  final List<Color>? colors;

  /// Whether the final color fades out to transparent. True (default)
  /// gives the "wash" look — the last color dissolves into the page
  /// before reaching the far edge. False renders a solid gradient through
  /// every supplied color with nothing fading to transparent, useful when
  /// you want the colors themselves to stay fully visible edge to edge.
  final bool fade;

  @override
  Widget build(BuildContext context) {
    final source = (colors != null && colors!.isNotEmpty)
        ? colors!
        : [GratovoGradients.of(context).brand.colors.first];
    final n = source.length;

    final List<Color> gradientColors;
    final List<double> gradientStops;
    if (n == 1) {
      gradientColors = [
        source.first.withValues(alpha: strength),
        source.first.withValues(alpha: fade ? 0 : strength),
      ];
      gradientStops = [0, extent];
    } else if (fade) {
      // Every color gets an equal band, blending straight into the next;
      // only the final band fades out to transparent.
      gradientColors = [
        for (final c in source) c.withValues(alpha: strength),
        source.last.withValues(alpha: 0),
      ];
      gradientStops = [
        for (var i = 0; i < n; i++) extent * i / n,
        extent,
      ];
    } else {
      // Solid multi-stop gradient across [0, extent] — every color stays
      // fully visible, nothing fades to transparent.
      gradientColors = [for (final c in source) c.withValues(alpha: strength)];
      gradientStops = [for (var i = 0; i < n; i++) extent * i / (n - 1)];
    }

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: from,
          end: -from,
          colors: gradientColors,
          stops: gradientStops,
        ),
      ),
      child: child,
    );
  }
}
