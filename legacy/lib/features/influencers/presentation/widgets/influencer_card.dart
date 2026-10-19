import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/images/image_preferences.dart';
import 'package:gratovo_toolbox/core/images/remote_image.dart';
import 'package:gratovo_toolbox/core/presence/presence_widgets.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/widgets/status_badge.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/video.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/archive_countdown_badge.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/channel_context_menu.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/influencer_list_tile.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// The card form of one channel, for the list's card view.
///
/// Shows the same facts as [InfluencerListTile] and shares its metric and tag
/// widgets, so the two views can never disagree about what a channel's numbers
/// are. What the card adds is the banner: deciding whether a channel *looks*
/// like a fit for a brand is a visual judgement, and it is the one thing a
/// dense row cannot show.
class InfluencerCard extends ConsumerWidget {
  const InfluencerCard({
    super.key,
    required this.influencer,
    this.latestVideo,
    this.showLatestVideo = false,
  });

  final Influencer influencer;

  /// The channel's newest stored upload, when the list is showing them. Fed
  /// from one batched query for the whole page rather than fetched here — see
  /// `latestVideosProvider`.
  final Video? latestVideo;

  /// Whether the list is IN upload mode, which is not the same as this channel
  /// having an upload. The grid reserves the strip's height for every tile when
  /// the mode is on, so a channel with nothing stored has to fill that space
  /// with a sentence rather than leave a hole that reads as a rendering fault.
  final bool showLatestVideo;

  /// Banner height. Fixed, and deliberately NOT scaled by the font slider: it
  /// carries no text of ours, so growing it would only push the text that does
  /// out of the tile.
  static const bannerHeight = 96.0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final tag = influencer.statusTag;
    final showImages = ref.watch(influencerListImagesProvider);

    // The tile is one thing you tap, and one thing you long-press for the
    // context menu — both actions land on a single node above the Card. Left
    // alone that node has no name, so a screen reader announces an empty
    // button and then reads the channel's name, counts and tags as separate
    // stops after it. Merging the subtree puts them *on* the button, which is
    // what the tile is. It has to sit out here, above ChannelContextMenu:
    // inside the Card it would be below the node that carries the actions.
    return MergeSemantics(
      child: PresenceBorder(
        type: 'channel',
        id: influencer.id,
        borderRadius: 12,
        child: ChannelContextMenu(
          influencer: influencer,
          child: ArchiveCountdownOverlay(
            influencer: influencer,
            child: Card(
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: () =>
                    context.go(AppRoutes.influencerDetail(influencer.id)),
                // Every part of this column is either a fixed height or Expanded.
                // That is what keeps it inside the grid tile's height whatever the
                // content is: a long channel name, four tags, or a reader who has
                // turned the font scale up. Laying it out as a plain stack of
                // intrinsic-height children overflowed by up to 228 pixels on the
                // seeded data alone.
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      height: bannerHeight,
                      width: double.infinity,
                      child: RemoteImage(
                        url: influencer.banner,
                        enabled: showImages,
                        height: bannerHeight,
                        fallback: ColoredBox(
                          color: theme.colorScheme.surfaceContainerHighest,
                        ),
                      ),
                    ),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                InfluencerAvatar(
                                  influencer: influencer,
                                  radius: 18,
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Text(
                                        influencer.displayName,
                                        style: theme.textTheme.titleSmall,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                      Text(
                                        influencer.handle,
                                        style:
                                            theme.textTheme.bodySmall?.copyWith(
                                          color: theme
                                              .colorScheme.onSurfaceVariant,
                                        ),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            // The one flexible child: the metrics take whatever
                            // height is left and ellipsize rather than push the
                            // status row off the bottom.
                            Expanded(
                              child: InfluencerMetricsLine(
                                influencer: influencer,
                                l10n: l10n,
                              ),
                            ),
                            if (showLatestVideo) ...[
                              const SizedBox(height: 5),
                              // Fixed height, like the banner: the strip is the
                              // reason the tile was made taller, and letting it
                              // size itself would put that growth back into the
                              // part of the tile the grid cannot give it.
                              SizedBox(
                                height: latestVideoStripHeight(context),
                                child: latestVideo == null
                                    ? Align(
                                        alignment:
                                            AlignmentDirectional.centerStart,
                                        child: Text(
                                          l10n.influencerListNoLatestVideo,
                                          style: theme.textTheme.bodySmall
                                              ?.copyWith(
                                            color: theme
                                                .colorScheme.onSurfaceVariant,
                                          ),
                                        ),
                                      )
                                    : LatestVideoStrip(
                                        video: latestVideo!,
                                        l10n: l10n,
                                      ),
                              ),
                            ],
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                StatusBadge(
                                  label: tag.label(l10n),
                                  color: tag.color(context),
                                ),
                                const SizedBox(width: 8),
                                if (influencer.channelTags.isNotEmpty)
                                  Expanded(
                                    // A Wrap here could grow to several lines and
                                    // was part of the overflow; on a card the tags
                                    // are secondary, so they get exactly one line
                                    // and clip.
                                    child: ChannelTagRow(
                                      tags: influencer.channelTags,
                                      maxTags: 2,
                                      singleLine: true,
                                    ),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
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

/// How tall the latest-upload strip is on a card.
///
/// Scaled by the reader's text size, because it is mostly text — the thumbnail
/// beside it is only 96 wide and fits inside whatever the text needs. Lives
/// here rather than in the strip so the grid delegate that has to reserve the
/// space and the widget that fills it agree by construction; two numbers
/// maintained separately is how a grid tile starts clipping.
///
/// 104, not 92. The strip stacks a one-line title, two lines of description
/// and a date inside 8px of padding on each side; against Material's default
/// text theme that measures 84, and 92 left the inner column overflowing by
/// exactly 8 pixels on every card with an upload to show. The remaining slack
/// is for a theme whose `bodySmall` is a point or two taller. It is slack
/// rather than politeness: the strip's inner column is `mainAxisSize.min` with
/// no flexible child — it has to be, because the row layout hands it an
/// unbounded height and a flex child there would throw — so on a card, which
/// is where the height is fixed, too little space overflows rather than
/// clipping.
double latestVideoStripHeight(BuildContext context) =>
    MediaQuery.textScalerOf(context).scale(104);
