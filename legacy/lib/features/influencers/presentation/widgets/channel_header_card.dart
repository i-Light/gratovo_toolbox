import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/images/remote_image.dart';
import 'package:gratovo_toolbox/core/presence/presence_widgets.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/core/widgets/image_viewer_dialog.dart';
import 'package:gratovo_toolbox/core/widgets/status_badge.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/influencers/application/crm_calculator.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// The channel, as a channel: its art, its name, its description, its numbers.
///
/// This card is also where the page's presence border lives. It used to sit
/// around the notes field, which was the wrong place twice over — it made the
/// notes box look like the thing under contention when the contention is over
/// the channel, and it drew a colored rectangle around a text field in a way
/// that read as a validation error. A border around the header says "somebody
/// else is on this channel" once, at the top, where it is read before any work
/// starts rather than after it.
class ChannelHeaderCard extends ConsumerWidget {
  const ChannelHeaderCard({
    super.key,
    required this.influencer,
    required this.l10n,
  });

  final Influencer influencer;
  final AppLocalizations l10n;

  static const _bannerHeight = 132.0;
  static const _avatarRadius = 38.0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final hasBanner = isUsableImageUrl(influencer.banner);

    return PresenceBorder(
      type: 'channel',
      id: influencer.id,
      borderRadius: 12,
      child: Card(
        clipBehavior: Clip.antiAlias,
        margin: EdgeInsets.zero,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (hasBanner)
              _Banner(
                url: influencer.banner!,
                title: influencer.displayName,
                l10n: l10n,
              ),
            Padding(
              padding: EdgeInsets.fromLTRB(16, hasBanner ? 12 : 16, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _IdentityRow(
                    influencer: influencer,
                    l10n: l10n,
                    avatarRadius: _avatarRadius,
                  ),
                  const SizedBox(height: 12),
                  // The description sits WITH the numbers, on one line, at
                  // every width — see [_ExpandableDescription].
                  _ExpandableDescription(
                    description: influencer.description,
                    l10n: l10n,
                  ),
                  const SizedBox(height: 12),
                  _StatsWrap(
                    influencer: influencer,
                    l10n: l10n,
                    // "median views · all stored" — computed here from the
                    // videos the page already loads for the CRM calculator, so
                    // it costs nothing and needs no schema column.
                    medianViewsAll: medianViewsAcrossVideos(
                      ref
                          .watch(videosByInfluencerProvider(influencer.id))
                          .maybeWhen(
                            data: (list) => list,
                            orElse: () => const [],
                          ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  // How old these numbers are. Worth stating plainly rather
                  // than leaving to be assumed: a subscriber count from three
                  // weeks ago is exactly the kind of thing that gets quoted to
                  // a brand as current.
                  Text(
                    influencer.lastFetchedAt == null
                        ? l10n.influencerProfileNeverUpdated
                        : l10n.influencerProfileLastUpdated(
                            fmt.date(influencer.lastFetchedAt!),
                          ),
                    style: theme.textTheme.bodySmall,
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      _ContactButton(influencer: influencer, l10n: l10n),
                      OutlinedButton.icon(
                        onPressed: () async {
                          await Clipboard.setData(
                            ClipboardData(text: influencer.channelUrl),
                          );
                          if (context.mounted) {
                            AppToast.success(context, influencer.channelUrl);
                          }
                        },
                        icon: const Icon(Icons.link),
                        label: Text(l10n.influencerProfileOpenChannel),
                      ),
                      if (influencer.lastVideoAt != null)
                        Align(
                          alignment: Alignment.center,
                          child: Text(
                            '${l10n.influencerProfileLastVideo}: '
                            '${fmt.date(influencer.lastVideoAt!)}',
                            style: theme.textTheme.bodySmall,
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The banner, tappable to open full size.
class _Banner extends StatelessWidget {
  const _Banner({
    required this.url,
    required this.title,
    required this.l10n,
  });

  final String url;
  final String title;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Tooltip(
      message: l10n.influencerProfileViewBanner,
      child: InkWell(
        onTap: () => ImageViewerDialog.show(
          context,
          url: url,
          title: title,
        ),
        child: SizedBox(
          height: ChannelHeaderCard._bannerHeight,
          width: double.infinity,
          child: Stack(
            fit: StackFit.expand,
            children: [
              RemoteImage(
                url: url,
                height: ChannelHeaderCard._bannerHeight,
                fallback: ColoredBox(
                  color: theme.colorScheme.surfaceContainerHighest,
                ),
              ),
              // A small affordance rather than an overlay across the whole
              // banner: the banner is the content, and dimming it to advertise
              // that it can be enlarged defeats the purpose of showing it.
              PositionedDirectional(
                end: 8,
                bottom: 8,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.45),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: const Padding(
                    padding: EdgeInsets.all(6),
                    child:
                        Icon(Icons.zoom_out_map, size: 16, color: Colors.white),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Avatar, name, handle, who else is here, and the vetting badge.
class _IdentityRow extends StatelessWidget {
  const _IdentityRow({
    required this.influencer,
    required this.l10n,
    required this.avatarRadius,
  });

  final Influencer influencer;
  final AppLocalizations l10n;
  final double avatarRadius;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Tooltip(
          message: l10n.influencerProfileViewProfilePicture,
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: () => ImageViewerDialog.show(
              context,
              url: influencer.profilePicture,
              title: influencer.displayName,
              circular: true,
            ),
            child: _ProfilePicture(
              influencer: influencer,
              radius: avatarRadius,
            ),
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              // Name and "who else is here" on one line, which is where the
              // owner asked for it: the same place the Influencers list puts
              // it, so the answer to "is someone already on this" is in the
              // same spot on both screens.
              Row(
                children: [
                  Flexible(
                    child: Text(
                      influencer.displayName,
                      style: theme.textTheme.titleLarge,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 8),
                  EntityPresenceAvatars(
                    type: 'channel',
                    id: influencer.id,
                    radius: 11,
                  ),
                ],
              ),
              Text(
                influencer.handle,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              if (influencer.channelTags.isNotEmpty) ...[
                const SizedBox(height: 6),
                Wrap(
                  spacing: 4,
                  runSpacing: 4,
                  children: [
                    for (final tag in influencer.channelTags)
                      StatusBadge(
                        label: tag.label(l10n),
                        color: tag.color(context),
                      ),
                  ],
                ),
              ],
            ],
          ),
        ),
        const SizedBox(width: 8),
        StatusBadge(
          label: influencer.vettingStatus.label(l10n),
          color: influencer.vettingStatus.color(context),
        ),
      ],
    );
  }
}

class _ProfilePicture extends StatelessWidget {
  const _ProfilePicture({required this.influencer, required this.radius});

  final Influencer influencer;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final name = influencer.displayName.startsWith('@')
        ? influencer.displayName.substring(1)
        : influencer.displayName;
    // A whole code point, not name[0]: a name starting with an emoji would
    // otherwise pass Text a lone surrogate half ("string is not well-formed
    // UTF-16").
    final initial = name.isEmpty
        ? '?'
        : String.fromCharCode(name.runes.first).toUpperCase();

    return SizedBox(
      width: radius * 2,
      height: radius * 2,
      child: ClipOval(
        child: RemoteImage(
          url: influencer.profilePicture,
          width: radius * 2,
          height: radius * 2,
          fallback: ColoredBox(
            color: theme.colorScheme.primaryContainer,
            child: Center(
              child: Text(
                initial,
                style: theme.textTheme.headlineSmall?.copyWith(
                  color: theme.colorScheme.onPrimaryContainer,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The channel's own description, on ONE line until it is asked for.
///
/// A channel description is frequently several hundred words — an upload
/// schedule, a sponsor list, a Patreon pitch, a wall of hashtags. Laid out in
/// full it pushes every number on this card below the fold, and the numbers are
/// what the page is for. One line reading is enough to tell whether the rest is
/// worth opening, and it is a fixed cost at every window width, which is what
/// the owner asked for: the same single line whatever the screen size, with the
/// rest clipped until it is tapped.
class _ExpandableDescription extends StatefulWidget {
  const _ExpandableDescription({
    required this.description,
    required this.l10n,
  });

  final String? description;
  final AppLocalizations l10n;

  @override
  State<_ExpandableDescription> createState() => _ExpandableDescriptionState();
}

class _ExpandableDescriptionState extends State<_ExpandableDescription> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = widget.l10n;
    final description = widget.description?.trim();

    if (description == null || description.isEmpty) {
      return Text(
        l10n.influencerProfileNoDescription,
        style: theme.textTheme.bodySmall?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      );
    }

    return Tooltip(
      message: _expanded
          ? l10n.influencerProfileShowLessDescription
          : l10n.influencerProfileShowFullDescription,
      child: InkWell(
        onTap: () => setState(() => _expanded = !_expanded),
        borderRadius: BorderRadius.circular(6),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  // Newlines are collapsed while folded. A description whose
                  // second character is a line break would otherwise "fit" on
                  // one line while showing almost nothing, which looks like a
                  // bug rather than a summary.
                  _expanded ? description : description.replaceAll('\n', ' '),
                  style: theme.textTheme.bodyMedium,
                  maxLines: _expanded ? null : 1,
                  overflow:
                      _expanded ? TextOverflow.clip : TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 4),
              Icon(
                _expanded ? Icons.expand_less : Icons.expand_more,
                size: 18,
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatsWrap extends StatelessWidget {
  const _StatsWrap({
    required this.influencer,
    required this.l10n,
    this.medianViewsAll,
  });

  final Influencer influencer;
  final AppLocalizations l10n;

  /// Median per-video views over every stored video (no window), computed by
  /// the parent from the page's loaded videos. Null until they load, or when
  /// none has a view count.
  final int? medianViewsAll;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 24,
      runSpacing: 12,
      children: [
        _StatItem(
          label: l10n.influencerProfileSubscribers,
          value: formatCount(
            influencer.subscriberCount,
            locale: l10n.localeName,
          ),
        ),
        // Two windows, side by side and labelled so they can't be confused:
        // the trailing-30-day median from the backend, and the median over
        // every video we've stored for the channel.
        if (influencer.medianViewsLast30 != null)
          _StatItem(
            label: l10n.influencerProfileMedianViews30,
            value: formatCount(
              influencer.medianViewsLast30,
              locale: l10n.localeName,
            ),
          ),
        if (medianViewsAll != null)
          _StatItem(
            label: l10n.influencerProfileMedianViewsAll,
            value: formatCount(medianViewsAll, locale: l10n.localeName),
          ),
        if (influencer.country != null)
          _StatItem(
            label: l10n.influencerProfileCountry,
            value: influencer.country!,
          ),
        _StatItem(
          label: l10n.influencerProfileVideosThisMonth,
          value: formatCount(
            influencer.videosLast30,
            locale: l10n.localeName,
          ),
        ),
      ],
    );
  }
}

class _StatItem extends StatelessWidget {
  const _StatItem({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(value, style: Theme.of(context).textTheme.titleMedium),
        Text(label, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}

/// Jumps to the Outreach page for this channel — straight to the existing
/// conversation if there is one, otherwise to the compose route, which
/// resolves-or-creates the thread. Cross-branch `context.go`, so the
/// Influencers stack is left intact behind it.
class _ContactButton extends ConsumerWidget {
  const _ContactButton({required this.influencer, required this.l10n});

  final Influencer influencer;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final threadAsync = ref.watch(threadByInfluencerProvider(influencer.id));
    final thread = threadAsync.asData?.value;
    final hasThread = thread != null;

    return FilledButton.icon(
      onPressed: () => context.go(
        hasThread
            ? AppRoutes.outreachThread(thread.id)
            : AppRoutes.outreachCompose(influencer.id),
      ),
      icon: Icon(hasThread ? Icons.forum_outlined : Icons.mail_outline),
      label: Text(
        hasThread
            ? l10n.influencerProfileOpenConversation
            : l10n.influencerProfileContactAction,
      ),
    );
  }
}
