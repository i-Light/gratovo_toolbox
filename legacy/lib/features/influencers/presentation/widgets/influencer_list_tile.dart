import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/images/image_preferences.dart';
import 'package:gratovo_toolbox/core/images/remote_image.dart';
import 'package:gratovo_toolbox/core/presence/presence_widgets.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/widgets/status_badge.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/video.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/archive_countdown_badge.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/channel_context_menu.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// One row in the Influencer Database list.
///
/// Everything shown here comes off the [Influencer] already in hand — name,
/// subscribers, uploads this month, average views this month, country, status
/// tag and channel tags. That is the point of widening the model: the row used
/// to watch a per-row provider for its deal badge, which is one extra query
/// per visible row, fifty queries to draw one screen. The `influencer_rows`
/// view computes all of it in the single query that fetched the page.
///
/// The one exception is [latestVideo], which is passed IN rather than watched.
/// It comes from one batched query for the whole page — see
/// `latestVideosProvider` — precisely so this row does not reintroduce the N+1
/// the view removed.
class InfluencerListTile extends StatelessWidget {
  const InfluencerListTile({
    super.key,
    required this.influencer,
    this.latestVideo,
  });

  final Influencer influencer;

  /// The channel's newest stored upload, when the list is showing them. Null
  /// both when the feature is off and when the channel has no stored videos —
  /// the row renders the same either way, since "we are not showing uploads"
  /// and "there are none" both come down to no upload on the row.
  final Video? latestVideo;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final tag = influencer.statusTag;

    // Borders the whole row in a teammate's color while they have this
    // channel open, so a duplicate effort is visible before it starts rather
    // than discovered afterwards. Costs nothing when nobody else is here —
    // PresenceBorder returns the child unchanged.
    return PresenceBorder(
      type: 'channel',
      id: influencer.id,
      borderRadius: 12,
      child: ChannelContextMenu(
        influencer: influencer,
        child: ArchiveCountdownOverlay(
          influencer: influencer,
          child: Card(
            child: InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: () =>
                  context.go(AppRoutes.influencerDetail(influencer.id)),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        InfluencerAvatar(influencer: influencer, radius: 22),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                influencer.displayName,
                                style: theme.textTheme.titleSmall,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              Text(
                                influencer.handle,
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 6),
                              InfluencerMetricsLine(
                                influencer: influencer,
                                l10n: l10n,
                              ),
                              if (influencer.channelTags.isNotEmpty) ...[
                                const SizedBox(height: 6),
                                ChannelTagRow(tags: influencer.channelTags),
                              ],
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        StatusBadge(
                          label: tag.label(l10n),
                          color: tag.color(context),
                        ),
                      ],
                    ),
                    if (latestVideo != null) ...[
                      const SizedBox(height: 10),
                      LatestVideoStrip(video: latestVideo!, l10n: l10n),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The channel's profile picture, falling back to its initial.
///
/// Goes through [RemoteImage], so it honours both picture settings: the local
/// copy is used first whatever they say, the Settings toggle decides whether a
/// fetched one is kept, and the list's own switch turns the request off
/// entirely. When pictures are off this is the initial — which is a usable
/// identifier in its own right, not a placeholder box.
class InfluencerAvatar extends ConsumerWidget {
  const InfluencerAvatar({
    super.key,
    required this.influencer,
    this.radius = 20,
  });

  final Influencer influencer;
  final double radius;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final showImages = ref.watch(influencerListImagesProvider);

    return SizedBox(
      width: radius * 2,
      height: radius * 2,
      child: ClipOval(
        child: RemoteImage(
          url: influencer.profilePicture,
          enabled: showImages,
          width: radius * 2,
          height: radius * 2,
          fallback: ColoredBox(
            color: theme.colorScheme.primaryContainer,
            child: Center(
              child: Text(
                _avatarInitial(influencer.displayName),
                style: TextStyle(
                  fontSize: radius * 0.8,
                  color: theme.colorScheme.onPrimaryContainer,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// First character, skipping a leading '@'. Takes a whole code point, not
  /// `name[0]` — a name that starts with an emoji ("🎮 Gamer") would otherwise
  /// hand `Text` a lone surrogate half, which the text engine rejects with
  /// "string is not well-formed UTF-16".
  static String _avatarInitial(String name) {
    final withoutAt = name.startsWith('@') ? name.substring(1) : name;
    if (withoutAt.isEmpty) return '?';
    return String.fromCharCode(withoutAt.runes.first).toUpperCase();
  }
}

/// Subscribers · uploads this month · average views this month · country.
///
/// Rendered as one wrapping line rather than a fixed column layout, because
/// the same widget serves a full-width desktop row and a narrow card, and a
/// column grid that fits one clips the other.
class InfluencerMetricsLine extends StatelessWidget {
  const InfluencerMetricsLine({
    super.key,
    required this.influencer,
    required this.l10n,
  });

  final Influencer influencer;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final parts = <String>[
      l10n.influencerSubscribersCount(influencer.subscriberCount),
      // A channel whose details have not reached this machine yet has no
      // upload figures at all — saying "no uploads this month" about it
      // would be inventing a dead channel out of a pull that has not run.
      if (influencer.detailsPending)
        l10n.influencerDetailsSyncingShort
      // Zero uploads is stated rather than shown as "0 videos this month",
      // which reads like a measurement error next to real counts.
      else if (influencer.videosLast30 > 0)
        l10n.influencerVideosThisMonth(influencer.videosLast30)
      else
        l10n.influencerNoUploadsThisMonth,
      // Average views is null when no upload this month had a view count —
      // which is a real state in this data, not a zero. Omitted rather than
      // shown as "0 avg views", which would read as a channel nobody watches.
      if (influencer.medianViewsLast30 != null)
        l10n.influencerAverageViewsShort(influencer.medianViewsLast30!),
      influencer.country ?? l10n.influencerCountryUnknown,
    ];

    return Text(
      parts.join('  ·  '),
      style: theme.textTheme.bodySmall,
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
    );
  }
}

/// The channel's newest stored upload: thumbnail, title, two lines of
/// description.
///
/// Optional, behind the list's own switch. What it is for: deciding whether a
/// channel is worth opening is mostly a question about what they have been
/// posting lately, and the alternative is opening every channel to find out.
/// What it costs: one more image per row, which is exactly why the switch that
/// turns pictures off exists next to it.
class LatestVideoStrip extends ConsumerWidget {
  const LatestVideoStrip({
    super.key,
    required this.video,
    required this.l10n,
  });

  final Video video;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final showImages = ref.watch(influencerListImagesProvider);
    final fmt = ref.watch(instantFormatterProvider);
    final description = video.description?.trim();

    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Reserved even with pictures off, so a page of rows keeps one left
          // edge for its text instead of two.
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: SizedBox(
              width: 96,
              child: AspectRatio(
                aspectRatio: 16 / 9,
                child: RemoteImage(
                  url: video.thumbnail,
                  enabled: showImages,
                  width: 96,
                  height: 96 * 9 / 16,
                  fallback: ColoredBox(
                    color: theme.colorScheme.surfaceContainerHighest,
                    child: Icon(
                      Icons.play_circle_outline,
                      size: 18,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  video.title,
                  style: theme.textTheme.bodyMedium,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  // Exactly two lines of description, as asked for. Whitespace
                  // is collapsed first: descriptions are mostly link dumps
                  // separated by blank lines, and honouring those would spend
                  // both lines on nothing.
                  description == null || description.isEmpty
                      ? l10n.influencerProfileVideoNoDescription
                      : description.replaceAll(RegExp(r'\s+'), ' '),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                if (video.publishedAt != null)
                  Text(
                    fmt.date(video.publishedAt!),
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The channel's tags. Distinct from the status badge beside them: several
/// can be true at once, which is why they are a row of small pills rather
/// than one badge — see [ChannelTag].
class ChannelTagRow extends StatelessWidget {
  const ChannelTagRow({
    super.key,
    required this.tags,
    this.maxTags = 4,
    this.singleLine = false,
  });

  final List<ChannelTag> tags;
  final int maxTags;

  /// Keeps every chip on one line, clipping rather than wrapping.
  ///
  /// A wrapping [Wrap] grows as tall as it needs, which is right in a list row
  /// (the row grows with it) and wrong in a fixed-height grid tile, where it
  /// pushes the content below it off the bottom. Cards pass true.
  final bool singleLine;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final shown = tags.take(maxTags).toList();
    final overflow = tags.length - shown.length;

    final chips = <Widget>[
      for (final tag in shown)
        Padding(
          padding:
              singleLine ? const EdgeInsets.only(right: 4) : EdgeInsets.zero,
          child: StatusBadge(label: tag.label(l10n), color: tag.color(context)),
        ),
      if (overflow > 0) Text('+$overflow', style: theme.textTheme.labelSmall),
    ];

    if (!singleLine) {
      return Wrap(spacing: 4, runSpacing: 4, children: chips);
    }
    // A ClipRect around a Row is not enough: it clips the painting, but the
    // Row still lays its children out at their intrinsic width and reports an
    // overflow. A scroll view gives the Row unbounded width, so there is no
    // overflow to report, and clips what does not fit. Scrolling is disabled
    // because these are a label, not a control — the full set is on the
    // channel's own page.
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      physics: const NeverScrollableScrollPhysics(),
      child: Row(mainAxisSize: MainAxisSize.min, children: chips),
    );
  }
}
