import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The "archives in N days" deadline, as a pill that floats off the
/// top-trailing corner of a channel tile.
///
/// It used to sit in [ChannelTagRow] alongside the channel's tags, but it is a
/// countdown, not a label, and on a dense row or a card the tag row had no
/// width to spare for a phrase this long — it pushed the actual tags out of
/// view. Floating it clear of the content keeps it visible without spending
/// any of the row's horizontal budget.
class ArchiveCountdownBadge extends StatelessWidget {
  const ArchiveCountdownBadge({super.key, required this.days});

  /// Whole days remaining; 0 renders as "archives today".
  final int days;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final l10n = AppLocalizations.of(context);

    return IgnorePointer(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          // Solid error fill rather than the tinted [StatusBadge] look: this
          // sits over the banner image on a card, and a translucent pill would
          // be unreadable against a busy one.
          color: scheme.error,
          borderRadius: BorderRadius.circular(999),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.2),
              blurRadius: 4,
              offset: const Offset(0, 1),
            ),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.schedule, size: 12, color: scheme.onError),
            const SizedBox(width: 4),
            Text(
              l10n.influencerArchivesIn(days),
              style: theme.textTheme.labelSmall?.copyWith(
                color: scheme.onError,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Hangs an [ArchiveCountdownBadge] off the top-trailing corner of [child]
/// when [influencer] is scheduled for archival, and returns [child] untouched
/// otherwise.
///
/// Mirrors how `PresenceBorder` floats its own label: a [Stack] with
/// `Clip.none` so the pill can sit slightly proud of the tile, positioned at
/// the trailing edge so it never collides with the presence label at the
/// leading one.
class ArchiveCountdownOverlay extends StatelessWidget {
  const ArchiveCountdownOverlay({
    super.key,
    required this.influencer,
    required this.child,
  });

  final Influencer influencer;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final days = influencer.daysUntilArchive;
    if (days == null) return child;

    return Stack(
      clipBehavior: Clip.none,
      children: [
        child,
        PositionedDirectional(
          top: -9,
          end: 8,
          child: ArchiveCountdownBadge(days: days),
        ),
      ],
    );
  }
}
