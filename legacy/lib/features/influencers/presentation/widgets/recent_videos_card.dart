import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/images/remote_image.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/core/widgets/collapsible_card.dart';
import 'package:gratovo_toolbox/data/models/video.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// How the uploads are laid out.
enum VideoViewMode {
  /// One per row: thumbnail on the left, text beside it. Denser, and keeps the
  /// dates in a column you can run your eye down.
  list,

  /// A grid of larger thumbnails. What you want when the question is "what
  /// does this channel actually look like", which is a visual one.
  cards,
}

/// Which layout the uploads are shown in, remembered for the session.
///
/// A plain provider rather than a persisted preference: this is a way of
/// looking at one channel for a minute, not a standing choice about the app,
/// and a toggle that survives a restart would be one more piece of state
/// nobody remembers setting.
final videoViewModeProvider =
    NotifierProvider<VideoViewModeNotifier, VideoViewMode>(
  VideoViewModeNotifier.new,
);

class VideoViewModeNotifier extends Notifier<VideoViewMode> {
  @override
  VideoViewMode build() => VideoViewMode.list;

  void set(VideoViewMode mode) => state = mode;
}

/// The channel's stored uploads, with the thumbnail and description on every
/// one of them.
///
/// The thumbnail and the description are not decoration here. Deciding what to
/// say in a first outreach email means finding something specific and recent to
/// refer to, and a bare title — "Which VPN actually deserves your money in
/// 2026?" — is usually not enough to tell whether the video was sponsored,
/// which is the single most useful thing to know before quoting a price.
///
/// Starts expanded, because this is the page's evidence rather than one of its
/// tools, and can be folded away when it is not what the visit is about.
class RecentVideosCard extends ConsumerStatefulWidget {
  const RecentVideosCard({
    super.key,
    required this.influencerId,
    required this.handle,
    required this.l10n,
    this.detailsPending = false,
  });

  final String influencerId;
  final String handle;
  final AppLocalizations l10n;

  /// The channel is known here only by name: a teammate's search found it
  /// and announced it in the catalog, but its object (details and videos)
  /// has not been pulled to this machine yet — see `Influencer.detailsPending`.
  final bool detailsPending;

  @override
  ConsumerState<RecentVideosCard> createState() => _RecentVideosCardState();
}

class _RecentVideosCardState extends ConsumerState<RecentVideosCard> {
  bool _refreshing = false;

  /// (Phase 6) On desktop, actually re-runs `search.py --refetch <handle>` for
  /// this one channel and waits for it — real data, not just a re-read of what
  /// was already stored. Elsewhere (mobile/web, where there is no local
  /// pipeline to launch) this falls back to re-reading the shared store.
  Future<void> _refresh(AppLocalizations l10n) async {
    final caps = ref.read(capabilitiesProvider);
    setState(() => _refreshing = true);
    try {
      if (caps.canRunSearch) {
        final pythonEnv = ref.read(pythonEnvironmentProvider);
        final paths = ScraperProcess.resolvePaths(
          projectRootOverride: pythonEnv.projectRootOverride.trim().isEmpty
              ? null
              : pythonEnv.projectRootOverride.trim(),
        );
        if (paths != null) {
          final result = await ScraperProcess.refetchHandle(
            pythonExecutable: pythonEnv.pythonExecutable,
            paths: paths,
            handle: widget.handle,
          );
          if (!result.succeeded && mounted) {
            AppToast.error(context, l10n.influencerProfileRefreshFailed);
          }
        }
      }
      // Channels as well as videos — the 30-day rollups on the channel row are
      // derived from these, so they moved too.
      ref.bumpData(const {DataDomain.videos, DataDomain.channels});
    } finally {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = widget.l10n;
    final videosAsync =
        ref.watch(videosByInfluencerProvider(widget.influencerId));
    final mode = ref.watch(videoViewModeProvider);
    final count = videosAsync.maybeWhen(
      data: (videos) => videos.length,
      orElse: () => null,
    );

    return CollapsibleCard(
      title: l10n.influencerProfileRecentVideosTitle,
      initiallyExpanded: true,
      collapsedSummary:
          count == null ? null : Text(l10n.influencerProfileVideoCount(count)),
      headerTrailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SegmentedButton<VideoViewMode>(
            showSelectedIcon: false,
            style: const ButtonStyle(
              visualDensity: VisualDensity.compact,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            segments: [
              ButtonSegment(
                value: VideoViewMode.list,
                icon: const Icon(Icons.view_list, size: 18),
                tooltip: l10n.influencerProfileVideosAsList,
              ),
              ButtonSegment(
                value: VideoViewMode.cards,
                icon: const Icon(Icons.grid_view, size: 18),
                tooltip: l10n.influencerProfileVideosAsCards,
              ),
            ],
            selected: {mode},
            onSelectionChanged: (selection) =>
                ref.read(videoViewModeProvider.notifier).set(selection.first),
          ),
          if (_refreshing)
            const Padding(
              padding: EdgeInsets.all(12),
              child: SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            )
          else
            IconButton(
              tooltip: l10n.influencerProfileRefreshVideos,
              icon: const Icon(Icons.refresh),
              onPressed: () async {
                AppToast.info(context, l10n.influencerProfileRefreshStarted);
                await _refresh(l10n);
              },
            ),
        ],
      ),
      child: videosAsync.when(
        loading: () => const Padding(
          padding: EdgeInsets.symmetric(vertical: 12),
          child: Center(child: CircularProgressIndicator()),
        ),
        error: (error, stackTrace) => Text(l10n.commonError),
        data: (videos) {
          if (videos.isEmpty && widget.detailsPending) {
            return _DetailsSyncing(l10n: l10n);
          }
          if (videos.isEmpty) {
            return Text(l10n.influencerProfileNoVideos);
          }
          return mode == VideoViewMode.cards
              ? _VideoGrid(videos: videos, l10n: l10n)
              : _VideoList(videos: videos, l10n: l10n);
        },
      ),
    );
  }
}

/// The "not here yet" state, distinct from "no videos": the pull that
/// brings them runs on the sync tick, and this says so rather than letting
/// an empty list read as a dead channel.
class _DetailsSyncing extends StatelessWidget {
  const _DetailsSyncing({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(top: 2),
          child: SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            l10n.influencerProfileDetailsSyncing,
            style: theme.textTheme.bodyMedium
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
        ),
      ],
    );
  }
}

class _VideoList extends StatelessWidget {
  const _VideoList({required this.videos, required this.l10n});

  final List<Video> videos;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (final video in videos)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: InkWell(
              onTap: () => _copyLink(context, video, l10n),
              borderRadius: BorderRadius.circular(8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Thumbnail(video: video, width: 132),
                  const SizedBox(width: 12),
                  Expanded(child: _VideoText(video: video, l10n: l10n)),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _VideoGrid extends StatelessWidget {
  const _VideoGrid({required this.videos, required this.l10n});

  final List<Video> videos;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    // shrinkWrap + never-scrollable: this grid lives inside the profile page's
    // own scroll view, so it must lay itself out at its full height rather than
    // trying to scroll independently.
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      padding: EdgeInsets.zero,
      itemCount: videos.length,
      gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 300,
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
        // The 16:9 thumbnail is a fixed proportion of the tile width; only the
        // text below it grows with the reader's font scale. A fixed height here
        // would clip for anyone who moves the Settings slider, which is the
        // same bug the influencer cards had.
        mainAxisExtent:
            300 * 9 / 16 + MediaQuery.textScalerOf(context).scale(112),
      ),
      itemBuilder: (context, index) {
        final video = videos[index];
        return InkWell(
          onTap: () => _copyLink(context, video, l10n),
          borderRadius: BorderRadius.circular(8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Thumbnail(video: video, width: double.infinity),
              const SizedBox(height: 8),
              Expanded(child: _VideoText(video: video, l10n: l10n)),
            ],
          ),
        );
      },
    );
  }
}

/// The upload's thumbnail, always present in shape even when the picture is
/// not: a row of text with ragged left edges where some videos have art and
/// others do not is harder to scan than one with a consistent placeholder.
class _Thumbnail extends StatelessWidget {
  const _Thumbnail({required this.video, required this.width});

  final Video video;
  final double width;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // The card grid passes `double.infinity` here (its tiles size themselves
    // from the grid delegate, not from this widget) — there is no real width
    // to size a decode to, so the grid's own `maxCrossAxisExtent` (300, see
    // `_VideoGrid`) stands in as the largest it could ever actually be drawn.
    final decodeWidth = width.isFinite ? width : 300.0;
    // The SizedBox is OUTSIDE the AspectRatio, not inside it. Inside, the
    // AspectRatio is the one being measured, and in a Row (list view) it gets
    // unbounded width and unbounded height at once — which it cannot resolve,
    // and which throws rather than degrading. Bounding the width first gives it
    // the one number it needs.
    return SizedBox(
      width: width,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: AspectRatio(
          aspectRatio: 16 / 9,
          child: RemoteImage(
            url: video.thumbnail,
            width: decodeWidth,
            height: decodeWidth * 9 / 16,
            fallback: ColoredBox(
              color: theme.colorScheme.surfaceContainerHighest,
              child: Icon(
                Icons.play_circle_outline,
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Title, date and views, then the description.
class _VideoText extends ConsumerWidget {
  const _VideoText({required this.video, required this.l10n});

  final Video video;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final description = video.description?.trim();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          video.title,
          style: theme.textTheme.titleSmall,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: 2),
        Text(
          '${video.publishedAt == null ? l10n.commonUnknown : fmt.date(video.publishedAt!)}'
          '  ·  '
          '${formatCount(video.viewCount, placeholder: l10n.commonUnknown, locale: l10n.localeName)}',
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 4),
        Flexible(
          child: Text(
            description == null || description.isEmpty
                ? l10n.influencerProfileVideoNoDescription
                // Collapsed to one paragraph: descriptions are mostly link
                // dumps separated by blank lines, and honouring those line
                // breaks would spend all three lines on whitespace.
                : description.replaceAll(RegExp(r'\s+'), ' '),
            style: theme.textTheme.bodySmall,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

/// Copies the video's URL rather than launching it.
///
/// `url_launcher` is available and used on the News page, but there the link is
/// the point of the page. Here the common next step is pasting the link into a
/// draft email, and a browser tab that steals focus mid-review is a worse
/// default than a link on the clipboard.
Future<void> _copyLink(
  BuildContext context,
  Video video,
  AppLocalizations l10n,
) async {
  await Clipboard.setData(ClipboardData(text: video.url));
  if (context.mounted) {
    AppToast.success(context, video.url);
  }
}
