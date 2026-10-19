import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The channel's recent upload times, as one horizontally scrolling row above
/// the composer — purely a timing reference: "what day and what time of day
/// does this person publish".
///
/// Deliberately not a heatmap or a "typical window" summary and deliberately
/// not fed to the AI draft: it is here for the human writing the message to
/// glance at. Each stamp is `Weekday DD, HH:mm` in the display time zone, and
/// nothing else — no month, no year, no view count. Those were on it when it
/// was a vertical list, and each of them was a reason for the reference to be
/// eight lines tall in the middle of the page somebody came here to write on.
/// The pattern being looked for is a weekday and a clock time; everything else
/// was noise around it.
///
/// Newest first, left to right. An upload with no known publish date reads
/// "date unknown" rather than being dropped, because an absent stamp and an
/// absent upload are not the same thing.
class RecentUploadsReference extends ConsumerWidget {
  const RecentUploadsReference({
    super.key,
    required this.influencerId,
    this.max = 8,
  });

  final String influencerId;
  final int max;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final videosAsync = ref.watch(videosByInfluencerProvider(influencerId));
    final fmt = ref.watch(instantFormatterProvider);

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.outreachRecentUploadsTitle,
              style: theme.textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            videosAsync.when(
              loading: () => const SizedBox(
                height: 28,
                child: Center(
                  child: SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              ),
              error: (error, stackTrace) => Text(
                l10n.commonError,
                style: theme.textTheme.bodySmall,
              ),
              data: (videos) {
                if (videos.isEmpty) {
                  return Text(
                    l10n.influencerListNoLatestVideo,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  );
                }
                final shown = videos.take(max).toList();
                // A fixed height and a horizontal scroll view rather than a
                // Wrap: wrapping would put the row back to being however many
                // lines tall the channel's upload count decides, which is the
                // thing this stopped doing.
                return SizedBox(
                  height: 28,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: shown.length,
                    separatorBuilder: (_, __) => const SizedBox(width: 8),
                    itemBuilder: (context, index) => _UploadStamp(
                      label: fmt.uploadLine(
                        shown[index].publishedAt,
                        unknown: l10n.commonDateUnknown,
                      ),
                    ),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// One upload time, as a pill.
///
/// A pill rather than bare text because the row is a scroll of short strings
/// with no other separator: `Thu 14, 21:40 Wed 13, 19:02` runs together at a
/// glance, and the whole point of the row is being glanceable.
class _UploadStamp extends StatelessWidget {
  const _UploadStamp({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      alignment: Alignment.center,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Text(
        label,
        style: theme.textTheme.bodySmall,
        maxLines: 1,
        softWrap: false,
      ),
    );
  }
}
