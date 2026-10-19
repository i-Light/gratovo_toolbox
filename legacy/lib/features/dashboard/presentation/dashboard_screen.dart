import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/theme/app_theme.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/theme/gratovo_logo.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/notification_center.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/core/utils/responsive.dart';
import 'package:gratovo_toolbox/data/models/activity_log_query.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/dashboard/application/dashboard_stats_provider.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/widgets/channel_analytics_section.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/widgets/glow_border.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/widgets/holo_card.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/widgets/keyword_distribution_section.dart';
import 'package:gratovo_toolbox/features/logs/application/activity_log_controller.dart';
import 'package:gratovo_toolbox/features/logs/presentation/logs_screen.dart';
import 'package:gratovo_toolbox/features/my_day/presentation/my_day_section.dart';
import 'package:gratovo_toolbox/features/news/application/news_badge_controller.dart';
import 'package:gratovo_toolbox/features/news/application/news_controller.dart';
import 'package:gratovo_toolbox/features/news/presentation/news_screen.dart';
import 'package:gratovo_toolbox/features/notifications/presentation/notifications_log_screen.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// Landing page: a pipeline overview built entirely from derived providers
/// (dashboard_stats_provider.dart) plus the raw upcoming-reminders list —
/// nothing here owns state of its own. News and Logs are no longer nav
/// destinations; they open from the peek cards near the top as modal dialogs.
class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  final _scrollController = ScrollController();

  /// Anchors the section's own inline filter row and the scroll viewport, so
  /// [_evaluatePinnedFilters] can ask "has that row scrolled up out of sight".
  final _analyticsFiltersKey = GlobalKey();
  final _scrollViewKey = GlobalKey();

  /// Whether the app-bar copy of the filters should be shown. False while the
  /// section's own filter row is still on screen — no point in two of them.
  final _pinnedFiltersVisible = ValueNotifier<bool>(false);

  /// Leading + trailing throttle on the scroll check. The check walks two
  /// render boxes; running it on every scroll callback is a frame's worth of
  /// work the scroll itself doesn't need, and the difference is visible on a
  /// long flick. ~10 checks/sec keeps the toggle feeling instant.
  Timer? _throttle;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    // One check once the first frame is laid out — covers a restored scroll
    // position, where no scroll callback ever fires.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _evaluatePinnedFilters();
    });
  }

  @override
  void dispose() {
    _throttle?.cancel();
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    _pinnedFiltersVisible.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_throttle != null) return;
    _evaluatePinnedFilters();
    _throttle = Timer(const Duration(milliseconds: 100), () {
      _throttle = null;
      // Trailing edge: catch the position the scroll actually came to rest at.
      _evaluatePinnedFilters();
    });
  }

  void _evaluatePinnedFilters() {
    final filters = _analyticsFiltersKey.currentContext?.findRenderObject();
    final viewport = _scrollViewKey.currentContext?.findRenderObject();
    if (filters is! RenderBox ||
        viewport is! RenderBox ||
        !filters.attached ||
        !viewport.attached) {
      return;
    }
    final filtersBottom =
        filters.localToGlobal(Offset(0, filters.size.height)).dy;
    final viewportTop = viewport.localToGlobal(Offset.zero).dy;
    // A few px of slack so a scroll that parks the row exactly at the viewport
    // edge doesn't flip the pinned copy on and off between frames.
    const slack = 4.0;
    final showing = _pinnedFiltersVisible.value;
    if (!showing && filtersBottom < viewportTop - slack) {
      _pinnedFiltersVisible.value = true;
    } else if (showing && filtersBottom > viewportTop + slack) {
      _pinnedFiltersVisible.value = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Scaffold(
        appBar: GradientAppBar(
          // The landing screen gets the three-stop hero wash behind its bar;
          // every other screen's GradientAppBar uses the plain two-stop brand.
          important: true,
          // Three fixed-width pieces in a Row is more than a narrow window
          // holds: at 420px the bar ran 232px over, and the font slider at
          // 1.6 took that to 343. The mark and the wordmark are the identity
          // and stay; the descriptor after them is the first thing to go,
          // and the wordmark gives ground before anything is clipped.
          title: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const GratovoLogo(size: 40),
              const SizedBox(width: 12),
              // The wordmark itself carries the gradient — "words", used once.
              Flexible(
                child: GradientText(
                  'Gratovo',
                  important: true,
                  style: Theme.of(context).textTheme.titleLarge,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (!context.isMobile) ...[
                const SizedBox(width: 12),
                const Flexible(
                  child: Text(
                    '- IMA Tool Box',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ],
          ),
          // The greeting + avatar sit at the trailing end, opposite the title.
          actions: const [_NotificationsBellButton(), _DashboardIdentity()],
        ),
        body: GradientBackdrop(
          colors: const [
            AppColors.brandNavy,
            AppColors.primaryDark,
            AppColors.info
          ],
          fade: false,
          strength: 0.2,
          from: Alignment.topCenter,
          extent: 1,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // The analytics filter bar lives here, mounted once directly under the
              // app bar. It only shows once the section's own inline filter row has
              // scrolled off the top — until then that row is right there and this
              // would just be a second copy of it. Collapses to nothing for anyone
              // below full authority. See [ChannelAnalyticsFilterBar].
              ValueListenableBuilder<bool>(
                valueListenable: _pinnedFiltersVisible,
                builder: (context, visible, child) =>
                    visible ? child! : const SizedBox.shrink(),
                child: const ChannelAnalyticsFilterBar(),
              ),
              Expanded(
                child: SingleChildScrollView(
                  key: _scrollViewKey,
                  controller: _scrollController,
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.dashboardWelcomeBody,
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                      const SizedBox(height: 20),
                      // News + Logs, now reached from here rather than the nav rail:
                      // side by side on a wide window, stacked on a narrow one.
                      const MyDaySection(),
                      const SizedBox(height: 20),
                      const _DashboardPeekRow(),
                      const SizedBox(height: 25),
                      // The stat tiles and the full reminders list, sharing one row.
                      const _StatTileRow(),
                      const SizedBox(height: 25),
                      // Full authority only, and the section decides that itself rather
                      // than being wrapped in a check here — one place to read for
                      // whether it appears. It collapses to nothing for everyone else.
                      ChannelAnalyticsSection(filtersKey: _analyticsFiltersKey),
                      const SizedBox(height: 25),
                      // Which search terms are pulling their weight, by how watched
                      // the channels they found are. Draws itself only for an
                      // authorized account — see [KeywordDistributionSection].
                      const KeywordDistributionSection(),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ));
  }
}

/// Opens the notifications log — every toast raised this session — with an
/// unread-count badge, the same "peek + open the full thing" shape as the
/// News/Logs peek cards below. Sits in the app bar rather than a peek card of
/// its own: a toast is something that already interrupted the screen once,
/// so it doesn't need a second permanent slot in the body to announce itself.
class _NotificationsBellButton extends ConsumerWidget {
  const _NotificationsBellButton();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final unreadCount = ref.watch(
      notificationCenterProvider.select((state) => state.unreadCount),
    );
    final theme = Theme.of(context);

    return IconButton(
      tooltip: l10n.notificationsBellTooltip,
      icon: Badge.count(
        backgroundColor: AppColors.accent.withAlpha(120),
        padding: const EdgeInsets.all(2),
        textStyle:
            theme.textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w700),
        textColor: theme.textTheme.labelMedium?.color,
        offset: const Offset(5, -3),
        maxCount: 9,
        count: unreadCount,
        // alignment: AlignmentGeometry.topRight,
        isLabelVisible: unreadCount > 0,
        child: unreadCount > 0
            ? const Icon(Icons.notifications)
            : const Icon(Icons.notifications_outlined),
      ),
      onPressed: () {
        ref.read(notificationCenterProvider.notifier).acknowledge();
        NotificationsLogScreen.showAsDialog(context);
      },
    );
  }
}

/// "Welcome back, {name}" + the person's colored-initial avatar, shown in the
/// app bar's trailing slot. Renders nothing until the profile row is in hand.
class _DashboardIdentity extends ConsumerWidget {
  const _DashboardIdentity();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final member = ref.watch(currentProfileProvider).value;
    if (member == null) return const SizedBox.shrink();

    final theme = Theme.of(context);
    final name = member.displayName;
    final initial =
        name.characters.isEmpty ? '?' : name.characters.first.toUpperCase();
    final onColor =
        ThemeData.estimateBrightnessForColor(member.color) == Brightness.dark
            ? Colors.white
            : Colors.black;

    return Padding(
      padding: const EdgeInsetsDirectional.only(end: 16),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            child: Row(children: [
              const SizedBox(width: 20),
              Text(
                l10n.dashboardWelcomeUser,
                style: theme.textTheme.bodyMedium,
              ),
              Text(
                name,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodyMedium
                    ?.copyWith(fontWeight: FontWeight.w700),
              ),
            ]),
          ),
          const SizedBox(width: 10),
          CircleAvatar(
            radius: 16,
            backgroundColor: member.color,
            child: Text(
              initial,
              style: theme.textTheme.labelMedium
                  ?.copyWith(color: onColor, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

/// The stat tiles and the upcoming-reminders card, flowing in one row — the
/// reminders card sits beside the tiles on a wide window and wraps under them
/// on a narrow one.
class _StatTileRow extends StatelessWidget {
  const _StatTileRow();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Wrap(
      spacing: 16,
      runSpacing: 16,
      crossAxisAlignment: WrapCrossAlignment.start,
      children: [
        const _StatTiles(),
        SizedBox(width: 380, child: _UpcomingRemindersCard(l10n: l10n)),
      ],
    );
  }
}

class _StatTiles extends ConsumerWidget {
  const _StatTiles();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final statsAsync = ref.watch(dashboardStatsProvider);

    return statsAsync.when(
      // A re-read triggered by the change bus keeps the tiles that are already
      // on screen until the new numbers arrive, rather than replacing them with
      // a spinner every time anyone anywhere edits anything.
      skipLoadingOnReload: true,
      loading: () => const SizedBox(
        width: 180,
        height: 120,
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (error, stackTrace) => SizedBox(
        width: 376,
        child: _ErrorRetry(
          message: l10n.commonError,
          onRetry: () => ref.invalidate(dashboardStatsProvider),
        ),
      ),
      data: (stats) {
        // Only a keyword search discovers new channels, so only a search moves
        // this tile: it glows and animates while one runs, turns red (static)
        // if one failed, and has no outline otherwise. Backfilling and the
        // video catch-up pull videos for channels already found — they leave
        // this count alone, so they leave the tile alone too.
        final searchStatus =
            ref.watch(activeSearchRunControllerProvider)?.status;
        final running = searchStatus == SearchRunStatus.running;
        final failed = searchStatus == SearchRunStatus.failed;
        final scheme = Theme.of(context).colorScheme;
        // One spark color per tile, so the row reads as four distinct
        // things: blue for finds, then periwinkle, lemon-lime and rose.
        final accents = GratovoAccents.of(context);

        Widget newFinds = _StatTile(
          icon: Icons.person_add_alt_1_outlined,
          label: l10n.dashboardNewFinds,
          value: stats.newFinds - stats.archiveDue,
          accent: scheme.primary,
          onTap: () => context.go(AppRoutes.search),
          // Hidden rather than shown as "+0 archive due" — same convention as
          // the News/Logs peek cards' _CountChip, which only appears once
          // there's something to say.
          badge: stats.archiveDue > 0
              ? _CountChip(
                  label: l10n.dashboardArchiveDueCount(
                      formatCompact(stats.archiveDue)),
                  background: scheme.onSurface.withAlpha(170),
                  foreground: scheme.surface,
                )
              : null,
        );
        if (running || failed) {
          newFinds = GlowBorder(
            color: failed ? scheme.error : scheme.primary,
            baseAlpha: 0.9,
            animate: running,
            child: newFinds,
          );
        }

        final tiles = [
          newFinds,
          _StatTile(
            icon: Icons.handshake_outlined,
            label: l10n.dashboardActiveNegotiations,
            value: stats.activeNegotiations,
            accent: accents.iris,
            onTap: () => context.go(AppRoutes.deals),
          ),
          _StatTile(
            icon: Icons.send_outlined,
            label: l10n.dashboardEmailsSentToday,
            value: stats.emailsSentToday,
            target: stats.dailyTarget,
            accent: accents.citron,
          ),
          _StatTile(
            icon: Icons.groups_outlined,
            label: l10n.dashboardRosterReady,
            value: stats.readyToPitch,
            target: stats.rosterTarget,
            accent: accents.iris,
            onTap: () => context.go(AppRoutes.roster),
          ),
          _StatTile(
            icon: Icons.edit_note_outlined,
            label: l10n.dashboardDraftedToday,
            value: stats.draftedToday,
            accent: scheme.secondary,
          ),
        ];
        return Wrap(
          spacing: 16,
          runSpacing: 16,
          children: [
            for (final tile in tiles) SizedBox(width: 210, child: tile),
          ],
        );
      },
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.icon,
    required this.label,
    required this.value,
    required this.accent,
    this.onTap,
    this.badge,
    this.target,
  });

  final IconData icon;
  final String label;
  final int value;

  /// When set, the count reads "N of [target]" — the daily target for sent
  /// emails, HC-16's five for the roster.
  final int? target;

  /// The tile's spark color — tints the icon and paints a 3px left edge, so
  /// the four tiles read as a set of distinct things rather than one blue
  /// wall. Assigned by [_StatTiles].
  final Color accent;

  /// When set, the whole tile becomes a tap target that routes elsewhere —
  /// "New finds" opens search, "Active negotiations" opens deals.
  final VoidCallback? onTap;

  /// An optional small pill shown between the count and the label — e.g. the
  /// "New finds" tile's "+N archive due" badge. Callers decide when it's
  /// worth showing at all (typically: not for a zero count).
  final Widget? badge;

  @override
  Widget build(BuildContext context) {
    return HoloCard(
      builder: (context) {
        final content = Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                holoIconBadge(icon),
                const SizedBox(
                  width: 8,
                ),
                Expanded(
                  child: Text(
                    label,
                    style: Theme.of(context).textTheme.labelMedium,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.end,
                  ),
                ),
              ]),
              const SizedBox(height: 12),
              Text(
                // Grouped, not bare interpolation: a dashboard that has been
                // running for a while shows counts in the thousands, and
                // '1240' reads as a different number at a glance than '1,240'.
                _valueText(AppLocalizations.of(context)),
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              if (badge != null) ...[
                const SizedBox(height: 4),
                badge!,
              ],
              const SizedBox(height: 9),
            ],
          ),
        );
        // A spark-colored left edge, drawn as a border so it needs no
        // bounded height (these tiles sit inside IntrinsicHeight rows) —
        // see `holoEdge`.
        final body = holoEdge(accent: accent, child: content);
        return onTap == null ? body : InkWell(onTap: onTap, child: body);
      },
    );
  }

  String _valueText(AppLocalizations l10n) {
    final count = formatCount(value, locale: l10n.localeName);
    final target = this.target;
    if (target == null) return count;
    return l10n.dashboardOfTarget(
        count, formatCount(target, locale: l10n.localeName));
  }
}

/// The News and Logs entry points: a peek at the newest item plus a tap target
/// that opens the full screen in a modal.
class _DashboardPeekRow extends StatelessWidget {
  const _DashboardPeekRow();

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= 720) {
          return const IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: _NewsPeekCard()),
                SizedBox(width: 16),
                Expanded(child: _LogsPeekCard()),
              ],
            ),
          );
        }
        return const Column(
          children: [
            _NewsPeekCard(),
            SizedBox(height: 16),
            _LogsPeekCard(),
          ],
        );
      },
    );
  }
}

/// Shared shell for the two peek cards — icon + title row, then a single
/// snippet line, all of it one tap target.
class _PeekCard extends StatelessWidget {
  const _PeekCard({
    required this.icon,
    required this.title,
    required this.line,
    required this.onTap,
    required this.accent,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final String line;
  final VoidCallback onTap;

  /// Spark color for this card — News and Logs each get their own, so the
  /// pair doesn't read as two identical blue slabs. Tints the icon and a
  /// 3px left edge.
  final Color accent;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return HoloCard(
      builder: (context) {
        final theme = Theme.of(context);
        final iconWidget = holoIconBadge(icon);

        final content = Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  iconWidget,
                  const SizedBox(width: 8),
                  Text(title, style: theme.textTheme.titleSmall),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      line,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ),
                  if (trailing != null) ...[
                    trailing!,
                    const SizedBox(width: 8)
                  ],
                  Icon(
                    Icons.open_in_new,
                    size: 16,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ],
              ),
            ],
          ),
        );
        // Spark-colored left edge, at a thinner weight than the stat
        // tiles' — see `holoEdge`.
        final body = holoEdge(
            accent: accent, child: content, accentWidth: 3, darkWidth: 2);
        return InkWell(onTap: onTap, child: body);
      },
    );
  }
}

class _NewsPeekCard extends ConsumerWidget {
  const _NewsPeekCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final itemsAsync = ref.watch(newsItemsProvider);
    // Told apart from "there is no news", which it used to be indistinguishable
    // from: `orElse` folds loading and error into the same null, so a fetch
    // that failed rendered as an empty feed. Someone looking at a dashboard
    // that calmly says "no stories yet" has no reason to suspect the request
    // never came back, and every reason to think the feed is simply quiet.
    final failed = itemsAsync.hasError;
    final latest = itemsAsync.maybeWhen(
      data: (items) => items.isEmpty ? null : items.first.title,
      orElse: () => null,
    );
    final delta = ref.watch(newsBadgeProvider).delta;

    return _PeekCard(
      icon: failed ? Icons.error_outline : Icons.article_outlined,
      accent: failed
          ? Theme.of(context).colorScheme.error
          : GratovoAccents.of(context).citron,
      title: l10n.navNews,
      line: failed ? l10n.commonError : (latest ?? l10n.dashboardNewsPeekEmpty),
      trailing: delta > 0
          ? _CountChip(label: l10n.dashboardNewsNewCount(delta))
          : null,
      onTap: () {
        // A FutureProvider caches its error exactly as it caches its data, and
        // re-runs only when invalidated. Nothing on this card ever did, so one
        // failed fetch at launch stayed failed for the rest of the session --
        // which is what "it worked earlier, now it doesn't" actually was.
        if (failed) ref.invalidate(newsItemsProvider);
        NewsScreen.showAsDialog(context);
      },
    );
  }
}

class _LogsPeekCard extends ConsumerWidget {
  const _LogsPeekCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final pageAsync =
        ref.watch(activityLogPageProvider(const ActivityLogQuery()));

    final line = pageAsync.maybeWhen(
      data: (state) {
        if (state.items.isEmpty) return null;
        final entry = state.items.first;
        final label = entry.entityLabel;
        return [
          entry.actorName,
          entry.action.label(l10n),
          if (label != null && label.isNotEmpty) label,
        ].join('  ·  ');
      },
      orElse: () => null,
    );
    // How many of the loaded entries landed today — the same "new" count the
    // Logs page shows next to its title.
    final todayCount = pageAsync.maybeWhen(
      data: (state) =>
          state.items.where((e) => fmt.daysUntil(e.at) == 0).length,
      orElse: () => 0,
    );

    // Same distinction as the news card: a log that could not be fetched is not
    // a log with nothing in it, and only one of those is worth tapping twice.
    final failed = pageAsync.hasError;

    return _PeekCard(
      icon: failed ? Icons.error_outline : Icons.history,
      accent: failed
          ? Theme.of(context).colorScheme.error
          : GratovoAccents.of(context).iris,
      title: l10n.navLogs,
      line: failed ? l10n.commonError : (line ?? l10n.dashboardLogsPeekEmpty),
      trailing: todayCount > 0
          ? _CountChip(label: l10n.dashboardNewsNewCount(todayCount))
          : null,
      onTap: () {
        if (failed) {
          ref.invalidate(activityLogPageProvider(const ActivityLogQuery()));
        }
        LogsScreen.showAsDialog(context);
      },
    );
  }
}

class _CountChip extends StatelessWidget {
  const _CountChip({
    required this.label,
    this.background,
    this.foreground,
  });

  final String label;

  /// Defaults to [ColorScheme.primary]/[ColorScheme.onPrimary] — the News and
  /// Logs peek cards' "N new" chips. The dashboard's "archive due" badge
  /// overrides these with the tertiary pair instead, matching the tertiary
  /// used for "archived" elsewhere on this screen (see
  /// channel_analytics_section.dart).
  final Color? background;
  final Color? foreground;

  @override
  Widget build(BuildContext context) {
    // final scheme = Theme.of(context).colorScheme;
    return Text(
      label,
      style:
          Theme.of(context).textTheme.labelSmall?.copyWith(color: background),
    );
  }
}

/// The full upcoming-reminders list — every open reminder with its title and
/// due date, not just a count.
class _UpcomingRemindersCard extends ConsumerWidget {
  const _UpcomingRemindersCard({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final remindersAsync = ref.watch(upcomingRemindersProvider);
    final fmt = ref.watch(instantFormatterProvider);

    return GratovoCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.dashboardUpcomingRemindersTitle,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            remindersAsync.when(
              skipLoadingOnReload: true,
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (error, stackTrace) => _ErrorRetry(
                message: l10n.commonError,
                onRetry: () => ref.invalidate(upcomingRemindersProvider),
              ),
              data: (reminders) {
                if (reminders.isEmpty) {
                  return Text(
                    l10n.dashboardNoReminders,
                    style: Theme.of(context).textTheme.bodyMedium,
                  );
                }
                return Column(
                  children: [
                    for (final reminder in reminders)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(Icons.notifications_outlined),
                        title: Text(reminder.title),
                        subtitle: Text(
                          l10n.dashboardReminderDue(fmt.date(reminder.dueAt)),
                        ),
                      ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorRetry extends StatelessWidget {
  const _ErrorRetry({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Row(
      children: [
        Expanded(child: Text(message)),
        TextButton(onPressed: onRetry, child: Text(l10n.commonRetry)),
      ],
    );
  }
}
