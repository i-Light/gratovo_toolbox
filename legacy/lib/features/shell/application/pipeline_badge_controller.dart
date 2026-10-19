import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/channel_run.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/backfill_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/reenrich_run_controller.dart';

/// What the Search nav icon's badge should show — a search run, a backfill
/// run and an archive re-enrich are the jobs it reports on, combined into one
/// dot because from the nav rail all that matters is "is something happening,
/// or did something need attention", not which of them it was.
enum PipelineBadgeStatus {
  /// Nothing running, nothing unacknowledged.
  none,

  /// A search or a backfill is in flight right now.
  running,

  /// The last one of either to finish ended cleanly, and hasn't been seen yet.
  success,

  /// The last one of either to finish failed, and hasn't been seen yet.
  error,
}

/// Tracks [PipelineBadgeStatus] across both `ActiveSearchRunNotifier` and
/// `BackfillRunNotifier` — the two long-running pipeline jobs the app can
/// have going, launched from two different pages (Search itself, and any
/// Influencer Profile).
///
/// This is deliberately its own tiny notifier rather than a `Provider` that
/// just combines the two: "running" is a pure function of their current
/// state and could be derived on the fly, but "finished successfully" and
/// "finished with an error" are *events* — the moment a run's status flips
/// from running to something else — and that moment has already passed by
/// the time anyone reads the two controllers' state again. Something has to
/// catch it as it happens and hold onto it until [acknowledge] is called,
/// which is exactly what `NewsBadgeNotifier` (news_badge_controller.dart)
/// does for the News icon's count. Held alive from `AppShell` the same way
/// `autoCleanRunnerProvider` is, so a run started from a page other than
/// Search still updates the icon everyone sees regardless of which page is
/// open — see `active_search_run_controller.dart`'s and
/// `backfill_run_controller.dart`'s own doc comments for why those two are
/// global in the first place.
class PipelineBadgeNotifier extends Notifier<PipelineBadgeStatus> {
  @override
  PipelineBadgeStatus build() {
    ref.listen<SearchRun?>(activeSearchRunControllerProvider, (previous, next) {
      _onTransition(
        wasRunning: previous?.status == SearchRunStatus.running,
        isRunning: next?.status == SearchRunStatus.running,
        failed: next?.status == SearchRunStatus.failed,
      );
    });
    ref.listen<ChannelRun?>(backfillRunControllerProvider, (previous, next) {
      _onTransition(
        wasRunning: previous?.status == ChannelRunStatus.running,
        isRunning: next?.status == ChannelRunStatus.running,
        failed: next?.status == ChannelRunStatus.failed,
      );
    });
    ref.listen<ChannelRun?>(reenrichRunControllerProvider, (previous, next) {
      _onTransition(
        wasRunning: previous?.status == ChannelRunStatus.running,
        isRunning: next?.status == ChannelRunStatus.running,
        failed: next?.status == ChannelRunStatus.failed,
      );
    });
    return PipelineBadgeStatus.none;
  }

  void _onTransition({
    required bool wasRunning,
    required bool isRunning,
    required bool failed,
  }) {
    if (isRunning) {
      state = PipelineBadgeStatus.running;
      return;
    }
    if (!wasRunning) return; // Not a "just finished" transition.

    // A run finishing while the other kind is still going must not overwrite
    // "running" with the finished one's outcome — the icon should keep
    // reading "something is happening" until *everything* is done.
    if (_otherIsRunning()) return;
    state = failed ? PipelineBadgeStatus.error : PipelineBadgeStatus.success;
  }

  bool _otherIsRunning() =>
      ref.read(activeSearchRunControllerProvider)?.status ==
          SearchRunStatus.running ||
      ref.read(backfillRunControllerProvider)?.status ==
          ChannelRunStatus.running ||
      ref.read(reenrichRunControllerProvider)?.status ==
          ChannelRunStatus.running;

  /// Called when the person actually looks at the Search page — see
  /// `AppShell._onDestinationSelected`. Only clears a *finished* outcome;
  /// calling it mid-run is a no-op; the icon should keep announcing that
  /// until the run itself ends.
  void acknowledge() {
    if (state == PipelineBadgeStatus.running) return;
    state = PipelineBadgeStatus.none;
  }
}

final pipelineBadgeProvider =
    NotifierProvider<PipelineBadgeNotifier, PipelineBadgeStatus>(
  PipelineBadgeNotifier.new,
);
