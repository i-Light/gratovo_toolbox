import 'package:flutter/material.dart';

/// The app's brand/surface/status color tokens.
///
/// This used to also hold a large block of Monopoly-board-game-specific
/// colors (board tiles, property groups, mini-game difficulty tiers, player
/// pieces, "city" colors) from this project's previous life as a board-game
/// companion app. Those were deleted wholesale as part of repurposing this
/// design system for the Gratovo IMA ToolBox — none of them mean anything
/// in an influencer-marketing CRM. Only the generic brand/surface/status
/// tokens below survive, and every screen should reference these (or the
/// ones added here later) rather than hardcoding a `Color(0x...)` inline.
///
/// The brand palette is Gratovo's own: an indigo primary (`#4F46E5`) with a
/// violet tertiary and a rose secondary, over near-white light surfaces and
/// a deep indigo-navy (`#1E1B4B`) dark set. Feature code should almost never
/// touch these directly — read `Theme.of(context).colorScheme.*`, the
/// [GratovoStatusColors] extension, or [GratovoGradients] instead. These are
/// the seeds those are built from, in [AppTheme].
class AppColors {
  AppColors._();

  // Brand / Theme Colors — taken straight from the Gratovo logo's own
  // gradient, which sweeps deep blue → sky → magenta → rose (#105297,
  // #0079BA, #23A8F2, #CF53B8, #FB5B7B). The previous indigo/violet set was
  // a guess that never matched the mark on screen — hence the "weird" cast.
  static const Color primary = Color(0xFF0079BA); // logo mid-blue — seed
  static const Color primaryDark = Color(0xFF105297); // logo deep blue
  static const Color primaryLight = Color(0xFF23A8F2); // logo sky blue
  static const Color secondary = Color(0xFFFB5B7B); // logo rose
  static const Color tertiary = Color(0xFFCF53B8); // logo magenta
  static const Color accent = Color(0xFFFB5B7B); // alias of secondary

  // Spark hues — two deliberately off-brand accents used *sparingly* to keep
  // an all-blue/magenta screen from going monotone: a lemon-lime and a
  // periwinkle that sits between the logo's blue and its pink. Never a
  // surface color — only an icon, a 3px edge strip, or a chip. Reach for
  // them via the [GratovoAccents] theme extension.
  static const Color sparkCitron = Color(0xFFC7E25A); // lemon-lime
  static const Color sparkIris = Color(0xFF8B7BFF); // blue↔pink periwinkle

  /// The "archived" chart series — a muted plum that pairs with the bright
  /// blue "live" series without the shout of the full brand magenta. Archived
  /// data is context, not the headline, so its color is dialled down.
  static const Color archivedSeries = Color(0xFFD9A441);

  /// The "archive due" chart series — a warm amber sitting between the bright
  /// blue "live" series and the plum "archived" one, so a three-way stacked
  /// bar reads left to right as still-live, counting down, then gone. Amber
  /// rather than a third cool tone on purpose: it is the one series that still
  /// wants a "notice me" cast, since it is the population someone can still
  /// act on before it becomes [archivedSeries].
  static const Color archiveDueSeries = Color(0xFF9C6591);

  /// The darkest brand shade. Anchors the dark surface ramp below and the
  /// far stop of any deep brand gradient.
  static const Color brandNavy = Color(0xFF0A2A47); // deep ocean blue

  /// Muted foreground — captions, secondary labels on light surfaces.
  /// Roughly what `ColorScheme.fromSeed` derives for `onSurfaceVariant`
  /// in light mode, pinned so it's addressable by name where needed.
  static const Color mutedForeground = Color(0xFF5F6B7A);

  // Dark surfaces (default theme) — a deep blue-navy ramp pulled out of the
  // logo blue, with a deliberately wide spread top to bottom so that cards,
  // insets and the brand accents all read as distinctly lifted rather than
  // melting into one flat field.
  static const Color darkBackground = Color(0xFF071722);
  static const Color darkSurface = Color(0xFF0E2536);
  static const Color darkCardBright = Color(0xFF3C7199);
  static const Color darkCard = Color(0xFF15334A);
  static const Color darkBorder = Color(0xFF2F5A79);

  // Light surfaces — near-white with a faint blue cast.
  static const Color lightBackground = Color(0xFFF1F6FB);
  static const Color lightSurface = Color(0xFFFFFFFF);
  static const Color lightCard = Color(0xFFFFFFFF);
  static const Color lightBorder = Color(0xFFDCE8F2);

  static const Color offwhite = Color.fromARGB(255, 171, 200, 230);

  // Status & Feedback — semantic, not brand. Left as-is through the
  // rebrand: these must stay universally legible as "good / caution / bad /
  // note", which brand indigo and rose can't carry.
  //
  // These four are the DARK-theme tones, and the hue of record for each
  // meaning. A status color is read as text (see `StatusBadge`, which paints
  // its label in the color over a 15% tint of itself), so each one has to
  // clear WCAG AA — 4.5:1 — against the surface it lands on, and the surface
  // differs by theme. The `*OnLight` variants below are the same hue and
  // saturation taken down in lightness until they clear it on white; reach
  // for them through `GratovoStatusColors.of(brightness)` rather than by
  // name.
  static const Color success = Color(0xFF00C853);
  static const Color warning = Color(0xFFFFAB00);
  static const Color error = Color(0xFFE74C3C);
  static const Color info = Color(0xFF00B0FF);

  /// [success] lifted by a hair: the raw tone lands at 4.49:1 inside a
  /// dark-theme badge, one hundredth under the line.
  static const Color successOnDark = Color(0xFF00D257);

  /// [info] lifted just enough to clear 4.5:1 inside a dark-theme badge
  /// (the raw tone sits at 4.14:1 there — the only other one that misses on
  /// dark).
  static const Color infoOnDark = Color(0xFF29BDFF);

  // The light-theme status tones. The dark set on white reads 2.24:1
  // (success), 1.90:1 (warning) and 2.43:1 (info) — unreadable, and the
  // reason this split exists.
  static const Color successOnLight = Color(0xFF007832);
  static const Color warningOnLight = Color(0xFF8E5F00);
  static const Color infoOnLight = Color(0xFF006E9F);
}
