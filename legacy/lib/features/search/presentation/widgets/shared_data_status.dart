import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/features/search/application/pipeline_warmup_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// One quiet line above the Start button saying whether the team's shared data
/// has already been fetched.
///
/// It exists because the work it reports on became invisible. Downloading the
/// team's rows used to be the first thing a search did, and the fifty seconds
/// it took were plainly (if unhelpfully) visible as "Starting the pipeline...".
/// It happens in the background now (`pipeline_warmup_controller.dart`), and
/// something has to say so — otherwise a machine where the pull quietly fails
/// every time would show teammates' finds going stale with nothing anywhere
/// explaining why.
///
/// Deliberately not an error surface. Every state here is one a search works
/// in: the worst of them costs a few seconds while the run fetches the channel
/// rows itself, which used to be a minute and is the whole point of the
/// change.
class SharedDataStatus extends ConsumerStatefulWidget {
  const SharedDataStatus({super.key});

  @override
  ConsumerState<SharedDataStatus> createState() => _SharedDataStatusState();
}

class _SharedDataStatusState extends ConsumerState<SharedDataStatus> {
  /// Repaints the "updated N min ago" label as N changes — an age is only
  /// worth showing if it is the real one. One rebuild of one small row a
  /// minute.
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    // Opening this page is the strongest signal anyone is about to search, so
    // it is the right moment to top up a pull that has gone stale — the run
    // itself will not do it. A no-op when one is fresh or already running.
    // Short delay: nothing here needs to compete with the page's first frame.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref
          .read(pipelineWarmupProvider.notifier)
          .warmInBackground(delay: const Duration(milliseconds: 300));
    });
    _tick = Timer.periodic(
      const Duration(minutes: 1),
      (_) {
        if (mounted) setState(() {});
      },
    );
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final warmup = ref.watch(pipelineWarmupProvider);

    // Nothing to report on a build that cannot run the pipeline at all.
    if (warmup.status == PipelineWarmupStatus.unavailable) {
      return const SizedBox.shrink();
    }

    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );

    final (Widget icon, String message) = switch (warmup.status) {
      PipelineWarmupStatus.running => (
          SizedBox(
            width: 12,
            height: 12,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: theme.colorScheme.primary,
            ),
          ),
          // The pull's own words while it has any: a first sync's
          // "Downloading the team's channels (400 of 18960)..." is the
          // difference between a wait somebody sits through and one they
          // kill the app over.
          warmup.step ?? l10n.searchWarmupRunning,
        ),
      // The age is shown whether or not it is inside the refresh window. What
      // the window decides is when the *next background pull* happens, and
      // nobody needs telling that; when the team's data was last updated is
      // the fact somebody might actually act on.
      PipelineWarmupStatus.ready => (
          Icon(Icons.cloud_done_outlined,
              size: 14, color: theme.colorScheme.primary),
          _readyMessage(l10n, warmup.age),
        ),
      PipelineWarmupStatus.failed => (
          Icon(Icons.cloud_off_outlined,
              size: 14, color: theme.colorScheme.onSurfaceVariant),
          l10n.searchWarmupFailed,
        ),
      // Nothing tried yet this session — the background pull is still on its
      // way. Says what will happen rather than leaving a blank.
      _ => (
          Icon(Icons.cloud_queue_outlined,
              size: 14, color: theme.colorScheme.onSurfaceVariant),
          l10n.searchWarmupStale,
        ),
    };

    return Tooltip(
      // The failure detail belongs here rather than in the line itself —
      // "python is not recognised as a command" is the answer somebody needs
      // exactly once, and clutter every other time.
      message: warmup.error ?? '',
      child: Row(
        children: [
          icon,
          const SizedBox(width: 8),
          Expanded(child: Text(message, style: muted)),
          if (!warmup.isRunning)
            TextButton(
              onPressed: () => ref
                  .read(pipelineWarmupProvider.notifier)
                  .refresh(force: true),
              style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: Text(l10n.searchWarmupRefresh),
            ),
        ],
      ),
    );
  }

  /// "up to date" for the first minute, then an honest age.
  String _readyMessage(AppLocalizations l10n, Duration? age) {
    final minutes = age?.inMinutes ?? 0;
    return minutes < 1
        ? l10n.searchWarmupReady
        : l10n.searchWarmupReadyAge(minutes);
  }
}
