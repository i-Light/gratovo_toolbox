import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/theme/app_theme.dart';
import 'package:gratovo_toolbox/features/settings/application/settings_attention_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The color a given attention level is drawn in, shared by the nav-rail dot
/// and the card outline so the two always agree. A yellow dot that leads to a
/// red-outlined card would be two different claims about the same fact.
Color attentionColor(BuildContext context, AttentionLevel level) {
  final scheme = Theme.of(context).colorScheme;
  final custom = Theme.of(context).extension<GratovoStatusColors>();
  return switch (level) {
    AttentionLevel.urgent => scheme.error,
    AttentionLevel.warning => custom?.warning ?? scheme.tertiary,
    AttentionLevel.info => custom?.info ?? scheme.primary,
  };
}

/// Wraps a Settings card and outlines it when that card is the reason the nav
/// icon is badged.
///
/// This exists because the badge alone was a dead end: it says something on
/// this page wants a look, and then leaves you to find it among eight cards
/// that look identical. The outline is the other half of that sentence.
///
/// Nothing is drawn when the card is fine — no reserved space, no faint
/// always-on border — so the outline means exactly one thing when it appears.
class AttentionOutline extends ConsumerWidget {
  const AttentionOutline({
    super.key,
    required this.target,
    required this.child,
  });

  final SettingsAttentionTarget target;
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final attention = ref.watch(settingsAttentionProvider);
    final level = attention.levelFor(target);
    if (level == null) return child;

    final l10n = AppLocalizations.of(context);
    final color = attentionColor(context, level);
    final reasons = attention.reasonsFor(target);

    return Semantics(
      // The outline is a color, and a color on its own is not a message —
      // this is what a screen reader, and anyone who cannot separate the two
      // tones, gets instead.
      label: reasons.map((r) => _reasonLabel(l10n, r)).join('. '),
      container: true,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: color, width: 2),
              boxShadow: [
                BoxShadow(
                  color: color.withValues(alpha: 0.25),
                  blurRadius: 18,
                  spreadRadius: 1,
                ),
              ],
            ),
            child: child,
          ),
          // The reason, spelled out on the card itself. Without it the outline
          // says "this one" but still not "why", and the why is usually the
          // part that decides whether it is worth dealing with now.
          Positioned(
            top: -10,
            right: 16,
            child: Material(
              color: color,
              borderRadius: BorderRadius.circular(10),
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                child: Text(
                  reasons.map((r) => _reasonLabel(l10n, r)).join(' · '),
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: _onColor(context, color),
                        fontWeight: FontWeight.w700,
                      ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  static String _reasonLabel(
    AppLocalizations l10n,
    SettingsAttentionReason reason,
  ) =>
      switch (reason) {
        SettingsAttentionReason.updateAvailable => l10n.settingsAttentionUpdate,
        SettingsAttentionReason.credentialRejected =>
          l10n.settingsAttentionRejected,
        SettingsAttentionReason.credentialExpiring =>
          l10n.settingsAttentionExpiring,
      };

  /// Black or white, whichever the chip's fill can actually carry. The
  /// warning tone is light enough that white-on-it is unreadable, and the
  /// error tone dark enough that black is.
  static Color _onColor(BuildContext context, Color background) =>
      ThemeData.estimateBrightnessForColor(background) == Brightness.dark
          ? Colors.white
          : Colors.black;
}
