import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/capabilities/capability_gate.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/data/models/news_item.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/news/application/news_badge_controller.dart';
import 'package:gratovo_toolbox/features/news/application/news_controller.dart';
import 'package:gratovo_toolbox/features/news/presentation/widgets/add_news_source_dialog.dart';
import 'package:gratovo_toolbox/features/news/presentation/widgets/news_sources_panel.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:url_launcher/url_launcher.dart';

/// Industry news for the niches the team works.
///
/// The stories are read from the database, never fetched here. A browser will
/// not let a page read a publisher's feed cross-origin and almost no publisher
/// permits it, so `pipeline/tools/news.py` fetches on the machine that runs the
/// pipeline and every client reads what it stored. That is what makes this page
/// work on web at all, and it also means one request per feed for the whole
/// team rather than one per person per open.
///
/// On a native desktop build, opening this page also kicks off a fetch on its
/// own when the stored news has gone stale (see [_autoRefreshAfter]) — the same
/// `--refresh` the toolbar button runs, just without anyone having to press it.
/// Web and mobile can't launch the pipeline, so they only ever read.
class NewsScreen extends ConsumerStatefulWidget {
  const NewsScreen({super.key, this.onClose});

  /// Set when the screen is hosted inside [showAsDialog] rather than a route —
  /// draws a close button in the app bar's leading slot.
  final VoidCallback? onClose;

  /// Opens the full News screen in a centered modal. Used from the Dashboard's
  /// News peek card now that News is no longer a nav destination.
  static Future<void> showAsDialog(BuildContext context) {
    return showDialog<void>(
      context: context,
      builder: (ctx) => Dialog(
        insetPadding: const EdgeInsets.all(24),
        clipBehavior: Clip.antiAlias,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1100, maxHeight: 820),
          child: NewsScreen(onClose: () => Navigator.of(ctx).pop()),
        ),
      ),
    );
  }

  @override
  ConsumerState<NewsScreen> createState() => _NewsScreenState();
}

class _NewsScreenState extends ConsumerState<NewsScreen> {
  bool _refreshing = false;

  /// Opening the page fetches on its own once the newest stored feed is older
  /// than this. Three hours roughly matches how often a person would hit
  /// refresh anyway, so the list is rarely more than a cycle stale without
  /// making every open wait on the pipeline. The toolbar button ignores this
  /// and always fetches.
  static const _autoRefreshAfter = Duration(hours: 3);

  /// Evaluated once per mount: returning to the tab must not re-trigger a
  /// fetch, and neither should the rebuild when [newsSourcesProvider] resolves.
  bool _autoRefreshEvaluated = false;

  /// Fires an auto-refresh from `build` when the stored news is stale. Only on
  /// a build that can actually launch the pipeline (native desktop) — elsewhere
  /// this is a no-op and the page just shows what was last stored.
  void _maybeAutoRefresh(AppLocalizations l10n) {
    if (_autoRefreshEvaluated) return;
    if (!ref.read(capabilitiesProvider).canRunSearch) return;

    final sources = ref.watch(newsSourcesProvider).value;
    // Still loading — build runs again when it lands, and we retry then.
    if (sources == null) return;

    _autoRefreshEvaluated = true;
    if (!_newsIsStale(sources)) return;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && !_refreshing) _refresh(l10n, auto: true);
    });
  }

  bool _newsIsStale(List<NewsSource> sources) {
    DateTime? newest;
    for (final source in sources) {
      final at = source.lastFetchedAt;
      if (at != null && (newest == null || at.isAfter(newest))) newest = at;
    }
    // Nothing has ever been fetched — fetch now.
    if (newest == null) return true;
    // `lastFetchedAt` is a UTC instant since the timezone flip; compare
    // against a UTC now so the window is measured on the same clock.
    return DateTime.now().toUtc().difference(newest) >= _autoRefreshAfter;
  }

  Future<void> _refresh(AppLocalizations l10n, {bool auto = false}) async {
    // Captured before the first await, for the same reason `context` below is
    // guarded with `mounted` after every await.
    //
    // A fetch takes as long as the pipeline takes, and this screen is opened as
    // a dialog that can be closed at any point during it — the auto-refresh in
    // particular starts from `build`, so simply opening News and moving on is
    // enough. `ref` reads the widget's `BuildContext`, and touching it after
    // the widget is gone throws `Bad state: Using "ref" when a widget is about
    // to or has been unmounted`. The container does not care: it outlives this
    // screen, so the invalidations below still land and the dashboard's peek
    // card still updates for someone who closed the page while it worked.
    final providers = ProviderScope.containerOf(context, listen: false);
    setState(() => _refreshing = true);
    // The auto path stays quiet on the way in — the list simply updates when
    // the fetch lands. A failure still gets a snackbar (below) so a pipeline
    // that has stopped working does not do so silently.
    if (!auto) {
      AppToast.info(context, l10n.newsRefreshStarted);
    }

    try {
      final pythonEnv = ref.read(pythonEnvironmentProvider);
      final paths = ScraperProcess.resolvePaths(
        projectRootOverride: pythonEnv.projectRootOverride.trim().isEmpty
            ? null
            : pythonEnv.projectRootOverride.trim(),
      );
      if (paths == null) {
        if (!auto) {
          AppToast.error(context, l10n.newsRefreshFailed);
        }
        return;
      }

      final result = await ScraperProcess.refreshNewsFeeds(
        pythonExecutable: pythonEnv.pythonExecutable,
        paths: paths,
      );
      // Both providers: the fetch writes new stories AND stamps each feed's
      // last-fetch status, and the sources panel is where a feed that just
      // started failing becomes visible.
      providers.invalidate(newsItemsProvider);
      providers.invalidate(newsSourcesProvider);

      if ((!auto || !result.succeeded) && mounted) {
        if (result.succeeded) {
          AppToast.success(context, l10n.newsRefreshFinished);
        } else {
          AppToast.error(context, l10n.newsRefreshFailed);
        }
      }

      if (result.succeeded) {
        // Fold the fresh story count into the "new since the last fetch"
        // badge. Best-effort: a fetch that worked should not report an error
        // just because the follow-up count did not come back.
        try {
          final count =
              await providers.read(newsRepositoryProvider).countItems();
          await providers.read(newsBadgeProvider.notifier).recordFetch(count);
        } catch (_) {}
      }
    } finally {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  /// Deletes every stored story and pulls them straight back in. This is a
  /// testing aid for the "new since the last fetch" badge: with the baseline
  /// reset to zero, the refetch reports the whole feed as new.
  Future<void> _clearStories(AppLocalizations l10n) async {
    // Before the confirmation dialog, not after: the await below can outlast
    // this screen just as the fetch can. See `_refresh` for the whole reason.
    final providers = ProviderScope.containerOf(context, listen: false);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.newsClearAll),
        content: Text(l10n.newsClearAllConfirm),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.commonCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.commonDelete),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      await providers.read(newsRepositoryProvider).clearItems();
      await providers.read(newsBadgeProvider.notifier).reset();
      providers.invalidate(newsItemsProvider);
      providers.invalidate(newsSourcesProvider);
    } catch (_) {
      if (!mounted) return;
      AppToast.error(context, l10n.newsClearAllFailed);
      return;
    }
    if (!mounted) return;
    AppToast.success(context, l10n.newsClearAllDone);

    // Refetch where we can, so the badge jumps to the full count. Web and
    // mobile cannot launch the pipeline; there the list stays empty until it
    // runs elsewhere.
    // `_refresh` reads this screen's context on the way in, so it must not be
    // called once the screen is gone -- unlike the invalidations above, which
    // deliberately still run.
    if (!mounted) return;
    if (providers.read(capabilitiesProvider).canRunSearch && !_refreshing) {
      await _refresh(l10n);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final itemsAsync = ref.watch(newsItemsProvider);

    _maybeAutoRefresh(l10n);

    return Scaffold(
      appBar: GradientAppBar(
        leading: widget.onClose == null
            ? null
            : IconButton(
                icon: const Icon(Icons.close),
                onPressed: widget.onClose,
              ),
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child:
                  GradientText(l10n.newsTitle, overflow: TextOverflow.ellipsis),
            ),
            const SizedBox(width: 16),
            _NewsDeltaBadge(
              delta: ref.watch(newsBadgeProvider).delta,
              l10n: l10n,
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: l10n.newsClearAll,
            icon: const Icon(Icons.delete_sweep_outlined),
            onPressed: _refreshing ? null : () => _clearStories(l10n),
          ),
          DesktopOnly(
            // On web there is no pipeline to launch and no way to fetch a feed
            // from the page itself, so the button is replaced by the reason
            // rather than shown broken.
            fallback: Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Tooltip(
                message: l10n.newsRefreshDesktopOnly,
                child: const Icon(Icons.info_outline),
              ),
            ),
            child: _refreshing
                ? const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 20),
                    child: Center(
                      child: SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  )
                : IconButton(
                    tooltip: l10n.newsRefresh,
                    icon: const Icon(Icons.refresh),
                    onPressed: () => _refresh(l10n),
                  ),
          ),
          IconButton(
            tooltip: l10n.newsAddSourceTitle,
            icon: const Icon(Icons.add),
            onPressed: () => AddNewsSourceDialog.show(context),
          ),
        ],
      ),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final wide = constraints.maxWidth > 1000;
          final stories = _StoryList(itemsAsync: itemsAsync, l10n: l10n);

          if (!wide) {
            return Column(
              children: [
                const NewsFilterChips(),
                Expanded(child: stories),
              ],
            );
          }
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(width: 300, child: NewsSourcesPanel()),
              const VerticalDivider(width: 1),
              Expanded(child: stories),
            ],
          );
        },
      ),
    );
  }
}

/// Always-visible count of how many stories arrived on the last fetch,
/// relative to the fetch before it. Zero and negative values are shown too —
/// zero reads as "nothing new", negative as "stories aged out".
class _NewsDeltaBadge extends StatelessWidget {
  const _NewsDeltaBadge({required this.delta, required this.l10n});

  final int delta;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final positive = delta > 0;
    return Tooltip(
      message: l10n.newsSinceLastFetch,
      child: Badge(
        backgroundColor: positive ? scheme.primary : scheme.secondaryContainer,
        textColor: positive ? scheme.onPrimary : scheme.onSecondaryContainer,
        label: Text(positive ? '+$delta' : '$delta'),
        child: const Icon(Icons.fiber_new_outlined, size: 22),
      ),
    );
  }
}

class _StoryList extends ConsumerWidget {
  const _StoryList({required this.itemsAsync, required this.l10n});

  final AsyncValue<List<NewsItem>> itemsAsync;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return itemsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, stackTrace) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(l10n.commonError),
            TextButton(
              onPressed: () => ref.invalidate(newsItemsProvider),
              child: Text(l10n.commonRetry),
            ),
          ],
        ),
      ),
      data: (items) {
        if (items.isEmpty) {
          final filtered = !ref.watch(newsFilterProvider).isUnfiltered;
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Text(
                // "Nothing has ever been fetched" and "this source has no
                // stories" call for different actions, so they get different
                // messages — the first names the command that fixes it.
                filtered ? l10n.newsNoMatches : l10n.newsEmpty,
                textAlign: TextAlign.center,
              ),
            ),
          );
        }
        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(newsItemsProvider),
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: items.length,
            itemBuilder: (context, index) =>
                NewsItemCard(item: items[index], l10n: l10n),
          ),
        );
      },
    );
  }
}

/// One story. Tapping it opens the article in the real browser.
class NewsItemCard extends ConsumerWidget {
  const NewsItemCard({super.key, required this.item, required this.l10n});

  final NewsItem item;
  final AppLocalizations l10n;

  Future<void> _open(BuildContext context) async {
    final link = item.link;
    if (link == null || link.isEmpty) return;
    final uri = Uri.tryParse(link);
    // Only http(s). The URL comes from a third-party feed, so it is not
    // trusted input: launching an arbitrary scheme from it would hand a
    // publisher (or anyone who can post to their feed) the ability to fire
    // whatever handler the OS has registered.
    if (uri == null || (uri.scheme != 'http' && uri.scheme != 'https')) return;

    final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!launched) {
      // A refused launch (no browser registered, or a platform that blocks it
      // outside a user gesture) leaves the link reachable rather than the tap
      // doing nothing at all.
      await Clipboard.setData(ClipboardData(text: link));
      if (!context.mounted) return;
      AppToast.info(context, link);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final fmt = ref.watch(instantFormatterProvider);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: item.link == null ? null : () => _open(context),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(item.title, style: theme.textTheme.titleSmall),
              const SizedBox(height: 4),
              Text(
                [
                  item.publishedAt == null
                      ? l10n.newsUndated
                      : fmt.date(item.publishedAt!),
                  if (item.author != null) item.author!,
                ].join('  ·  '),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              if (item.summary != null) ...[
                const SizedBox(height: 8),
                Text(
                  item.summary!,
                  style: theme.textTheme.bodyMedium,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
              if (item.link != null) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    Icon(
                      Icons.open_in_new,
                      size: 14,
                      color: theme.colorScheme.primary,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      l10n.newsOpenArticle,
                      style: theme.textTheme.labelMedium
                          ?.copyWith(color: theme.colorScheme.primary),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// The narrow-layout filter: niches as chips, since the full sources panel
/// does not fit beside the stories on a phone.
class NewsFilterChips extends ConsumerWidget {
  const NewsFilterChips({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final filter = ref.watch(newsFilterProvider);
    final notifier = ref.read(newsFilterProvider.notifier);
    final niches = ref.watch(newsNichesProvider);

    if (niches.isEmpty) return const SizedBox.shrink();

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Row(
        children: [
          ChoiceChip(
            label: Text(l10n.newsAllNiches),
            selected: filter.isUnfiltered,
            onSelected: (_) => notifier.showAll(),
          ),
          for (final niche in niches) ...[
            const SizedBox(width: 8),
            ChoiceChip(
              label: Text(niche),
              selected: filter.niche == niche,
              onSelected: (selected) =>
                  selected ? notifier.showNiche(niche) : notifier.showAll(),
            ),
          ],
        ],
      ),
    );
  }
}
