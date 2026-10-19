import 'package:flutter/material.dart';

/// A small capsule for an accounts-list section header, so a problem (or a
/// setting worth knowing) reads at a glance without expanding the section.
///
/// Two tones: [SectionStatusChip.attention] for something that needs a look
/// (signed out, disconnected, an error), in the same error-container
/// language `_AccessLevelChip`'s unauthorized case already uses in
/// `account_card.dart`; [SectionStatusChip.info] for a plain fact (AWS
/// Gateway IP rotation on/off) that is not a problem either way.
class SectionStatusChip extends StatelessWidget {
  const SectionStatusChip.attention({
    super.key,
    required this.label,
    this.tooltip,
  })  : icon = Icons.warning_amber_outlined,
        _attention = true;

  const SectionStatusChip.info({
    super.key,
    required this.label,
    this.tooltip,
    this.icon = Icons.info_outline,
  }) : _attention = false;

  final String label;
  final String? tooltip;
  final IconData icon;
  final bool _attention;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final (background, foreground) = _attention
        ? (colors.errorContainer, colors.onErrorContainer)
        : (colors.surfaceContainerHighest, colors.onSurfaceVariant);

    final chip = Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: foreground),
          const SizedBox(width: 4),
          // Flexible, because `mainAxisSize.min` says what this Row *wants*,
          // not what it is given: in a narrow card at a large font scale the
          // header around it hands the chip less than the label needs, and
          // an unflexible Text has no answer to that but to overflow.
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context)
                  .textTheme
                  .labelSmall
                  ?.copyWith(color: foreground),
            ),
          ),
        ],
      ),
    );

    final message = tooltip;
    return message == null ? chip : Tooltip(message: message, child: chip);
  }
}
