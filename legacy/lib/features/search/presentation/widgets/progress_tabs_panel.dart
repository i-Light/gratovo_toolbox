import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/data/models/channel_run.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/backfill_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/reenrich_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/video_catchup_controller.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/channel_run_progress_panel.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/search_progress_panel.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/video_catchup_panel.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Which of the four background-job panels a tab can show. Order here is
/// also tab order — search first since it is the one thing this page is
/// for, the other three in the order they were added.
enum _Job { search, backfill, reenrich, videoCatchUp }

/// The four job panels that used to stack down the Search page — live search
/// progress, and the rarer one-off backfill / re-enrich / video-catch-up
/// passes — folded into one tabbed card.
///
/// They used to render inline, one under another, each staying empty
/// (`SizedBox.shrink`) until its job had actually run. That was fine while
/// the page itself could scroll past whatever piled up; now the page fills
/// the screen and never scrolls (see `search_screen.dart`), so a card that
/// can only grow was no longer an option. A tab exists once its job has run
/// this session — same rule as before, just a tab instead of a stacked card —
/// and [_Job.search] is the one exception, always present, since "no run
/// yet" is itself something this page has to say.
///
/// The active tab follows whichever job is actually running: see
/// `ref.listen` in [build]. Only the transition into running switches it, so
/// reading a finished run's log is never interrupted by another job quietly
/// starting in the background.
class ProgressTabsPanel extends ConsumerStatefulWidget {
  const ProgressTabsPanel({super.key, this.fullScreen = false});

  /// True for the copy shown inside [_FullScreenProgress] — swaps the
  /// maximize button for a close button instead of offering to maximize
  /// a panel that already fills the screen.
  final bool fullScreen;

  @override
  ConsumerState<ProgressTabsPanel> createState() => _ProgressTabsPanelState();
}

class _ProgressTabsPanelState extends ConsumerState<ProgressTabsPanel>
    with TickerProviderStateMixin {
  TabController? _controller;
  List<_Job> _jobs = const [_Job.search];

  @override
  void initState() {
    super.initState();
    _controller = TabController(length: 1, vsync: this);
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  /// Rebuilds the controller when the set of tabs changes length — a
  /// `TabController`'s length is fixed for its lifetime, so a new tab
  /// appearing (a backfill starting for the first time this session, say)
  /// needs a new one. The previously selected job stays selected if it is
  /// still around; otherwise this falls back to the last tab, which is
  /// whichever job just appeared.
  void _syncController(List<_Job> jobs) {
    final previous = _controller;
    final previousJob = previous != null && _jobs.length > previous.index
        ? _jobs[previous.index]
        : null;
    final keepIndex = previousJob != null ? jobs.indexOf(previousJob) : -1;
    previous?.dispose();
    _jobs = jobs;
    _controller = TabController(
      length: jobs.length,
      vsync: this,
      initialIndex: keepIndex >= 0 ? keepIndex : jobs.length - 1,
    );
  }

  /// Deferred to after the frame: this runs from `ref.listen`, which can fire
  /// mid-build, and moving the `TabController`'s index then would notify a
  /// `TabBar`/`TabBarView` that is still being built — the same hazard
  /// `search_screen.dart`'s `_scheduleProgressPaint` is deferred to avoid.
  void _switchTo(_Job job) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final index = _jobs.indexOf(job);
      if (index >= 0) _controller?.animateTo(index);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    final backfillRun = ref.watch(backfillRunControllerProvider);
    final reenrichRun = ref.watch(reenrichRunControllerProvider);
    final videoCatchUp = ref.watch(videoCatchUpControllerProvider);
    final videoCatchUpVisible = videoCatchUp.hasProgressToShow &&
        !(videoCatchUp.status == VideoCatchUpStatus.done &&
            videoCatchUp.channelsDone == 0);

    final jobs = [
      _Job.search,
      if (backfillRun != null) _Job.backfill,
      if (reenrichRun != null) _Job.reenrich,
      if (videoCatchUpVisible) _Job.videoCatchUp,
    ];
    if (_controller == null ||
        _jobs.length != jobs.length ||
        !_sameOrder(_jobs, jobs)) {
      _syncController(jobs);
    }

    // Whichever job just started running is the one worth looking at. Each
    // listener fires only on the false-to-true edge, not on every rebuild —
    // a run printing new log lines every few hundred milliseconds must not
    // re-select the tab it is already on.
    ref.listen(activeSearchRunControllerProvider, (previous, next) {
      final was = previous?.status == SearchRunStatus.running;
      final now = next?.status == SearchRunStatus.running;
      if (!was && now) _switchTo(_Job.search);
    });
    ref.listen(backfillRunControllerProvider, (previous, next) {
      final was = previous?.status == ChannelRunStatus.running;
      final now = next?.status == ChannelRunStatus.running;
      if (!was && now) _switchTo(_Job.backfill);
    });
    ref.listen(reenrichRunControllerProvider, (previous, next) {
      final was = previous?.status == ChannelRunStatus.running;
      final now = next?.status == ChannelRunStatus.running;
      if (!was && now) _switchTo(_Job.reenrich);
    });
    ref.listen(videoCatchUpControllerProvider, (previous, next) {
      final was = previous?.isRunning ?? false;
      if (!was && next.isRunning) _switchTo(_Job.videoCatchUp);
    });

    final controller = _controller!;

    return Card(
      color: AppColors.darkCardBright.withAlpha(50),
      elevation: 0,
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: TabBar(
                  controller: controller,
                  isScrollable: true,
                  tabAlignment: TabAlignment.start,
                  labelColor: theme.colorScheme.primary,
                  tabs: [
                    for (final job in jobs) Tab(text: _label(l10n, job)),
                  ],
                ),
              ),
              IconButton(
                tooltip: widget.fullScreen
                    ? l10n.progressRestoreTooltip
                    : l10n.progressMaximizeTooltip,
                icon: Icon(
                  widget.fullScreen
                      ? Icons.close_fullscreen
                      : Icons.open_in_full,
                  size: 18,
                ),
                onPressed: () => widget.fullScreen
                    ? Navigator.of(context).pop()
                    : _openFullScreen(context),
              ),
            ],
          ),
          const Divider(height: 1),
          Expanded(
            child: TabBarView(
              controller: controller,
              children: [
                for (final job in jobs) _tabBody(job),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _openFullScreen(BuildContext context) {
    Navigator.of(context, rootNavigator: true).push(
      PageRouteBuilder<void>(
        opaque: true,
        fullscreenDialog: true,
        transitionsBuilder: (_, animation, __, child) =>
            FadeTransition(opacity: animation, child: child),
        pageBuilder: (_, __, ___) => const _FullScreenProgress(),
      ),
    );
  }

  bool _sameOrder(List<_Job> a, List<_Job> b) {
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }

  String _label(AppLocalizations l10n, _Job job) => switch (job) {
        _Job.search => l10n.searchProgressTitle,
        _Job.backfill => l10n.backfillProgressTitle,
        _Job.reenrich => l10n.reenrichProgressTitle,
        _Job.videoCatchUp => l10n.videoCatchUpTitle,
      };

  /// Search gets its bounded height straight from the `TabBarView` and fills
  /// it itself — its log grows to whatever room is left instead of stopping
  /// at a fixed height (see `SearchProgressPanel`). The other three jobs are
  /// unchanged: `SingleChildScrollView` still holds their un-flexed content,
  /// which never had to fill the tab, only avoid overflowing it.
  Widget _tabBody(_Job job) => switch (job) {
        _Job.search => const SearchProgressPanel(),
        _ => SingleChildScrollView(child: _body(job)),
      };

  Widget _body(_Job job) => switch (job) {
        _Job.search => const SearchProgressPanel(),
        _Job.backfill => ChannelRunProgressPanel(
            provider: backfillRunControllerProvider,
          ),
        _Job.reenrich => ChannelRunProgressPanel(
            provider: reenrichRunControllerProvider,
          ),
        _Job.videoCatchUp => const VideoCatchUpPanel(),
      };
}

/// Full-window view pushed by the maximize button — the same
/// [ProgressTabsPanel], just given the whole screen instead of whatever
/// sliver of `search_screen.dart`'s split it normally gets, so a long-running
/// job can be watched from across the room without the app itself taking up
/// much space.
class _FullScreenProgress extends StatelessWidget {
  const _FullScreenProgress();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: SafeArea(
        child: Padding(
          padding: EdgeInsets.all(12),
          child: ProgressTabsPanel(fullScreen: true),
        ),
      ),
    );
  }
}
