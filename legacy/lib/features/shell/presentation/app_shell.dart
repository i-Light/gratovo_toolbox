import 'package:flutter/foundation.dart' show kReleaseMode;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/images/tagged_image_cleanup_controller.dart';
import 'package:gratovo_toolbox/core/native/gemini_autostart.dart';
import 'package:gratovo_toolbox/core/notifications/notification_reconciler.dart';
import 'package:gratovo_toolbox/core/presence/live_data_service.dart';
import 'package:gratovo_toolbox/core/presence/presence_service.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/sync/presentation/sync_now_button.dart';
import 'package:gratovo_toolbox/core/sync/sync_providers.dart';
import 'package:gratovo_toolbox/core/theme/app_theme.dart';
import 'package:gratovo_toolbox/core/theme/gratovo_logo.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/toast/toast_action.dart';
import 'package:gratovo_toolbox/core/utils/responsive.dart';
import 'package:gratovo_toolbox/features/conflicts/application/conflict_controller.dart';
import 'package:gratovo_toolbox/features/job_scheduler/application/job_scheduler_controller.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_inbox_controller.dart';
import 'package:gratovo_toolbox/features/outreach/application/scheduled_send_controller.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/scheduled_sends.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/auto_clean_controller.dart';
import 'package:gratovo_toolbox/features/search/application/remote_search_intake_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_autochain_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_resume_controller.dart';
import 'package:gratovo_toolbox/features/settings/application/gemini_account_memory.dart';
import 'package:gratovo_toolbox/features/settings/application/merge_status_controller.dart';
import 'package:gratovo_toolbox/features/settings/application/settings_attention_controller.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/attention_outline.dart';
import 'package:gratovo_toolbox/features/shell/application/nav_rail_controller.dart';
import 'package:gratovo_toolbox/features/shell/application/pipeline_badge_controller.dart';
import 'package:gratovo_toolbox/features/skills/application/gem_auto_sync.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// The persistent app chrome around the six top-level sections: a nav rail
/// on tablet/desktop widths, a bottom nav bar on phone widths — driven by
/// [ResponsiveContext] (core/utils/responsive.dart), the same breakpoints
/// used everywhere else in the app.
///
/// [navigationShell] comes from `StatefulShellRoute.indexedStack` in
/// app_router.dart; switching destinations calls `goBranch`, which
/// preserves each branch's own navigation stack.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  void _onDestinationSelected(WidgetRef ref, int branch) {
    // The badge exists to say "something needs your attention on Search";
    // actually going there is what attending to it means. Watching for the
    // page to render wouldn't work — it's kept alive inside the shell's own
    // `IndexedStack` (see `app_router.dart`), so it can rebuild while
    // offstage and clear the badge before anyone actually looked.
    if (branch == _searchBranch) {
      ref.read(pipelineBadgeProvider.notifier).acknowledge();
    }
    navigationShell.goBranch(
      branch,
      initialLocation: branch == navigationShell.currentIndex,
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    // The rail shows only what this account may open. Outreach is hidden
    // from `basic` — the page, not the data: its rows still sync to this
    // machine for the counts other pages derive from them. The branch
    // indices stay those of app_router.dart; only the rendered list shrinks,
    // which is why every destination carries its own branch number.
    final seesOutreach = ref.watch(accessLevelProvider).seesSensitiveData;
    final destinations = [
      for (final d in _destinations(l10n))
        if (seesOutreach || d.branch != _outreachBranch) d,
    ];
    final searchIndex = destinations.indexWhere((d) => d.icon == Icons.search);
    final settingsIndex =
        destinations.indexWhere((d) => d.icon == Icons.settings_rounded);
    final selectedIndex = destinations
        .indexWhere((d) => d.branch == navigationShell.currentIndex)
        .clamp(0, destinations.length - 1);
    final badgeStatus = ref.watch(pipelineBadgeProvider);
    // Unlike Search's badge, this one is not acknowledged by visiting the
    // page: it reflects a condition (an update waiting, a credential the
    // server is refusing) rather than an event, so it clears when the
    // condition does and not before. Opening Settings and ignoring what is
    // there should not make the dot go away.
    final attention = ref.watch(settingsAttentionProvider);

    /// The dot color for a destination, or null for no dot.
    Color? badgeColorFor(int index) {
      if (index == searchIndex) {
        return _pipelineBadgeColor(context, badgeStatus);
      }
      if (index == settingsIndex) {
        return _attentionBadgeColor(context, attention);
      }
      return null;
    }

    void onDestinationSelected(int index) =>
        _onDestinationSelected(ref, destinations[index].branch);

    // The shell is the one widget alive for as long as someone is using the
    // app, which makes it the right place to hold the two realtime
    // subscriptions open. Watching them here — rather than from whichever
    // screen happens to need them — means they connect once at sign-in and
    // stay connected while navigating, instead of tearing down and
    // reconnecting every time a page is left.
    ref.watch(presenceControllerProvider);
    ref.watch(liveDataControllerProvider);
    // The third source of "something changed": not a person on this machine
    // and not a realtime push, but a local-mirror download landing. Held open
    // here for the same reason as the two above it.
    ref.watch(mirrorChangeAnnouncerProvider);
    // Replication follows the session, not whichever screen happens to be
    // open. It used to hang off `localMirrorProvider`, so nothing connected
    // until a screen read a mirror-backed repository — and the sync button in
    // this very shell was a no-op that still reported success until it did.
    ref.watch(syncConnectionProvider);
    ref.watch(taggedImageCleanupControllerProvider);
    // Kept alive here so a database a shipped reset set aside on this machine
    // is reported to the team board on sign-in, whether or not anyone opens
    // Settings. A no-op with nothing quarantined.
    ref.watch(localMergeQuarantineProvider);

    // Re-arms the OS follow-up notifications from the reminder list whenever
    // it resolves — covers reminders created on another machine and the
    // app-was-closed case. No-op on platforms without a notification backend.
    ref.watch(notificationReconcilerProvider);

    // If the previous session was killed while a search was running (the app
    // closed mid-run, a crash), pick the keywords it had left back up now. A
    // run the user stopped, or one that failed on its own, is left alone. Self
    // -guards to one attempt, and is a no-op off a native desktop build.
    ref
        .read(searchResumeControllerProvider.notifier)
        .resumeIfInterrupted(startedByLabel: l10n.searchStartedByThisDevice);

    // Chains the next run when one finishes with keywords still pending, and
    // picks up keyword lists other team members have sent this machine —
    // both regardless of whether the Search screen happens to be open. See
    // `search_autochain_controller.dart` and
    // `remote_search_intake_controller.dart`.
    ref
        .read(searchAutoChainControllerProvider.notifier)
        .setStartedByLabel(l10n.searchStartedByThisDevice);
    ref.watch(searchAutoChainControllerProvider);
    ref.watch(remoteSearchIntakeControllerProvider);

    // ...and say so when it happens. An auto-resumed run is the one pipeline
    // job in the app that nobody started this session: it begins on its own,
    // on whatever page the app happens to open on, and it inserts channels for
    // as long as it takes to finish the list. Until this notice the only sign
    // of it was a dot on the Search icon, which does not distinguish "a run
    // you started finished" from "a run you did not start is going right now"
    // — so from the Influencer list it read as channels appearing out of
    // nowhere. See `search_resume_controller.dart`.
    ref.listen<SearchResumeStatus>(searchResumeControllerProvider,
        (previous, next) {
      if (next != SearchResumeStatus.resumed) return;
      final remaining =
          ref.read(activeSearchRunControllerProvider)?.keywords.length ?? 0;
      if (remaining == 0) return;
      // Off the build that triggered it: a listener can fire mid-frame, and
      // the toast overlay reads the provider container off `context`, which
      // is not safe to do mid-build either.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!context.mounted) return;
        AppToast.warning(
          context,
          l10n.searchResumedNotice(remaining),
          duration: const Duration(seconds: 10),
          action: ToastAction(
            label: l10n.searchResumedAction,
            onPressed: () => onDestinationSelected(searchIndex),
          ),
        );
      });
    });

    // The standing auto-clean rule applies to a run that finishes, and a run
    // finishes whichever page somebody happens to be on. Watched here rather
    // than by the Search page — which is where its trigger used to live, so a
    // run started and then navigated away from was never swept at all.
    ref.watch(autoCleanRunnerProvider);

    // The outreach mailbox loop: every few minutes, ask whether anyone has
    // replied and send the follow-ups that have come due. Held here for the
    // same reason as the subscriptions above — it has to keep running while
    // somebody navigates around, and the Outreach page is precisely the page
    // they are NOT on when a reply matters most. It is a no-op on a machine
    // with no mailbox connected, which is most of them.
    ref.watch(outreachInboxProvider.notifier).start();

    // "Send later": sends the emails whose time has come, while the app is
    // open. Late ones -- the app was closed at their time -- wait in the
    // strip below for a person. See scheduled_send_controller.dart.
    ref.watch(scheduledSendProvider.notifier).start();

    // The generic job scheduler: checks scheduled_jobs for due work once a
    // minute, whatever page is open. See job_scheduler_controller.dart.
    ref.watch(jobSchedulerControllerProvider.notifier).start();

    // Gemini in the browser: starts the bridge and opens a Gemini window in
    // the background at launch, and re-opens it when it goes away.
    ref.watch(geminiAutoStartProvider);
    // Remembers the Google account Gemini reports, so Settings can still say
    // who it belongs to while the browser is closed.
    ref.watch(geminiAccountMemoryProvider);
    // Pushes the skill decks' gem cards to their Gemini gems while Gemini is
    // connected, so a changed gem needs no button. See gem_auto_sync.dart.
    ref.watch(gemAutoSyncProvider);

    // Conflicts are not a destination — see AppRoutes.conflicts. They surface
    // here instead, as a strip that exists only while there is something to
    // decide. Putting it in the shell rather than on each screen's app bar is
    // what makes it unmissable: a refused edit is not visible anywhere else,
    // and the person who needs to know is whoever is looking at the app, not
    // whoever happens to open the right page.
    //
    // WHERE THE SYNC BUTTON LIVES, AND WHY IT MOVES
    // ----------------------------------------------
    // On a phone there is no rail to put it in, so it floats over the
    // navigated content rather than sitting in the Column: a Column entry
    // shifts every screen's layout by its height, and the "update from
    // server" ask is occasional enough that stealing permanent space for it
    // on every section is the wrong trade. Scoped to the
    // Expanded(navigationShell) rather than the whole body so it never lands
    // on top of the conflict strip below it, and pinned bottom-LEFT — the
    // influencer list's own FAB already owns bottom-right, and Material's
    // convention keeps every other screen's FAB there too.
    //
    // Everywhere there IS a rail, it goes at the bottom of the rail instead.
    // That is the better home for it: it stops overlapping whatever a screen
    // puts in its own bottom-left corner, and it reads as what it is — a
    // control belonging to the app rather than to the page currently open.
    final hasRail = !context.isMobile;
    final body = Column(
      children: [
        Expanded(
          child: hasRail
              ? navigationShell
              : Stack(
                  children: [
                    navigationShell,
                    const Positioned(
                      left: 16,
                      bottom: 16,
                      child: SyncNowButton(),
                    ),
                  ],
                ),
        ),
        const ScheduledSendsAttentionStrip(),
        const _ConflictStrip(),
      ],
    );

    if (context.isMobile) {
      return Scaffold(
        body: body,
        bottomNavigationBar: NavigationBar(
          selectedIndex: selectedIndex,
          onDestinationSelected: onDestinationSelected,
          destinations: [
            for (final (index, d) in destinations.indexed)
              NavigationDestination(
                icon: _navIcon(
                  d.customIcon ?? Icon(d.icon),
                  badgeColorFor(index),
                ),
                label: d.label,
              ),
          ],
        ),
      );
    }

    // Labels are only affordable at desktop widths, so that is the only place
    // the collapse toggle has anything to decide — a tablet rail is icons-only
    // whatever the preference says, because there is no room for the labels.
    final collapsed = ref.watch(navRailCollapsedProvider);
    final extended = context.isDesktop && !collapsed;
    // "Icons only" means exactly that. Collapsing used to swap the labels
    // beside the icons for labels underneath them, which saves width but is
    // still a rail full of words — not what the toggle says it does. Collapsed
    // now drops the labels entirely; a tablet rail keeps them under the icons,
    // because there the labels are the only thing naming a destination and
    // there is no toggle to bring them back.
    final iconsOnly = context.isDesktop && collapsed;

    return Scaffold(
      body: Row(
        children: [
          // The rail and the sync button share a Stack so the button can sit
          // at the very bottom of the rail rather than immediately under the
          // last destination — NavigationRail's own `trailing` slot follows
          // the destinations, which once the window is tall is a different
          // place entirely. The Stack takes its size from the rail, so the
          // button stays centred on whatever width the rail currently has.
          Stack(
            children: [
              NavigationRail(
                selectedIndex: selectedIndex,
                onDestinationSelected: onDestinationSelected,
                extended: extended,
                // NavigationRail asserts labelType must be `none` when
                // extended, since an extended rail always shows labels beside
                // the icons.
                labelType: extended || iconsOnly
                    ? NavigationRailLabelType.none
                    : NavigationRailLabelType.all,
                leading: context.isDesktop
                    ? _RailCollapseToggle(collapsed: collapsed)
                    : null,
                // Room at the bottom for the sync button stacked over it, so
                // a short window scrolls the last destination clear of it
                // rather than under it.
                trailing: const SizedBox(height: 72),
                destinations: [
                  for (final (index, d) in destinations.indexed)
                    NavigationRailDestination(
                      // NavigationRail does not tooltip its own destinations,
                      // so with the labels gone the icon has to carry the name
                      // itself — otherwise a collapsed rail is a column of
                      // glyphs and a guess.
                      icon: iconsOnly
                          ? Tooltip(
                              message: d.label,
                              child: _navIcon(
                                d.customIcon ?? Icon(d.icon),
                                badgeColorFor(index),
                              ),
                            )
                          : _navIcon(
                              d.customIcon ?? Icon(d.icon),
                              badgeColorFor(index),
                            ),
                      label: Text(d.label),
                    ),
                ],
              ),
              const Positioned(
                left: 0,
                right: 0,
                bottom: 16,
                child: Center(child: SyncNowButton()),
              ),
            ],
          ),
          const VerticalDivider(width: 1),
          Expanded(child: body),
        ],
      ),
    );
  }

  /// A destination's plain icon, or the same icon carrying a small dot in
  /// [color]. Null means no dot.
  Widget _navIcon(Widget icon, Color? color) {
    if (color == null) return icon;
    // No `label`: Badge falls back to its small borderless dot, which is all
    // this needs to say — "something", not a count of somethings.
    return Badge(backgroundColor: color, smallSize: 9, child: icon);
  }

  /// Search's dot: a pipeline run's progress. Cleared by visiting the page —
  /// see [_onDestinationSelected].
  Color? _pipelineBadgeColor(BuildContext context, PipelineBadgeStatus status) {
    final scheme = Theme.of(context).colorScheme;
    final custom = Theme.of(context).extension<GratovoStatusColors>();
    return switch (status) {
      PipelineBadgeStatus.none => null,
      PipelineBadgeStatus.running => custom?.info ?? scheme.primary,
      PipelineBadgeStatus.success => custom?.success ?? scheme.primary,
      PipelineBadgeStatus.error => scheme.error,
    };
  }

  /// Settings' dot: something on that page wants a look. Error-colored only
  /// for a credential that is already being refused — an update waiting to be
  /// installed is news, not a fault, and coloring the two the same would
  /// train the dot to be ignored.
  ///
  /// Shares `attentionColor` with the outline drawn around the card on the
  /// page, so following the dot lands on something the same color.
  Color? _attentionBadgeColor(
      BuildContext context, SettingsAttention attention) {
    final level = attention.level;
    return level == null ? null : attentionColor(context, level);
  }

  /// The shell branch indices, in app_router.dart's order.
  static const _searchBranch = 1;
  static const _outreachBranch = 4;

  List<_NavDestination> _destinations(AppLocalizations l10n) => [
        // Home/Dashboard carries the Gratovo mark itself rather than a
        // Material icon — the one destination that doubles as the app's
        // brand identity in the rail/bottom nav.
        _NavDestination(
          0,
          Icons.dashboard_outlined,
          l10n.navDashboard,
          customIcon: const GratovoLogo(size: 24, flat: true),
        ),
        _NavDestination(_searchBranch, Icons.search, l10n.navSearch),
        // Influencers, brands and the archive, switched between from the app
        // bar rather than the rail — see RosterScreen.
        _NavDestination(2, Icons.groups_outlined, l10n.navRoster),
        _NavDestination(3, Icons.handshake_outlined, l10n.navDeals),
        // Outreach carries the email critique library and the team
        // scratchpad as its second and third views — see the switcher in
        // OutreachScreen — so neither has its own rail slot.
        _NavDestination(_outreachBranch, Icons.mail_outline, l10n.navOutreach),
        // News and Logs are not rail destinations — they open as modals from
        // the Dashboard's peek cards.
        //
        // Kept immediately before Settings so this list's order matches the
        // shell branch order in app_router.dart. Finance carries the team
        // performance rollup as its top section — see finance_screen.dart —
        // so Team Dashboard has no rail slot of its own either.
        if (!kReleaseMode)
          _NavDestination(
              5, Icons.account_balance_wallet_outlined, l10n.financeNavLabel),
        _NavDestination(
            kReleaseMode ? 5 : 6, Icons.settings_rounded, l10n.navSettings),
      ];
}

/// The "somebody's edit is waiting" strip along the bottom of the app.
///
/// Renders a zero-height [SizedBox] when there is nothing open, which is the
/// normal state — so on a healthy week the shell looks exactly as it did before
/// conflicts existed. Deliberately not a snackbar: a snackbar is gone in four
/// seconds and a conflict outlives the session that caused it.
class _ConflictStrip extends ConsumerWidget {
  const _ConflictStrip();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(openConflictCountProvider);
    if (count == 0) return const SizedBox.shrink();

    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Material(
      color: scheme.errorContainer,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
          child: Row(
            children: [
              Icon(Icons.call_split, size: 18, color: scheme.onErrorContainer),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  l10n.conflictsShellBanner(count),
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(color: scheme.onErrorContainer),
                ),
              ),
              TextButton(
                onPressed: () => context.push(AppRoutes.conflicts),
                style: TextButton.styleFrom(
                  foregroundColor: scheme.onErrorContainer,
                ),
                child: Text(l10n.conflictProfileBannerAction),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The icons-only switch at the top of the desktop rail.
///
/// A [ConsumerWidget] of its own rather than an `IconButton` built inline, so
/// pressing it rebuilds one button instead of the whole shell — the shell is
/// the widget holding every realtime subscription open, and rebuilding all of
/// that to hide a row of labels is a lot of work for a very small change.
class _RailCollapseToggle extends ConsumerWidget {
  const _RailCollapseToggle({required this.collapsed});

  final bool collapsed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return IconButton(
      tooltip: collapsed ? l10n.navRailExpand : l10n.navRailCollapse,
      icon: Icon(collapsed ? Icons.menu : Icons.menu_open),
      onPressed: () => ref.read(navRailCollapsedProvider.notifier).toggle(),
    );
  }
}

class _NavDestination {
  const _NavDestination(this.branch, this.icon, this.label, {this.customIcon});

  /// The shell branch this opens — its index in app_router.dart, which is
  /// not its position in the rail once a destination is hidden.
  final int branch;
  final IconData icon;
  final String label;

  /// Overrides [icon] when set — used for the Home/Dashboard destination's
  /// Gratovo-mark icon; every other destination falls back to a plain
  /// [Icon] built from [icon].
  final Widget? customIcon;
}
