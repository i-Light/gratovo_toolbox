import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';

/// Semantic status colors with no slot in Material 3's [ColorScheme]
/// (success/warning/info — [ColorScheme.error] already covers the fourth).
///
/// Modeled as a [ThemeExtension] rather than a plain static class so each
/// tone can differ between [AppTheme.light] and [AppTheme.dark] later, and
/// so `ThemeData.lerp` (an animated theme switch) interpolates them
/// correctly — the pattern the Flutter team recommends for design tokens
/// that live outside the built-in [ColorScheme].
///
/// Fetch it via `Theme.of(context).extension<GratovoStatusColors>()!`
/// rather than importing [AppColors] directly in feature code. The main
/// planned consumer is the Deal-stage status pill (Won/Lost/Pending)
/// built in Phase 3.
@immutable
class GratovoStatusColors extends ThemeExtension<GratovoStatusColors> {
  const GratovoStatusColors({
    required this.success,
    required this.warning,
    required this.info,
  });

  final Color success;
  final Color warning;
  final Color info;

  /// The dark-theme tones, and what [AppColors] holds: saturated enough to
  /// read as "good / caution / note" at a glance on the navy ramp. Each one
  /// clears WCAG AA (4.5:1) as the *text* of a [StatusBadge], which paints
  /// the label in this color over a 15% tint of itself — the strictest
  /// surface any of them lands on. [AppColors.info] itself is a touch too
  /// dark for that (4.14:1), so the role lightens it.
  static const dark = GratovoStatusColors(
    success: AppColors.successOnDark,
    warning: AppColors.warning,
    info: AppColors.infoOnDark,
  );

  /// The light-theme tones. The dark set is unreadable on white — the amber
  /// lands at 1.9:1, the green at 2.2:1, the cyan at 2.4:1, all far under
  /// AA and all of them used as *text* by [StatusBadge]. These are the same
  /// three hues taken down in lightness until each clears 4.5:1 both on a
  /// white card and inside a badge's tint of itself.
  static const light = GratovoStatusColors(
    success: AppColors.successOnLight,
    warning: AppColors.warningOnLight,
    info: AppColors.infoOnLight,
  );

  /// The dark set, for the handful of callers that read the tones without a
  /// [BuildContext] to ask which theme is in play.
  static const standard = dark;

  static GratovoStatusColors of(Brightness brightness) =>
      brightness == Brightness.dark ? dark : light;

  @override
  GratovoStatusColors copyWith({Color? success, Color? warning, Color? info}) {
    return GratovoStatusColors(
      success: success ?? this.success,
      warning: warning ?? this.warning,
      info: info ?? this.info,
    );
  }

  @override
  GratovoStatusColors lerp(
    ThemeExtension<GratovoStatusColors>? other,
    double t,
  ) {
    if (other is! GratovoStatusColors) return this;
    return GratovoStatusColors(
      success: Color.lerp(success, other.success, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      info: Color.lerp(info, other.info, t)!,
    );
  }
}

/// The brand gradients, as a [ThemeExtension] so they animate correctly
/// across a light/dark switch (`ThemeData.lerp` interpolates each stop) and
/// so a future light/dark split is a one-line change here rather than a hunt
/// through feature code.
///
/// The rule is a two-tier one:
///
/// * [brand] — **two** stops, blue → magenta — is the default for ordinary
///   gradient use: screen/section headings, app bars, panels, chips.
/// * [hero] — **three** stops, sky blue → magenta → rose — is reserved for
///   the one or two things that matter most on a screen: the primary call to
///   action, a screen's hero header, a headline figure. The rose third stop
///   is what tells "important" apart from "normal" at a glance.
///
/// [accent] (rose → magenta) is a warm-led alternative when a gradient should
/// read as secondary rather than primary. [wash] turns any of them
/// translucent, for laying a brand tint *over* a surface color (app bars,
/// cards) without hiding what is beneath.
///
/// Fetch via `GratovoGradients.of(context)`.
@immutable
class GratovoGradients extends ThemeExtension<GratovoGradients> {
  const GratovoGradients({
    required this.brand,
    required this.hero,
    required this.accent,
    required this.heading,
  });

  /// Two stops, blue → magenta. The default gradient.
  final LinearGradient brand;

  /// Three stops, sky blue → magenta → rose. Important things only.
  final LinearGradient hero;

  /// Two stops, rose → magenta. A warm-led alternative to [brand].
  final LinearGradient accent;

  /// For gradient TEXT only — a luminous bright-sky → rose ramp, both stops
  /// well above body-text luminance so a headline set in it reads as *more*
  /// prominent than the copy around it, not less. [brand] is mid-toned (it
  /// has to carry white button labels), which left gradient headings looking
  /// dim on the navy surface.
  final LinearGradient heading;

  static const _brand = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [AppColors.primary, AppColors.tertiary],
  );

  static const _heading = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF45C4FF), Color(0xFFFF77A6)],
  );

  static const _hero = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    // The logo's own sweep: sky blue → magenta → rose.
    colors: [
      AppColors.primaryLight,
      AppColors.tertiary,
      AppColors.secondary,
    ],
  );

  static const _accent = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [AppColors.secondary, AppColors.tertiary],
  );

  /// The light-theme text ramps. [_heading] and [_hero] are luminous by
  /// design — they have to out-shine body copy on the navy surface — which
  /// makes them very nearly invisible the moment the same title is painted
  /// over a white app bar: the sky-blue stop measures **1.46:1** on the
  /// washed light bar, against a 3:1 floor. These are the same hues taken
  /// down in lightness until both ends clear 4:1 at every point of the bar's
  /// own wash, and they read *better* than the dark ones as a button fill,
  /// since the white label gains contrast as the fill darkens.
  static const _headingOnLight = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF006EA1), Color(0xFFD30049)],
  );

  static const _heroOnLight = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF06476B), Color(0xFF631C56), Color(0xFFAF0426)],
  );

  /// The dark set — the saturated logo hues, which are what [AppColors]
  /// holds and what the shipping theme uses.
  static const standard = GratovoGradients(
    brand: _brand,
    hero: _hero,
    accent: _accent,
    heading: _heading,
  );

  /// [brand] and [accent] are unchanged across the split: both are fills and
  /// washes that sit *behind* content rather than being read themselves, and
  /// they are the logo's own stops. Only the two ramps that are painted as
  /// text move.
  static const light = GratovoGradients(
    brand: _brand,
    hero: _heroOnLight,
    accent: _accent,
    heading: _headingOnLight,
  );

  static GratovoGradients forBrightness(Brightness brightness) =>
      brightness == Brightness.dark ? standard : light;

  static GratovoGradients of(BuildContext context) =>
      Theme.of(context).extension<GratovoGradients>() ?? standard;

  /// A translucent copy of [gradient]: alpha ramps from [from] on the first
  /// stop to [to] on the last, so a brand tint can sit over an existing
  /// surface without covering it. Used by [GradientAppBar] and the washed
  /// mode of [GradientPanel].
  static LinearGradient wash(
    LinearGradient gradient, {
    double from = 0.22,
    double to = 0.06,
  }) {
    final colors = gradient.colors;
    final lastIndex = colors.length - 1;
    return LinearGradient(
      begin: gradient.begin,
      end: gradient.end,
      stops: gradient.stops,
      colors: [
        for (var i = 0; i < colors.length; i++)
          colors[i].withValues(
            alpha: from + (to - from) * (lastIndex == 0 ? 0 : i / lastIndex),
          ),
      ],
    );
  }

  @override
  GratovoGradients copyWith({
    LinearGradient? brand,
    LinearGradient? hero,
    LinearGradient? accent,
    LinearGradient? heading,
  }) {
    return GratovoGradients(
      brand: brand ?? this.brand,
      hero: hero ?? this.hero,
      accent: accent ?? this.accent,
      heading: heading ?? this.heading,
    );
  }

  @override
  GratovoGradients lerp(ThemeExtension<GratovoGradients>? other, double t) {
    if (other is! GratovoGradients) return this;
    return GratovoGradients(
      brand: LinearGradient.lerp(brand, other.brand, t)!,
      hero: LinearGradient.lerp(hero, other.hero, t)!,
      accent: LinearGradient.lerp(accent, other.accent, t)!,
      heading: LinearGradient.lerp(heading, other.heading, t)!,
    );
  }
}

/// The two "spark" accents — a lemon-lime and a periwinkle — modelled as a
/// [ThemeExtension] for the same reasons as [GratovoGradients]: a light/dark
/// split later is a one-line change here, and `ThemeData.lerp` interpolates
/// them across an animated theme switch.
///
/// These are the counter-move to a screen full of blue and magenta cards.
/// Used *sparingly* — an icon, a 3px edge strip, a chip — never a surface
/// fill. Fetch via `GratovoAccents.of(context)`.
@immutable
class GratovoAccents extends ThemeExtension<GratovoAccents> {
  const GratovoAccents({required this.citron, required this.iris});

  /// Lemon-lime. Complements the blue primary; reads loudest of the two.
  final Color citron;

  /// Periwinkle, sitting between the logo's blue and its pink.
  final Color iris;

  static const standard = GratovoAccents(
    citron: AppColors.sparkCitron,
    iris: AppColors.sparkIris,
  );

  static GratovoAccents of(BuildContext context) =>
      Theme.of(context).extension<GratovoAccents>() ?? standard;

  @override
  GratovoAccents copyWith({Color? citron, Color? iris}) => GratovoAccents(
        citron: citron ?? this.citron,
        iris: iris ?? this.iris,
      );

  @override
  GratovoAccents lerp(ThemeExtension<GratovoAccents>? other, double t) {
    if (other is! GratovoAccents) return this;
    return GratovoAccents(
      citron: Color.lerp(citron, other.citron, t)!,
      iris: Color.lerp(iris, other.iris, t)!,
    );
  }
}

/// The app's light and dark themes.
///
/// Only [dark] actually ships in the UI today (the theme toggle in Settings
/// is Phase 4 work), but both are built from the start so "add a light
/// theme later" never means "go find every hardcoded color in every widget"
/// — it means "flip `themeModeProvider`". Every color/shape/text-style
/// decision lives here, in one place, rather than inline in feature code.
class AppTheme {
  AppTheme._();

  static const String _fontFamily = 'Cairo';

  // The per-brightness tones of the three pinned brand roles — see the
  // `copyWith` block in [_themeFrom] for why these exist. Hue and saturation
  // are the logo's; only lightness moves, and only far enough to clear
  // 4.5:1 as text on that theme's card.
  //
  //                      on the dark card        on the white card
  //   secondary  rose      4.29 -> 4.83            3.05 -> 4.62
  //   tertiary   magenta   3.48 -> 4.77            3.76 -> 4.75
  //   error      red       3.43 -> 4.61            3.82 -> 4.62
  static const Color _secondaryOnDark = Color(0xFFFB6F8B);
  static const Color _secondaryOnLight = Color(0xFFD8203F);
  static const Color _tertiaryOnDark = Color(0xFFDA7BC8);
  static const Color _tertiaryOnLight = Color(0xFFC336A9);
  static const Color _errorOnDark = Color(0xFFED7669);
  static const Color _errorOnLight = Color(0xFFDF2E1B);

  static ThemeData get dark => _themeFrom(
        brightness: Brightness.dark,
        scaffoldBackground: AppColors.darkBackground,
        surface: AppColors.darkSurface,
        card: AppColors.darkCard,
        cardBright: AppColors.darkCardBright,
        border: AppColors.darkBorder,
      );

  static ThemeData get light => _themeFrom(
        brightness: Brightness.light,
        scaffoldBackground: AppColors.lightBackground,
        surface: AppColors.lightSurface,
        card: AppColors.lightCard,
        cardBright: AppColors.lightCard,
        border: AppColors.lightBorder,
      );

  static ThemeData _themeFrom({
    required Brightness brightness,
    required Color scaffoldBackground,
    required Color surface,
    required Color card,
    required Color cardBright,
    required Color border,
  }) {
    final isDark = brightness == Brightness.dark;

    // ColorScheme.fromSeed derives a complete, harmonious, accessible
    // Material 3 tonal palette (containers, tertiary, outline, surface
    // variants, ...) from a single seed, rather than hand-picking every
    // slot — see theme_patterns.md in the flutter-dev skill.
    // `fromSeed` only takes one seed color (there's no secondary-seeding
    // parameter in the stable API, despite some third-party forks adding
    // one), so the brand's rose secondary and magenta tertiary are pinned
    // afterwards via `copyWith` — along with their `on*` pair colors, since
    // a generic algorithm can't be trusted to pick readable text over an
    // arbitrary override color: black clears 6:1 on the rose, white is the
    // conventional pairing on the magenta. Plus the custom blue-navy surface
    // tone and the loud brand error red.
    //
    // The second block repoints fromSeed's *neutral* family — the
    // surface-container ramp, the `*Variant` tones, the muted-label color.
    // fromSeed derives those at near-zero chroma, so over the blue-navy
    // scaffold they land as flat grey patches that read as "unstyled".
    // Retinting them blue keeps every card inset, divider and caption
    // on-palette without touching feature code. The ramp is spread wide
    // (lowest well below the scaffold, highest well above the card) so
    // surfaces stack with real depth instead of one flat field.
    //
    // The third block keeps the container pairs (`secondaryContainer`,
    // `tertiaryContainer`) on a toned blue / restrained magenta. An earlier
    // pass pinned `secondaryContainer` to the full brand ROSE to "break the
    // monochrome" — but every selected chip, segment, tonal button and
    // date-picker selection routes through that one role, so it put pink on
    // every screen. Brand color belongs in accents, not behind every
    // selected control.
    final colorScheme = ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      brightness: brightness,
    ).copyWith(
      // The three pinned brand roles, per brightness.
      //
      // `fromSeed` derives every role at a tone that reads on the brightness
      // it was asked for; pinning a role to a fixed brand hex throws that
      // away, and these three were pinned to one hex for both themes. The
      // logo's own rose, magenta and the brand red are mid-toned, which is
      // right behind a white button label and wrong *as* a label: on the dark
      // card they measured 4.29:1, 3.48:1 and 3.43:1, and `tertiary` and
      // `error` are read as text or an icon in a dozen screens (and by
      // `StatusBadge`). Each is the same hue and saturation, moved in
      // lightness only — lighter on the navy ramp, darker on white — until it
      // clears WCAG AA at 4.5:1 on the card, the tightest surface either one
      // lands on. The gradients keep the exact logo stops: those are
      // [GratovoGradients], seeded from [AppColors] directly, and a gradient
      // carries white text rather than being the text.
      secondary: isDark ? _secondaryOnDark : _secondaryOnLight,
      // The `on*` partner follows its role across the split: a tone light
      // enough to read on navy takes black, and the darker one it becomes on
      // white takes white. Pinning either to one color leaves the other pair
      // at ~4.2:1.
      onSecondary: isDark ? Colors.black : Colors.white,
      tertiary: isDark ? _tertiaryOnDark : _tertiaryOnLight,
      onTertiary: isDark ? Colors.black : Colors.white,
      surface: surface,
      error: isDark ? _errorOnDark : _errorOnLight,
      // Material's own convention for a dark scheme, and forced here by the
      // same arithmetic: once `error` is light enough to read as text on the
      // card, white on it is 2.8:1 and a dark red is 6:1.
      onError: isDark ? const Color(0xFF4A0C06) : Colors.white,
      // Neutral family — blue-tinted (dark) / faint-blue (light), so insets
      // and dividers stay on the logo's hue instead of drifting grey.
      surfaceContainerLowest:
          isDark ? const Color(0xFF040F17) : const Color(0xFFFFFFFF),
      surfaceContainerLow:
          isDark ? const Color(0xFF0B2030) : const Color(0xFFF3F8FD),
      surfaceContainer:
          isDark ? const Color(0xFF122A3D) : const Color(0xFFEDF3FA),
      surfaceContainerHigh:
          isDark ? const Color(0xFF1A374E) : const Color(0xFFE4EDF6),
      surfaceContainerHighest:
          isDark ? const Color(0xFF224460) : const Color(0xFFDAE6F1),
      onSurfaceVariant:
          isDark ? const Color(0xFFAEC2D6) : AppColors.mutedForeground,
      // 3:1 is the WCAG floor for a boundary that carries meaning (a focused
      // field, a chip's edge). The old light-theme tone sat at 2.48:1.
      outline: isDark ? const Color(0xFF607F99) : const Color(0xFF8097AE),
      outlineVariant: isDark ? AppColors.darkBorder : const Color(0xFFD3E0EC),
      // Selected chips, segmented buttons, tonal buttons and date-picker
      // selections all route through `secondaryContainer`. Pinning that to
      // the brand rose put pink on every selected control on every screen —
      // too much. It's a toned blue container now; rose stays a true accent
      // (the `secondary` role, the odd spark edge), not a background.
      secondaryContainer:
          isDark ? const Color(0xFF13415E) : const Color(0xFFCFE6F7),
      onSecondaryContainer:
          isDark ? const Color(0xFFCDE7F8) : const Color(0xFF0A3854),
      // A restrained magenta for the tertiary container pair — this role is
      // used far more sparingly, so a little brand color here is fine.
      tertiaryContainer:
          isDark ? const Color(0xFF3E2A3B) : const Color(0xFFF3E1EE),
      onTertiaryContainer:
          isDark ? const Color(0xFFEAD3E3) : const Color(0xFF3B1832),
    );

    final onSurface = colorScheme.onSurface;

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      scaffoldBackgroundColor: scaffoldBackground,
      colorScheme: colorScheme,
      fontFamily: _fontFamily,
      extensions: [
        GratovoStatusColors.of(brightness),
        GratovoGradients.forBrightness(brightness),
        GratovoAccents.standard,
      ],
      cardTheme: CardThemeData(
        color: card,
        elevation: 3,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: border, width: 1),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
        ),
        titleTextStyle: TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.bold,
          color: onSurface,
          fontFamily: _fontFamily,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          elevation: 2,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.bold,
            fontFamily: _fontFamily,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          // colorScheme.primary, not the raw brand indigo: `fromSeed` tones
          // it per brightness so it stays legible on both the navy dark
          // scaffold and the near-white light one.
          foregroundColor: colorScheme.primary,
          side: BorderSide(color: colorScheme.primary, width: 1.5),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.bold,
            fontFamily: _fontFamily,
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: card,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: colorScheme.primary, width: 2),
        ),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: surface,
        selectedIconTheme: IconThemeData(color: colorScheme.primary),
        selectedLabelTextStyle: TextStyle(
          color: colorScheme.primary,
          fontWeight: FontWeight.bold,
          fontFamily: _fontFamily,
        ),
        unselectedLabelTextStyle: TextStyle(
          color: isDark ? Colors.white70 : Colors.black54,
          fontFamily: _fontFamily,
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: surface,
        indicatorColor: colorScheme.primary.withValues(alpha: 0.2),
      ),
    );
  }
}
