import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/logging/activity_logger.dart';
import 'package:gratovo_toolbox/core/sync/sync_providers.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/archive/application/archive_controller.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/auto_clean_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_keywords_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_settings_controller.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/keyword_input.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/progress_tabs_panel.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/search_settings_panel.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/searching_now_row.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/shared_data_status.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Search settings, the keyword box and live progress fill the whole page —
/// nothing here scrolls except the fixed-height log inside the progress tabs
/// themselves. Only the Start button and the two lines that qualify it stay
/// pinned to the bottom.
///
/// The keyword box and the progress panel split whatever space is left
/// between them, sharing a row on a wide window ([_sideBySideMinWidth]) or
/// stacking on a narrow one — either way a drag handle lets the split move,
/// and both are given the *exact* remaining height by the `LayoutBuilder`
/// below rather than measured after the fact, which is what lets the page as
/// a whole stay unscrollable: nothing on it can grow past what is left.
///
/// The progress side used to be one card (live search only), with three more
/// job panels — backfill, re-enrich, video catch-up — stacked underneath it,
/// each invisible until its job had run. A page that cannot scroll has
/// nowhere for a stack like that to go, so they are folded into tabs inside
/// `ProgressTabsPanel` instead: one tab per job, present only once that job
/// has actually run this session, switching automatically to whichever job
/// is running right now.
///
/// How wide this page has to be before the keyword box and the progress panel
/// stop stacking and share a row. Two ~430px cards plus the gap and the page's
/// own padding — below this the pair would be narrower than the keyword box
/// wants to be for a pasted list.
const double _sideBySideMinWidth = 900;

/// Neither panel may be dragged narrower than this (side by side) or shorter
/// than this (stacked).
const double _minPanelWidth = 280;
const double _minPanelHeight = 200;

/// The draggable divider's own thickness, carved out of the space between
/// the two minimums above.
const double _splitterWidth = 16;

class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  final _keywordsController = KeywordListController();

  /// The keyword count is a `ValueNotifier`, not `setState`, on purpose.
  ///
  /// This is the text-selection stutter fix. `TextEditingController` notifies
  /// its listeners on *selection* changes as well as text changes — so simply
  /// dragging to select text fired the listener on every pointer move, and the
  /// old code called `setState` each time, rebuilding the entire screen
  /// (settings panel, progress panel and all) mid-drag. Now the listener
  /// rebuilds one small `ValueListenableBuilder` around the count label, and
  /// only when the text has actually changed.
  final _keywordCount = ValueNotifier<int>(0);

  /// Last text we counted, so pure selection changes are cheap no-ops.
  String _lastCountedText = '';

  /// The box is seeded from the saved text exactly once. Doing it on every
  /// build would overwrite what the person is typing with what was on disk.
  bool _seeded = false;

  /// How the side-by-side row splits its width between the keyword box and
  /// the progress panel — dragged via [_PanelSplitter]. A fraction rather
  /// than a pixel width so it survives the window being resized.
  double _keywordsFraction = 0.5;

  /// Same idea as [_keywordsFraction] but for the stacked layout's height
  /// split, on a narrow window where the two panels sit one above the other
  /// instead of side by side.
  double _keywordsHeightFraction = 0.4;

  /// The keyword box's width in the side-by-side layout, per
  /// [_keywordsFraction] — clamped so neither panel is dragged away
  /// entirely. The lower bound of the clamp range is widened, not just the
  /// value clamped into it, on a window too narrow to give both panels their
  /// minimum — `clamp` throws if its own bounds are inverted, and this page
  /// no longer scrolls its way out of a cramped window the way it used to.
  double _keywordsWidth(double totalWidth) {
    final maxWidth = totalWidth - _minPanelWidth - _splitterWidth;
    return (totalWidth * _keywordsFraction - _splitterWidth / 2).clamp(
        _minPanelWidth, maxWidth < _minPanelWidth ? _minPanelWidth : maxWidth);
  }

  /// The keyword box's height in the stacked layout, per
  /// [_keywordsHeightFraction] — clamped the same way [_keywordsWidth] is,
  /// including against a window too short for both minimums.
  double _keywordsHeight(double totalHeight) {
    final maxHeight = totalHeight - _minPanelHeight - _splitterWidth;
    return (totalHeight * _keywordsHeightFraction - _splitterWidth / 2).clamp(
        _minPanelHeight,
        maxHeight < _minPanelHeight ? _minPanelHeight : maxHeight);
  }

  @override
  void initState() {
    super.initState();
    _keywordsController.addListener(_onKeywordsChanged);
  }

  @override
  void dispose() {
    _keywordsController.removeListener(_onKeywordsChanged);
    _keywordsController.dispose();
    _keywordCount.dispose();
    super.dispose();
  }

  List<String> get _typedKeywords =>
      SearchKeywordsState(text: _keywordsController.text).keywords;

  void _onKeywordsChanged() {
    final text = _keywordsController.text;
    // Selection moved but the text is identical — nothing to recompute.
    if (text == _lastCountedText) return;
    _lastCountedText = text;
    _keywordCount.value = _typedKeywords.length;
    // Persisted (debounced) so the list survives closing the app.
    ref.read(searchKeywordsProvider.notifier).setText(text);
  }

  Future<void> _startSearch(AppLocalizations l10n,
      {bool fromTop = false, int? startAtIndex}) async {
    if (fromTop) ref.read(searchKeywordsProvider.notifier).clearProgress();
    final saved = ref.read(searchKeywordsProvider);
    final allKeywords = _typedKeywords;
    if (allKeywords.isEmpty) {
      AppToast.warning(context, l10n.searchNoKeywordsError);
      return;
    }
    // A resumed run is handed only what is left, but still counts towards the
    // whole list — so picking up a 12-keyword list at number six reads "5/12",
    // not "0/7". `fromTop` has just cleared the progress, so this is empty in
    // that case and the run is the whole list again.
    final completed = fromTop ? const <String>[] : saved.completed;
    final done = completed.toSet();
    // A manual "start at #" hands the pipeline the whole list, verbatim, and
    // tells it where to begin (`start_at_index`, `search.py`) — deliberately
    // not filtered by what is already marked done, the same way the index
    // itself is independent of the completed/pending tracking everywhere
    // else on this screen. See `keyword_input.dart`'s "start at" dialog.
    final toRun = startAtIndex != null
        ? allKeywords
        : [
            for (final keyword in allKeywords)
              if (!done.contains(keyword)) keyword,
          ];
    if (toRun.isEmpty) {
      AppToast.info(context, l10n.searchAllKeywordsDone);
      return;
    }

    final settings = ref.read(searchSettingsProvider);
    final runConfig = settings.toRunConfigJson();
    if (startAtIndex != null && startAtIndex > 1) {
      runConfig['start_at_index'] = startAtIndex;
    }
    // The auto-clean rule's subscriber range rides along on the Start button so
    // the pipeline can act on it mid-run (`config.py` reads `auto_clean`). Full
    // authority only — the same gate the panel itself is behind — and only when
    // the rule actually has something for the pipeline to do.
    if (ref.read(canBulkCleanProvider)) {
      final gate = ref.read(autoCleanRuleProvider).toRunConfigJson();
      if (gate != null) runConfig['auto_clean'] = gate;
    }
    try {
      await ref.read(activeSearchRunControllerProvider.notifier).startSearch(
            keywords: toRun,
            runConfigJson: runConfig,
            startedByLabel: l10n.searchStartedByThisDevice,
            keywordTotal: allKeywords.length,
            alreadyCompleted: completed,
          );
      // Recorded only after the run actually started. Which keywords a run was
      // started with is the one thing anyone wants to know about it afterwards,
      // and they are not sensitive.
      ref.read(activityLoggerProvider).searchStarted(keywords: toRun);
      if (!mounted) return;
      AppToast.success(context, l10n.searchStarted);
    } catch (error) {
      if (!mounted) return;
      AppToast.error(context, l10n.searchStartFailed('$error'));
    }
  }

  /// See the call site in [build] for why this is deferred a frame.
  void _scheduleProgressPaint({
    required Set<String> completed,
    String? current,
  }) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _keywordsController.setProgress(completed: completed, current: current);
    });
  }

  Future<void> _stopSearch(AppLocalizations l10n) async {
    await ref.read(activeSearchRunControllerProvider.notifier).stopSearch();
    if (!mounted) return;
    AppToast.info(context, l10n.searchStopRequested);
  }

  /// Says out loud what the standing auto-clean rule just did.
  ///
  /// The sweep itself is not run from here any more — it hangs off
  /// [autoCleanRunnerProvider]'s own listener, so it happens whether or not
  /// this page is open (see that class). This is only the announcement, and
  /// only when this page happens to be the one on screen.
  ///
  /// Also on screen in the panel, which is the durable record. The snackbar is
  /// here because something destructive happened while the person was looking
  /// at a different part of the page, and it should not be possible to miss it
  /// by having the panel collapsed.
  void _reportAutoClean(AutoCleanReport report) {
    final l10n = AppLocalizations.of(context);
    final outcome = report.outcome;
    if (outcome == null) {
      AppToast.error(context, l10n.searchAutoCleanFailed);
    } else {
      AppToast.success(context, l10n.searchAutoCleanRan(outcome.tagged));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final caps = ref.watch(capabilitiesProvider);
    final run = ref.watch(activeSearchRunControllerProvider);
    final isRunning = run?.status == SearchRunStatus.running;
    final saved = ref.watch(searchKeywordsProvider);

    // Seeded once the saved text has actually been read back — see [_seeded].
    if (!_seeded && saved.loaded) {
      _seeded = true;
      _keywordsController.text = saved.text;
      _lastCountedText = saved.text;
      _keywordCount.value = saved.keywords.length;
    }

    // What the box paints: finished keywords dimmed, the live one pilled.
    // While a run is going the run itself is the authority (it is ahead of
    // what has been persisted); between runs the saved progress is.
    //
    // After the frame, not during it. `setProgress` notifies the controller's
    // listeners, and the `EditableText` inside the keyword box is one of them
    // — notifying mid-build would mark a widget dirty while the tree above it
    // is still being built, which Flutter treats as an error. Costing the
    // dimming one frame is not something anyone can see.
    _scheduleProgressPaint(
      completed: (isRunning ? run!.completedKeywords : saved.completed).toSet(),
      current: run?.currentKeyword,
    );

    // Progress is written through on every change, not only when the run ends.
    // The whole point is to survive a run that *doesn't* end cleanly — a crash,
    // a machine going to sleep, someone closing the app mid-run.
    ref.listen<SearchRun?>(activeSearchRunControllerProvider, (previous, next) {
      if (next == null) return;
      if (previous?.completedKeywords.length != next.completedKeywords.length) {
        ref
            .read(searchKeywordsProvider.notifier)
            .setCompleted(next.completedKeywords);

        // `search.py` pushes everything it has after each keyword, so a
        // keyword finishing is a keyword's worth of new channels arriving on
        // the server. Asking the mirror to catch up is what lets the
        // Influencers page fill in while the run is still going instead of
        // hours later — the request coalesces, so a fifty-keyword run costs a
        // handful of passes.
        //
        // The `done:` line is printed just BEFORE that push, so this pass can
        // land a moment early and miss the last keyword's rows. Harmless: the
        // next keyword's ask, and the one at the end of the run below, pick
        // them up. Realtime gets there first when it is working at all; this is
        // the path that still works when it is not.
        ref.read(mirrorCatchUpProvider).request();
      }

      // A run this session started finishing is the one moment sourcing data
      // actually changed underneath every other screen — refresh what a
      // completed run could have affected, and apply the auto-clean rule to
      // what it brought in.
      //
      // Safe to hang the sweep off this: `search.py` pushes to Supabase before
      // it exits, so by the time the process' exit code lands here the channels
      // the run found are rows the server can see. A sweep that ran earlier
      // would simply match nothing.
      if (previous?.status == SearchRunStatus.running &&
          next.status.isFinished) {
        ref.invalidate(newFindsCountProvider);
        // The final push has already happened by the time an exit code lands
        // here (see above), so this one is correctly timed for the whole run.
        ref.read(mirrorCatchUpProvider).request();
        // Everything else that reads channels — the list, the country filter,
        // the dashboard tiles — learns about the run from here. Announcing the
        // domains rather than naming screens is what stops this from being a
        // list that goes stale every time a screen is added; see
        // `core/events/data_change_bus.dart`.
        ref.bumpData(const {
          DataDomain.channels,
          DataDomain.videos,
          DataDomain.archive,
        });
        // Chaining the next run when the box still has pending keywords (or
        // clearing progress when it doesn't) now lives in
        // `searchAutoChainControllerProvider`, watched from `app_shell.dart`
        // regardless of which screen is open — see that class for why.
      }
    });

    // The sweep runs from `autoCleanRunnerProvider` itself now, so it happens
    // on whichever page the person is on when a run ends. This only reports it
    // when that page is this one.
    ref.listen<AutoCleanReport?>(autoCleanRunnerProvider, (previous, next) {
      if (next == null || identical(previous, next)) return;
      _reportAutoClean(next);
    });

    return Scaffold(
        appBar: GradientAppBar(
          title: Row(
            children: [
              GradientText(l10n.navSearch),
              const SizedBox(width: 20),
              // Every teammate but you, each a tap target for sending
              // keywords straight to their machine — shares the title row
              // rather than sitting in the body so it's visible above the
              // split panels below. See [SearchingNowRow] for why it lists
              // the whole roster rather than only whoever is mid-search.
              const Expanded(child: SearchingNowRow()),
            ],
          ),
          actions: const [SearchSettingsButton()],
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
          child: SafeArea(
            child: Column(
              children: [
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
                    // Width and height both come from the constraints, not from
                    // `MediaQuery`: this page sits inside the app shell, whose
                    // navigation rail eats a chunk of the window on desktop, and
                    // the `Expanded` above already turns "the rest of the page"
                    // into a fixed, finite height. That is what lets the split
                    // below hand each panel an exact size instead of a measured
                    // one — nothing here needs a second frame to lay out right,
                    // and nothing can grow past what is left, which is the whole
                    // point: this page does not scroll.
                    child: LayoutBuilder(
                      builder: (context, constraints) {
                        final sideBySide =
                            constraints.maxWidth >= _sideBySideMinWidth;
                        // Rebuilt on the count alone — see [_keywordCount] for why
                        // this is not `setState`.
                        final keywords = ValueListenableBuilder<int>(
                          valueListenable: _keywordCount,
                          builder: (context, count, _) => KeywordInput(
                            controller: _keywordsController,
                            keywordCount: count,
                            isRunning: isRunning,
                            currentKeyword: run?.currentKeyword,
                            completedCount: isRunning
                                ? run!.completedKeywords.length
                                : saved.completed.length,
                            onStartAtIndex: (index) =>
                                _startSearch(l10n, startAtIndex: index),
                          ),
                        );
                        const progress = ProgressTabsPanel();

                        if (sideBySide) {
                          final total = constraints.maxWidth;
                          final progressWidth = math.max(
                            _minPanelWidth,
                            total - _keywordsWidth(total) - _splitterWidth,
                          );
                          return Row(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              SizedBox(
                                width: progressWidth,
                                child: progress,
                              ),
                              _PanelSplitter(
                                vertical: false,
                                onDrag: (dx) => setState(() {
                                  final upper =
                                      total - _minPanelWidth - _splitterWidth;
                                  final next =
                                      (_keywordsWidth(total) - dx).clamp(
                                    _minPanelWidth,
                                    upper < _minPanelWidth
                                        ? _minPanelWidth
                                        : upper,
                                  );
                                  _keywordsFraction =
                                      (next + _splitterWidth / 2) / total;
                                }),
                              ),
                              Expanded(child: keywords),
                            ],
                          );
                        }
                        final total = constraints.maxHeight;
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            SizedBox(
                              height: math.max(
                                _minPanelHeight,
                                total - _keywordsHeight(total) - _splitterWidth,
                              ),
                              child: progress,
                            ),
                            _PanelSplitter(
                              vertical: true,
                              onDrag: (dy) => setState(() {
                                final upper =
                                    total - _minPanelHeight - _splitterWidth;
                                final next =
                                    (_keywordsHeight(total) - dy).clamp(
                                  _minPanelHeight,
                                  upper < _minPanelHeight
                                      ? _minPanelHeight
                                      : upper,
                                );
                                _keywordsHeightFraction =
                                    (next + _splitterWidth / 2) / total;
                              }),
                            ),
                            Expanded(child: keywords),
                          ],
                        );
                      },
                    ),
                  ),
                ),
                // --- Pinned bottom section: the Start button and its caveats ---
                Container(
                  decoration: BoxDecoration(
                    border: Border(
                      top: BorderSide(color: theme.colorScheme.outlineVariant),
                    ),
                  ),
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (!isRunning && saved.hasResumableProgress) ...[
                        _ResumeNotice(
                          doneCount: saved.completed.length,
                          total: saved.keywords.length,
                          nextKeyword: saved.pending.first,
                          onStartFromTop: () =>
                              _startSearch(l10n, fromTop: true),
                        ),
                        const SizedBox(height: 6),
                      ],
                      // Says whether the team's shared data has already been
                      // fetched in the background, and therefore whether Start
                      // will begin searching immediately. Sits with the button it
                      // is about, not up in the settings panel.
                      const SharedDataStatus(),
                      const SizedBox(height: 10),
                      _StartSection(
                        caps: caps,
                        isRunning: isRunning,
                        resuming: !isRunning && saved.hasResumableProgress,
                        onStart: () => _startSearch(l10n),
                        onStop: () => _stopSearch(l10n),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ));
  }
}

/// The draggable divider between the keyword box and the progress panel —
/// horizontal (dragged left/right) when the two share a row, vertical
/// (dragged up/down) when they stack on a narrow window, matching whichever
/// axis the split actually runs along.
class _PanelSplitter extends StatelessWidget {
  const _PanelSplitter({required this.vertical, required this.onDrag});

  /// True in the stacked layout, where the divider runs horizontally between
  /// two vertically-stacked panels and dragging it moves them up and down.
  final bool vertical;

  /// Called with the drag delta along the axis that matters: `dy` when
  /// [vertical], `dx` otherwise.
  final ValueChanged<double> onDrag;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return MouseRegion(
      cursor: vertical
          ? SystemMouseCursors.resizeUpDown
          : SystemMouseCursors.resizeLeftRight,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onVerticalDragUpdate:
            vertical ? (details) => onDrag(details.delta.dy) : null,
        onHorizontalDragUpdate:
            vertical ? null : (details) => onDrag(details.delta.dx),
        child: SizedBox(
          width: vertical ? double.infinity : _splitterWidth,
          height: vertical ? _splitterWidth : double.infinity,
          child: Center(
            child: Container(
              width: vertical ? 40 : 4,
              height: vertical ? 4 : 40,
              decoration: BoxDecoration(
                color: theme.colorScheme.outlineVariant,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Shown between runs when the last one did not get through the list: says
/// where Start will pick up, and offers the other option.
class _ResumeNotice extends StatelessWidget {
  const _ResumeNotice({
    required this.doneCount,
    required this.total,
    required this.nextKeyword,
    required this.onStartFromTop,
  });

  final int doneCount;
  final int total;
  final String nextKeyword;
  final VoidCallback onStartFromTop;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Row(
      children: [
        Icon(Icons.history, size: 16, color: theme.colorScheme.primary),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            l10n.searchResumeNotice(doneCount, total, nextKeyword),
            style: theme.textTheme.bodySmall,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        TextButton(
          onPressed: onStartFromTop,
          child: Text(l10n.searchStartFromTop),
        ),
      ],
    );
  }
}

/// The Start button (or Stop, mid-run), or an accurate explanation of why
/// neither is available.
///
/// The previous version showed "this is only available on the desktop app" to
/// anyone who wasn't on a native desktop build — which included people sitting
/// at a Windows PC with the app open in a browser tab. Three distinct states
/// now, each with a message that is actually true for the person reading it.
class _StartSection extends StatelessWidget {
  const _StartSection({
    required this.caps,
    required this.isRunning,
    required this.resuming,
    required this.onStart,
    required this.onStop,
  });

  final AppCapabilities caps;
  final bool isRunning;
  final bool resuming;
  final VoidCallback onStart;
  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    if (caps.canRunSearch) {
      // Stop replaces Start rather than sitting beside it: a disabled Start
      // next to a Stop is two controls for one decision, and the pinned strip
      // is the narrowest part of the page.
      if (isRunning) {
        return SizedBox(
          height: 55,
          child: FilledButton.tonalIcon(
            onPressed: onStop,
            icon: const Icon(Icons.stop),
            label: Text(l10n.searchStopButton),
          ),
        );
      }
      return SizedBox(
        height: 55,
        // The one true hero action on this screen — the three-stop gradient.
        child: GradientButton(
          onPressed: onStart,
          important: true,
          icon: Icon(resuming ? Icons.play_circle : Icons.play_arrow),
          child: Text(
            resuming ? l10n.searchResumeButton : l10n.searchStartButton,
          ),
        ),
      );
    }

    // Desktop machine, but running in a browser: the machine is fine, the
    // build can't spawn a process. Say that, rather than "get a desktop".
    final message = caps.isDesktopDevice
        ? l10n.searchInstalledAppRequired
        : l10n.desktopOnlyNotice;

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            const Icon(Icons.info_outline, size: 20),
            const SizedBox(width: 8),
            Expanded(
              child:
                  Text(message, style: Theme.of(context).textTheme.bodySmall),
            ),
          ],
        ),
      ),
    );
  }
}
