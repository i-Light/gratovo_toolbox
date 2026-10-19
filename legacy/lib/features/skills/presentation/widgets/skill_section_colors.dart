import 'package:flutter/material.dart';

/// Ten hues spread evenly around the wheel at the same saturation and
/// lightness, so any subset of them — the only way they are ever actually
/// seen, since a deck rarely has all ten — reads as one coordinated set
/// rather than a grab bag. Picked as `HSLColor` rather than fixed RGB so the
/// same formula holds in light and dark mode; only the alpha blended over the
/// surface (see [SkillSectionPalette]) needs to differ between them.
const _hueStep = 36.0;
final List<HSLColor> _paletteHues = List.generate(
  10,
  (i) => HSLColor.fromAHSL(1, (i * _hueStep) % 360, 0.55, 0.55),
);

/// One card's color, derived from its position in the deck.
///
/// Deliberately keyed by **position**, not by the card's id or a hash of its
/// heading: two adjacent cards always have adjacent indices, and adjacent
/// indices always land on different hues in [_paletteHues] (its length is
/// well over one) — so two neighbouring cards can never be assigned the same
/// color and silently blend into one another, without needing any
/// alternating-opacity trick to guarantee it. A color can repeat further
/// down a long deck once the palette wraps, which is fine: it is only
/// adjacency that must never be ambiguous.
class SkillSectionPalette {
  const SkillSectionPalette(this._hsl);

  factory SkillSectionPalette.forPosition(int position) {
    return SkillSectionPalette(_paletteHues[position % _paletteHues.length]);
  }

  final HSLColor _hsl;

  /// The band/border color — fully saturated, used at low opacity so it
  /// reads as a color-coding accent rather than a loud fill.
  Color accent(BuildContext context) => _hsl.toColor();

  /// The card's own background tint. [dimmed] (a team-only card) halves the
  /// opacity again on top of the base tint, which combined with the text
  /// opacity `SkillSectionCard` also applies is what reads as "this card
  /// exists but will not be exported".
  Color fill(BuildContext context, {bool dimmed = false}) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final base = dark ? 0.16 : 0.12;
    return _hsl.toColor().withValues(alpha: dimmed ? base * 0.5 : base);
  }

  /// The stronger tint used for the whole-document preview pane, where each
  /// section's block is colored to trace it back to its card — see
  /// `SkillGroupDeck`.
  Color previewTint(BuildContext context, {bool dimmed = false}) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final base = dark ? 0.22 : 0.16;
    return _hsl.toColor().withValues(alpha: dimmed ? base * 0.5 : base);
  }
}
