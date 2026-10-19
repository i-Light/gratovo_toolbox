import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/features/search/application/video_catchup_controller.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/run_status_dot.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// What the background video catch-up is doing, in words.
///
/// The job itself is old; being able to see it is not. It starts eight seconds
/// after the app opens, works up to three thousand channels, and can hold the
/// pipeline for the better part of an hour — and until this panel existed the
/// only trace of it anywhere in the UI was an accident. It opens a row in
/// `store.py`'s `runs` table, the Search page reads the newest such row, and so
/// an unattended maintenance sweep was drawn as a *search* that had somehow
/// found no channels and a rising number of videos, on a page nobody had
/// pressed Start on. `LocalSearchRepository.getCurrentRun` now ignores every
/// run that is not a keyword search, which leaves this as the one thing that
/// speaks for the sweep — so it has to say what the job is, not merely that
/// something is happening.
///
/// This is the "Video catch-up" tab body inside `ProgressTabsPanel` — the tab
/// itself only exists once a pass has actually started this session, the same
/// way the backfill and re-enrich tabs (`ChannelRunProgressPanel`) do.
class VideoCatchUpPanel extends ConsumerStatefulWidget {
  const VideoCatchUpPanel({super.key});

  @override
  ConsumerState<VideoCatchUpPanel> createState() => _VideoCatchUpPanelState();
}

class _VideoCatchUpPanelState extends ConsumerState<VideoCatchUpPanel> {
  /// Drives the elapsed label only — same arrangement, and the same reason, as
  /// the other progress panels on this page.
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
    final state = ref.watch(videoCatchUpControllerProvider);
    // A pass that finished having found nothing to do (an empty backlog) has
    // nothing worth reporting — showing the panel just to say "Nothing left
    // to fill in" turns a non-event into something that looks like it needs
    // reading.
    final nothingToReport =
        state.status == VideoCatchUpStatus.done && state.channelsDone == 0;
    if (!state.hasProgressToShow || nothingToReport) {
      _syncTicker(false);
      return const SizedBox.shrink();
    }
    _syncTicker(state.isRunning);

    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              RunStatusDot(switch (state.status) {
                VideoCatchUpStatus.running => RunDotState.running,
                VideoCatchUpStatus.done => RunDotState.done,
                // Stepping aside for a search is the job working as intended,
                // and it happens every time anybody presses Start.
                VideoCatchUpStatus.paused => RunDotState.paused,
                VideoCatchUpStatus.failed => RunDotState.failed,
                VideoCatchUpStatus.idle ||
                VideoCatchUpStatus.unavailable =>
                  RunDotState.idle,
              }),
              const SizedBox(width: 8),
              const Spacer(),
              if (state.isRunning)
                Text(
                  _elapsed(state.startedAt!),
                  style: muted?.copyWith(
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          // The sentence this whole panel exists for. It stays put in every
          // state, including the finished ones: somebody reading "filled in
          // 900 channels" a minute afterwards is exactly the person who
          // still needs telling what was filled in, and why.
          Text(l10n.videoCatchUpWhat, style: muted),
          const SizedBox(height: 12),
          Text(_headline(l10n, state), style: theme.textTheme.bodyMedium),
          if (state.isRunning) ...[
            const SizedBox(height: 8),
            // Two layers on one track, because each channel is handled in
            // two steps a while apart: its upload list is read (scrapetube,
            // no quota), then — batched across channels — that list's
            // metadata is fetched from the YouTube API. The lighter fill is
            // how far the read has got, the solid fill how far the fetch
            // behind it has. Both are null until the first `[catchup]` line
            // gives a denominator, which renders as one indeterminate bar —
            // honest, where a bar pinned at zero would read as stuck.
            _TwoLayerProgressBar(
              reading: state.readingUploadsFraction,
              fetched: state.fraction,
            ),
            const SizedBox(height: 6),
            _ProgressLegend(
              reading: l10n.videoCatchUpLayerReading,
              fetched: l10n.videoCatchUpLayerFetching,
            ),
            // A rough rate and time-to-finish, once enough of the pass has
            // run for either to be steady. This job is genuinely slow —
            // thousands of channels, each paced — and a number that says
            // "about four hours" is far kinder than a bar that just
            // crawls with no end in sight.
            if (_projection(state) case final proj?) ...[
              const SizedBox(height: 8),
              Text(l10n.videoCatchUpEta(proj.rate, proj.timeLeft),
                  style: muted),
            ],
            // What the sweep is on this second: the channel being read,
            // or — between batches — the upload of what it just finished.
            // The second is its own line because it was once nothing at
            // all: the panel kept the last handle up through a share of
            // thousands of objects, and read as a sweep stuck on that one
            // channel for twenty minutes.
            if (state.isSharing) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(Icons.cloud_upload_outlined,
                      size: 16, color: theme.colorScheme.onSurfaceVariant),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      l10n.videoCatchUpSharing(
                        formatCount(state.sharedObjects ?? 0),
                        formatCount(state.sharingTotal),
                      ),
                      style: muted,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ] else if (state.currentHandle != null) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(Icons.chevron_right,
                      size: 16, color: theme.colorScheme.onSurfaceVariant),
                  const SizedBox(width: 2),
                  Expanded(
                    child: Text(
                      l10n.videoCatchUpCurrentChannel(state.currentHandle!),
                      style: muted,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 10),
            // The direct answer to "why does this keep starting over?" —
            // it does not, any more. `backfill_missing_videos` stamps each
            // channel as it finishes, so a restart or a search resumes
            // from here rather than from zero.
            Text(l10n.videoCatchUpResumeNote,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                )),
          ],
        ],
      ),
    );
  }

  /// The one line that says where the sweep is. The running branch counts
  /// channels rather than videos (a rising video count with no denominator was
  /// the whole of what the old accidental rendering showed) and leads with the
  /// two figures that move every channel — read, then saved behind it — rather
  /// than `channelsDone`, which only jumps once per outer batch.
  String _headline(AppLocalizations l10n, VideoCatchUpState state) {
    return switch (state.status) {
      VideoCatchUpStatus.running => state.backlogTotal == null
          ? l10n.videoCatchUpStarting
          : l10n.videoCatchUpProgress(
              formatCount(state.channelsRead),
              formatCount(state.channelsSaved),
              formatCount(state.backlogTotal),
            ),
      VideoCatchUpStatus.paused => l10n.videoCatchUpPaused(state.channelsDone),
      VideoCatchUpStatus.done => l10n.videoCatchUpDone(state.channelsDone),
      VideoCatchUpStatus.failed => l10n.videoCatchUpFailed,
      // Neither reaches here — `hasProgressToShow` is false for both.
      VideoCatchUpStatus.idle ||
      VideoCatchUpStatus.unavailable =>
        l10n.videoCatchUpStarting,
    };
  }

  /// A rough "N channels/min" and a "4h 10m"-style span to finish, or null
  /// until the pass has run far enough for both to be steady. Time-dependent,
  /// so it lives here rather than on the state and is recomputed every second
  /// by the same ticker that drives [_elapsed].
  ({String rate, String timeLeft})? _projection(VideoCatchUpState state) {
    final total = state.backlogTotal;
    if (total == null || state.startedAt == null) return null;
    final read = state.channelsRead;
    // Reading time only. A share between batches reads no channels, and a
    // long one (see `VideoCatchUpState.sharedObjects`) would otherwise drag
    // "50 channels in a minute" down to "5 channels/min · about 1h left".
    final elapsed = state.readingElapsed(DateTime.now());
    // Below ~30 channels or ~20s in, the average is all startup and any
    // figure shown would just jump around.
    if (read < 30 || elapsed.inSeconds < 20) return null;
    final left = total - read;
    if (left <= 0) return null;
    final perChannelMs = elapsed.inMilliseconds / read;
    final perMinute = (60000 / perChannelMs).round();
    if (perMinute <= 0) return null;
    final remaining = Duration(milliseconds: (perChannelMs * left).round());
    return (
      rate: formatCount(perMinute),
      timeLeft: _humanizeDuration(remaining)
    );
  }

  /// `Duration` -> `"4h 10m"` / `"35m"` / `"1m"`. Deliberately coarse: this is
  /// an estimate on a job measured in hours, and a seconds field would imply a
  /// precision it does not have.
  String _humanizeDuration(Duration d) {
    final minutes = d.inMinutes < 1 ? 1 : d.inMinutes;
    if (minutes < 60) return '${minutes}m';
    return '${minutes ~/ 60}h ${minutes % 60}m';
  }

  String _elapsed(DateTime startedAt) {
    final elapsed = DateTime.now().difference(startedAt);
    final hours = elapsed.inHours;
    final minutes = elapsed.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = elapsed.inSeconds.remainder(60).toString().padLeft(2, '0');
    return hours > 0 ? '$hours:$minutes:$seconds' : '$minutes:$seconds';
  }
}

/// One 6px track carrying two fills: [reading] (the lighter, wider one — how
/// far the sweep has got through *reading* channels' upload lists) with
/// [fetched] (the solid one — how many of those channels' videos have actually
/// been fetched and saved) drawn on top of it. [fetched] can only ever trail
/// [reading], so the pair reads as a solid head chasing a translucent one.
///
/// Both null means no denominator yet (the first `[catchup]` line has not
/// arrived), and the honest rendering of that is a single indeterminate bar
/// rather than an empty track that looks stuck.
class _TwoLayerProgressBar extends StatelessWidget {
  const _TwoLayerProgressBar({required this.reading, required this.fetched});

  final double? reading;
  final double? fetched;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final track = scheme.surfaceContainerHighest;

    return ClipRRect(
      borderRadius: BorderRadius.circular(3),
      child: SizedBox(
        height: 6,
        width: double.infinity,
        child: fetched == null
            ? LinearProgressIndicator(
                minHeight: 6,
                backgroundColor: track,
              )
            : Stack(
                fit: StackFit.expand,
                children: [
                  ColoredBox(color: track),
                  // Aligned to the *start*, not the left, so the fills grow
                  // the right way under Arabic. `heightFactor: 1` so the fill
                  // is handed a tight full-height box: a childless `ColoredBox`
                  // sizes to `constraints.smallest`, and without it the loose
                  // height constraint here collapses that to zero and nothing
                  // paints.
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: FractionallySizedBox(
                      widthFactor: (reading ?? 0).clamp(0.0, 1.0),
                      heightFactor: 1,
                      child: ColoredBox(
                        color: scheme.primary.withValues(alpha: 0.30),
                      ),
                    ),
                  ),
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: FractionallySizedBox(
                      widthFactor: fetched!.clamp(0.0, 1.0),
                      heightFactor: 1,
                      child: ColoredBox(color: scheme.primary),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

/// The two-word key to [_TwoLayerProgressBar]'s colors, small and muted — a
/// swatch the same translucent/solid primary as the bar, then its label.
class _ProgressLegend extends StatelessWidget {
  const _ProgressLegend({required this.reading, required this.fetched});

  final String reading;
  final String fetched;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final style = theme.textTheme.labelSmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return Row(
      children: [
        _swatch(theme.colorScheme.primary.withValues(alpha: 0.30)),
        const SizedBox(width: 4),
        Text(reading, style: style),
        const SizedBox(width: 12),
        _swatch(theme.colorScheme.primary),
        const SizedBox(width: 4),
        Text(fetched, style: style),
      ],
    );
  }

  Widget _swatch(Color color) => Container(
        width: 8,
        height: 8,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(2),
        ),
      );
}
