/// The dashboard's holographic-foil card treatment — a pale pearl base with
/// saturated color veins threading through it, lifted from a reference
/// photo of holographic foil and kept deliberately independent of
/// [AppColors]'s brand blue/magenta/rose (a wash of those hues just read as
/// a diluted brand card, not something new).
///
/// Used by the dashboard's headline cards: the stat tiles, My Day, and the
/// News/Logs peek cards. Not underscore-private like a normal single-file
/// widget because it has to be reachable from `my_day_section.dart` as well
/// as `dashboard_screen.dart`.
library;

import 'dart:math' as math;
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';

/// [pearl] is the pale near-white the reference photo's card is actually
/// made of. An early cut of this card washed [cyan]/[lilac]/[pink] at
/// ~20-30% alpha over a dark navy tile, which just drowned them back toward
/// navy — [HoloCard] paints them at full strength over [pearl] instead,
/// which is why it flips its content to a dark-on-light theme.
abstract final class HoloLight {
  static const pearl = Color(0xFFF3F1F7);
  static const cyan = Color(0xFF6FE3FF);
  static const lilac = Color(0xFFB08CFF);
  static const pink = Color(0xFFFF7FD4);
}

// const holoGradientStops = [0.0, 0.25, 0.5, 0.75, 1.0];

// abstract final class holoDark {
//   static const pearl = Color.fromARGB(255, 113, 153, 180);
//   static const cyan = Color.fromARGB(255, 199, 180, 87);
//   static const lilac = Color.fromARGB(255, 230, 115, 86);
//   static const pink = Color.fromARGB(255, 86, 86, 164);
// }

const holoGradientStops = <double>[
  // 0.0, // Deep shadow floor
  0.32, // Sharp jump into electric cyan
  0.48, // Smooth transition through violet
  0.64, // Hot neon pink flare
  0.78, // Warm golden crest
  // 1.0, // Return to obsidian shadow
];
const holoDark = <Color>[
  // AppColors.brandNavy,
  Color.fromARGB(
      255, 14, 165, 192), // Electric cyan (primary specular reflection)
  Color(0xFF6A19A8), // Deep violet (mid-tone bridge)
  Color(0xFFFF19C8), // Neon pink (chromatic fringe)
  Color.fromARGB(255, 54, 69, 110), // Soft gold (crested highlight)
  // AppColors.brandNavy,
];

/// The card's gradient background: [Holo.cyan]/[lilac]/[pink] each pulled
/// halfway back toward [Holo.pearl] — full strength (no alpha), so it stays
/// true color rather than a muddy tint, but calmer than the raw hues at
/// card size.
BoxDecoration buildHoloBackground({
  required Color pearl,
  required Color cyan,
  required Color lilac,
  required Color pink,
}) {
  return BoxDecoration(
    gradient: LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomRight,
      colors: [
        pearl,
        Color.lerp(cyan, pearl, 0.2)!,
        Color.lerp(lilac, pearl, 0.2)!,
        Color.lerp(pink, pearl, 0.2)!,
        pearl,
      ],
      stops: holoGradientStops,
    ),
  );
}

// final holoLightBg = buildHoloBackground(
//     pearl: HoloLight.pearl,
//     cyan: HoloLight.cyan,
//     lilac: HoloLight.lilac,
//     pink: HoloLight.pink);

// final holoDarkBg = buildHoloBackground(
//     pearl: HoloDark.pearl,
//     cyan: HoloDark.cyan,
//     lilac: HoloDark.lilac,
//     pink: HoloDark.pink);

// final _holoBackground = holoDarkBg;
BoxDecoration _holoBackground(
    double radius, List<Color> colors, List<double> steps) {
  return BoxDecoration(
    gradient: RadialGradient(
      center: const Alignment(1, 1),
      radius: radius,
      //   LinearGradient(
      // begin: Alignment.topCenter,
      // end: Alignment.bottomRight,
      colors: colors,
      // [
      //   HoloDark.pearl,
      //   Color.lerp(HoloDark.cyan, HoloDark.pearl, 0.0)!,
      //   Color.lerp(HoloDark.lilac, HoloDark.pearl, 0.0)!,
      //   Color.lerp(HoloDark.pink, HoloDark.pearl, 0.0)!,
      //   Color.lerp(HoloDark.pink, HoloDark.cyan, 0.6)!,
      // ],
      stops: steps,
    ),
  );
}

/// Wraps a card's content in the holo-foil treatment.
///
/// [builder] gets a [BuildContext] already wrapped in a dark-navy [Theme]
/// override (`textTheme`/`iconTheme`/`colorScheme`/`ListTileTheme`), so
/// ordinary `Theme.of(context).textTheme.*` calls, bare [Icon]s and
/// [ListTile]s already inside My Day / the peek cards pick up the right
/// color with no per-widget color threading.
class HoloCard extends StatelessWidget {
  const HoloCard({super.key, required this.builder});

  final WidgetBuilder builder;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    const fgDarkTheme = AppColors.lightBackground;
    final darkTheme = theme.copyWith(
      textTheme: theme.textTheme
          .apply(bodyColor: fgDarkTheme, displayColor: fgDarkTheme),
      iconTheme: theme.iconTheme.copyWith(color: fgDarkTheme),
      colorScheme: theme.colorScheme.copyWith(
        onSurface: fgDarkTheme,
        onSurfaceVariant: fgDarkTheme.withValues(alpha: 0.7),
      ),
      listTileTheme: theme.listTileTheme
          .copyWith(textColor: fgDarkTheme, iconColor: fgDarkTheme),
    );

    return Card(
      clipBehavior: Clip.antiAlias,
      elevation: 12,
      shadowColor: AppColors.primaryLight.withAlpha(150),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Stack(
        fit: StackFit.passthrough,
        children: [
          // 1. Smooth blurred background with zero edge vignette
          Positioned(
            top: -25,
            left: -25,
            right: -25,
            bottom: -25,
            child: LayoutBuilder(
              builder: (context, constraints) {
                final double w = constraints.maxWidth;
                final double h = constraints.maxHeight;
                final double shortestSide = math.min(w, h);

                // Clamping prevents wide banners from blowing out the gradient
                const double baseScale = 1.1;
                final double aspectMultiplier =
                    (w / shortestSide).clamp(1, 5.2);
                final double dynamicRadius = baseScale * aspectMultiplier;
                return ImageFiltered(
                  imageFilter: ImageFilter.blur(
                    sigmaX: 20,
                    sigmaY: 20,
                    tileMode: TileMode.clamp,
                  ),
                  child: DecoratedBox(
                      decoration: _holoBackground(
                          dynamicRadius, holoDark, holoGradientStops)),
                );
              },
            ),
          ),

          // 2. Foreground content
          Theme(
            data: darkTheme,
            child: Builder(builder: builder),
          ),
        ],
      ),
    );
  }
}

/// A small dark chip behind a card's leading icon, so a light-hued spark
/// color (the lemon-lime one, in particular) doesn't wash out against the
/// pastel gradient the way it does with no backing at all.
Widget holoIconBadge(IconData icon,
    {Color accent = AppColors.lightSurface, double size = 16}) {
  return Container(
    padding: const EdgeInsets.all(8),
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: AppColors.darkBackground.withValues(alpha: 0.85),
      border: BoxBorder.fromLTRB(
          bottom: BorderSide(
        width: 3,
        color: AppColors.lightBackground.withAlpha(80),
        strokeAlign: BorderSide.strokeAlignOutside,
      )),
    ),
    child: Icon(icon, color: accent, size: size),
  );
}

/// The card's two-tone accent edge: the tile's own spark color right at
/// the card boundary, with a slim dark separator just inside it setting it
/// off from the content — the separator reads as a groove cut *into* the
/// card, not a rim sitting outside the accent stripe.
///
/// Two nested borders because [Border] can't express a duotone stripe on a
/// single side by itself: the outer [DecoratedBox] paints the accent color
/// across its full (wider) bounds, right at the card's true edge, and the
/// inner one, inset by the accent's own width, paints the dark separator
/// just inside that — so painting order naturally puts the accent stripe
/// outermost and the dark line inside it.
Widget holoEdge({
  required Color accent,
  required Widget child,
  double radius = 13,
  double accentWidth = 5,
  double darkWidth = 3,
}) {
  return DecoratedBox(
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(radius),
      border: Border(
        right: BorderSide(color: accent, width: accentWidth + darkWidth),
      ),
    ),
    child: Padding(
      padding: EdgeInsets.only(right: accentWidth),
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(radius),
          border: Border(
            right: BorderSide(color: AppColors.brandNavy, width: darkWidth),
          ),
        ),
        child: child,
      ),
    ),
  );
}
