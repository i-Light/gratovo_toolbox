import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/channel_run.dart';
import 'package:gratovo_toolbox/features/search/application/channel_run_controller.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/run_status_dot.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The live progress of the current (or most recent) single-channel run
/// watched through [provider] — a backfill ("pull more videos" from an
/// Influencer Profile) or a re-enrich ("free this channel" from the Archive).
///
/// Sits on the Search page rather than the page it was started from: see
/// `ChannelRunNotifier`'s doc comment for why the run itself is global. This
/// is the tab body inside `ProgressTabsPanel` — the tab itself only exists
/// once a run has actually been started this session (see that class), so
/// unlike [SearchProgressPanel] this never has to render an empty state.
class ChannelRunProgressPanel extends ConsumerStatefulWidget {
  const ChannelRunProgressPanel({super.key, required this.provider});

  final NotifierProvider<ChannelRunNotifier, ChannelRun?> provider;

  @override
  ConsumerState<ChannelRunProgressPanel> createState() =>
      _ChannelRunProgressPanelState();
}

class _ChannelRunProgressPanelState
    extends ConsumerState<ChannelRunProgressPanel> {
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
    final run = ref.watch(widget.provider);
    if (run == null) {
      _syncTicker(false);
      return const SizedBox.shrink();
    }
    final l10n = AppLocalizations.of(context);
    _syncTicker(run.status == ChannelRunStatus.running);

    return Padding(
      padding: const EdgeInsets.all(16),
      child: _RunBody(run: run, l10n: l10n),
    );
  }
}

class _RunBody extends StatelessWidget {
  const _RunBody({required this.run, required this.l10n});

  final ChannelRun run;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final running = run.status == ChannelRunStatus.running;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            RunStatusDot(switch (run.status) {
              ChannelRunStatus.running => RunDotState.running,
              ChannelRunStatus.completed => RunDotState.done,
              ChannelRunStatus.failed => RunDotState.failed,
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
            if (running)
              Text(
                _elapsed(),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
          ],
        ),
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
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ],
        // Same reasoning as SearchProgressPanel's log: fixed-height and
        // lazily built, so a channel that needed a few hundred lines to
        // widen its window does not lay every one of them out on every
        // rebuild.
        if (run.logLines.isNotEmpty) ...[
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            height: 180,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(8),
            ),
            child: ListView.builder(
              padding: EdgeInsets.zero,
              reverse: true,
              itemCount: run.logLines.length,
              itemBuilder: (context, index) => Text(
                run.logLines[run.logLines.length - 1 - index],
                style: theme.textTheme.bodySmall
                    ?.copyWith(fontFamily: 'monospace'),
              ),
            ),
          ),
        ],
      ],
    );
  }

  String _headline() {
    return switch ((run.kind, run.status)) {
      (ChannelRunKind.backfill, ChannelRunStatus.running) =>
        l10n.backfillProgressRunning(run.handle),
      (ChannelRunKind.backfill, ChannelRunStatus.completed) =>
        l10n.backfillProgressCompleted(run.videosAdded ?? 0, run.handle),
      (ChannelRunKind.backfill, ChannelRunStatus.failed) =>
        l10n.backfillProgressFailed(run.handle),
      (ChannelRunKind.reenrich, ChannelRunStatus.running) =>
        l10n.reenrichProgressRunning(run.handle),
      (ChannelRunKind.reenrich, ChannelRunStatus.completed) =>
        l10n.reenrichProgressCompleted(run.handle),
      (ChannelRunKind.reenrich, ChannelRunStatus.failed) =>
        l10n.reenrichProgressFailed(run.handle),
    };
  }

  String _elapsed() {
    final elapsed = DateTime.now().difference(run.startedAt);
    final hours = elapsed.inHours;
    final minutes = elapsed.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = elapsed.inSeconds.remainder(60).toString().padLeft(2, '0');
    return hours > 0 ? '$hours:$minutes:$seconds' : '$minutes:$seconds';
  }
}
