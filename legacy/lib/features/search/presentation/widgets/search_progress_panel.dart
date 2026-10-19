import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/run_status_dot.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The live progress of the current (or most recent) [SearchRun].
///
/// This is the "Progress" tab body inside `ProgressTabsPanel` — no `Card` or
/// title of its own, since the tab bar already labels it (see that class for
/// why the four job panels were folded into one tabbed card).
///
/// Everything above the log exists to answer "is this alive, and where is
/// it": which keyword of how many, what step within that keyword, how much it
/// has found, how long it has been going. That used to matter more than it
/// does now — the panel started as a title and a raw log, and the log was the
/// only thing that ever moved, so the first minute or two of a run (paginating
/// a deep search, printing nothing) looked identical to a Start button that
/// hadn't worked.
///
/// The log stays below all of that, unchanged in behaviour: a newest-first
/// `ListView` that fills whatever height the tab has left, because a broad
/// run prints thousands of lines and laying every one of them out on every
/// rebuild is what used to take the rest of the page down with it — capping
/// how tall the list is allowed to get is someone else's job (the tab's own
/// bounded height), not this widget's.
class SearchProgressPanel extends ConsumerStatefulWidget {
  const SearchProgressPanel({super.key});

  @override
  ConsumerState<SearchProgressPanel> createState() =>
      _SearchProgressPanelState();
}

class _SearchProgressPanelState extends ConsumerState<SearchProgressPanel> {
  /// Drives the elapsed-time label only. Kept in the panel rather than in the
  /// run's own state so a clock tick costs one small rebuild here instead of
  /// a state change every watcher of the run has to react to.
  Timer? _ticker;

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  void _syncTicker(bool running) {
    if (running && _ticker == null) {
      _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() {});
      });
    } else if (!running && _ticker != null) {
      _ticker?.cancel();
      _ticker = null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final runAsync = ref.watch(currentSearchRunProvider);

    return Padding(
      padding: const EdgeInsets.all(16),
      child: runAsync.when(
        // A poll or a change-bus nudge should not blank a running run's
        // progress back to a spinner every couple of seconds.
        skipLoadingOnReload: true,
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => Text(l10n.commonError),
        data: (run) {
          if (run == null) {
            _syncTicker(false);
            return Text(l10n.searchProgressEmpty);
          }
          final running = run.status == SearchRunStatus.running;
          _syncTicker(running);
          return _RunBody(run: run, l10n: l10n);
        },
      ),
    );
  }
}

class _RunBody extends ConsumerWidget {
  const _RunBody({required this.run, required this.l10n});

  final SearchRun run;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final running = run.status == SearchRunStatus.running;
    final done = run.keywordsDone;
    final total = run.keywordTotal;
    final backoffTotal = run.backoffTotalSeconds;
    final backoffRemaining = run.backoffRemainingSeconds;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            RunStatusDot(switch (run.status) {
              SearchRunStatus.running => RunDotState.running,
              SearchRunStatus.completed => RunDotState.done,
              SearchRunStatus.stopped => RunDotState.paused,
              SearchRunStatus.failed => RunDotState.failed,
              SearchRunStatus.idle => RunDotState.idle,
            }),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                _headline(),
                style: theme.textTheme.bodyMedium
                    ?.copyWith(fontWeight: FontWeight.w600),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            // Shown whether or not the run is still going: how long it took
            // (or has been going) is worth keeping around after a run ends,
            // not just while it's live — see `_elapsed`.
            Text(
              _elapsed(),
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
        if (running && total > 0) ...[
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(
              // The bar tracks *finished* keywords, so it never claims credit
              // for the one still running. On the first keyword of a run that
              // means a bar at zero with a spinner beside it, which is honest:
              // nothing has been committed yet.
              value: (done / total).clamp(0.0, 1.0),
              minHeight: 6,
            ),
          ),
        ],
        if (run.currentStep != null) ...[
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.chevron_right,
                  size: 16, color: theme.colorScheme.onSurfaceVariant),
              const SizedBox(width: 2),
              Expanded(
                child: Text(
                  run.currentStep!,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ],
        // YouTube rate-limited the pipeline and it is waiting out a backoff
        // rather than sitting there looking stalled (see
        // `scrapetube._interruptible_wait`) -- a countdown so that reads as
        // "working, just slower" instead of "broken", and a way to skip the
        // rest of the wait for whoever fixed the actual problem (a VPN, a
        // proxy) and does not want to wait out a timer that no longer
        // reflects reality.
        if (running && backoffTotal != null && backoffTotal > 0) ...[
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(
              value: 1 -
                  ((backoffRemaining ?? backoffTotal) / backoffTotal)
                      .clamp(0.0, 1.0),
              minHeight: 6,
              color: theme.colorScheme.tertiary,
            ),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: Text(
                  l10n.searchBackoffWaiting(
                      formatCount(backoffRemaining ?? backoffTotal)),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.tertiary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              TextButton(
                onPressed: () => ref
                    .read(activeSearchRunControllerProvider.notifier)
                    .skipBackoffWait(),
                child: Text(l10n.searchTryAgainNow),
              ),
            ],
          ),
        ],
        const SizedBox(height: 10),
        Wrap(
          spacing: 16,
          runSpacing: 4,
          children: [
            _Counter(
              icon: Icons.people_alt_outlined,
              label:
                  l10n.searchProgressChannels(formatCount(run.channelsFound)),
            ),
            if (run.videosFound > 0)
              _Counter(
                icon: Icons.play_circle_outline,
                label: l10n.searchProgressVideos(formatCount(run.videosFound)),
              ),
          ],
        ),
        if (run.route != null) ...[
          const SizedBox(height: 8),
          _RouteRow(route: run.route!, l10n: l10n),
        ],
        // Parallel search: the headline names the newest keyword; these are
        // the others still going beside it.
        if (running && run.activeKeywords.length > 1) ...[
          const SizedBox(height: 4),
          Text(
            l10n.searchAlsoRunning(run.activeKeywords
                .where((k) => k != run.currentKeyword)
                .join(', ')),
            key: const Key('search-also-running'),
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ],
        // A lazily built list rather than a column of every line. The log
        // used to be laid out in full inside the page's own scroll view, so
        // each of the thousands of lines a run prints was a live widget
        // measured on every rebuild — the panel got slower the longer the
        // run went, and took the rest of the page down with it. `ListView`
        // only builds the handful of lines actually on screen, so it can
        // safely grow to fill whatever room the tab has left instead of
        // being capped to a fixed height — see `ProgressTabsPanel`, which
        // gives this panel's tab a bounded height and no longer wraps it in
        // a scroll view of its own.
        if (run.logLines.isNotEmpty) ...[
          const SizedBox(height: 12),
          Expanded(
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(8),
              ),
              child: _LogView(
                lines: run.logLines,
                colorOf: (line) => _getColorBasedOnAction(theme, line),
              ),
            ),
          ),
        ],
      ],
    );
  }

  Color? _getColorBasedOnAction(ThemeData theme, String text) {
    if (text.startsWith('[step] Auto-clean')) {
      return AppColors.accent;
    } else if (text.startsWith('[step] Pacing') ||
        text.startsWith('Error') ||
        text.startsWith('[step] IP cooldown')) {
      return AppColors.warning;
    } else if (text.startsWith('[step] Searching')) {
      return AppColors.success;
    } else if (text.startsWith('[step] Skipped')) {
      return theme.textTheme.bodySmall?.color?.withAlpha(140);
    } else if (text.startsWith('[step] Backfill:')) {
      return theme.colorScheme.primary;
    }

    return theme.textTheme.bodySmall?.color;
  }

  /// The one line that says where the run is. Falls back through what is
  /// actually known: the keyword in flight, then the position in the list,
  /// then the run's outcome.
  String _headline() {
    final keyword = run.currentKeyword;
    if (run.status == SearchRunStatus.running) {
      if (keyword != null && run.keywordTotal > 0) {
        return l10n.searchProgressOnKeyword(
          run.currentKeywordIndex,
          run.keywordTotal,
          keyword,
        );
      }
      return l10n.searchProgressStarting;
    }
    return switch (run.status) {
      SearchRunStatus.completed =>
        l10n.searchProgressCompleted(run.channelsFound),
      SearchRunStatus.stopped => l10n.searchProgressStopped(run.keywordsDone),
      SearchRunStatus.failed => l10n.searchProgressFailed,
      _ => l10n.searchProgressEmpty,
    };
  }

  /// Wall-clock time the run took. While it's still going that's "so far",
  /// ticked live off [DateTime.now] by the panel's own timer; once it ends —
  /// however it ends, completed/stopped/failed alike — [SearchRun.finishedAt]
  /// takes over so this keeps reading the same fixed duration instead of
  /// continuing to climb after nothing is actually running any more.
  String _elapsed() {
    final elapsed =
        (run.finishedAt ?? DateTime.now()).difference(run.startedAt);
    final hours = elapsed.inHours;
    final minutes = elapsed.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = elapsed.inSeconds.remainder(60).toString().padLeft(2, '0');
    return hours > 0 ? '$hours:$minutes:$seconds' : '$minutes:$seconds';
  }
}

/// The log's own scroll view, in its own [State] so the scroll position (and
/// whether the reader has deliberately scrolled up) survives the rest of the
/// panel rebuilding on every new line.
///
/// Newest lines are appended at the end, not shown via a reversed list:
/// `ListView(reverse: true)` flips which edge is the scroll origin, and on
/// desktop that also flips which way the mouse wheel appears to scroll —
/// turning the wheel down moved the view up. Auto-scrolling to the bottom on
/// a new line gets the same "always see the latest" result without that
/// inversion, and only kicks in while the reader is already at (or near) the
/// bottom — scrolled up to read older lines, it leaves them there instead of
/// yanking the view back down mid-run.
class _LogView extends StatefulWidget {
  const _LogView({required this.lines, required this.colorOf});

  final List<String> lines;
  final Color? Function(String line) colorOf;

  @override
  State<_LogView> createState() => _LogViewState();
}

class _LogViewState extends State<_LogView> {
  final _controller = ScrollController();
  bool _stickToBottom = true;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_trackPosition);
    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
  }

  @override
  void didUpdateWidget(_LogView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.lines.length != oldWidget.lines.length && _stickToBottom) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _trackPosition() {
    if (!_controller.hasClients) return;
    final position = _controller.position;
    // A few pixels of slack: while lines are still arriving, "exactly at the
    // max extent" is a moving target.
    _stickToBottom = position.pixels >= position.maxScrollExtent - 24;
  }

  void _scrollToBottom() {
    if (!mounted || !_controller.hasClients) return;
    _controller.jumpTo(_controller.position.maxScrollExtent);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView.builder(
      controller: _controller,
      padding: EdgeInsets.zero,
      itemCount: widget.lines.length,
      itemBuilder: (context, index) {
        final line = widget.lines[index];
        return Text(
          line,
          style: theme.textTheme.bodySmall
              ?.copyWith(fontFamily: 'monospace', color: widget.colorOf(line)),
        );
      },
    );
  }
}

/// Which connections carried this run's requests -- "in use" only once a
/// request actually went through one, so a deployed gateway the run never
/// touched reads as idle rather than as working.
class _RouteRow extends StatelessWidget {
  const _RouteRow({required this.route, required this.l10n});

  final SearchRouteUsage route;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;

    Widget chip(String key, IconData icon, String label, {required bool live}) {
      final color = live ? AppColors.success : muted;
      return Row(
        key: Key(key),
        mainAxisSize: MainAxisSize.min,
        spacing: 5,
        children: [
          Icon(icon, size: 15, color: color),
          // Flexible so a long label wraps inside a narrow panel instead of
          // overflowing it.
          Flexible(
            child: Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(
                color: color,
                fontWeight: live ? FontWeight.w600 : null,
              ),
            ),
          ),
        ],
      );
    }

    final chips = <Widget>[
      if (!route.rotates)
        chip('route-direct-only', Icons.computer, l10n.searchRouteDirectOnly,
            live: false),
      if (route.gateways > 0)
        chip(
          'route-aws',
          Icons.cloud_outlined,
          route.awsRequests > 0
              ? l10n.searchRouteAwsInUse(formatCount(route.awsRequests))
              : l10n.searchRouteAwsIdle,
          live: route.awsRequests > 0,
        ),
      if (route.proxies > 0)
        chip(
          'route-proxies',
          Icons.hub_outlined,
          route.proxyRequests > 0
              ? l10n.searchRouteProxiesInUse(formatCount(route.proxyRequests))
              : l10n.searchRouteProxiesIdle,
          live: route.proxyRequests > 0,
        ),
      if (route.rotates && route.includesDirect)
        chip(
          'route-this-machine',
          Icons.computer,
          l10n.searchRouteThisMachine(formatCount(route.directRequests)),
          live: false,
        ),
      if (route.rotates)
        chip(
          'route-pace',
          route.parallel ? Icons.call_split : Icons.speed,
          route.parallel
              ? l10n.searchRouteParallel(route.workers)
              : route.pacing == 'fast'
                  ? l10n.searchRouteOneAtATimeFast
                  : l10n.searchRouteOneAtATimeNormal,
          live: false,
        ),
    ];

    final last = route.lastLabel;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 4,
      children: [
        Wrap(spacing: 16, runSpacing: 4, children: chips),
        if (route.rotates && last != null && last.isNotEmpty)
          Text(
            l10n.searchRouteLast(last),
            key: const Key('route-last'),
            style: theme.textTheme.bodySmall?.copyWith(color: muted),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
      ],
    );
  }
}

class _Counter extends StatelessWidget {
  const _Counter({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 15, color: theme.colorScheme.onSurfaceVariant),
        const SizedBox(width: 5),
        Text(
          label,
          style: theme.textTheme.bodySmall
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
      ],
    );
  }
}
