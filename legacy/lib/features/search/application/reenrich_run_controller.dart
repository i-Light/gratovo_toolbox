import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/data/models/channel_run.dart';
import 'package:gratovo_toolbox/features/search/application/backfill_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/channel_run_controller.dart';

/// The "free this channel from the archive and re-enrich it" run started
/// from the Archive page: `search.py --refetch <handle>`, the ordinary
/// discovery fetch (channel metadata + the recent uploads window) for one
/// channel. Everything about running it lives in [ChannelRunNotifier].
///
/// The caller (the Archive page's "free" action) turns the [StateError] a
/// busy pipeline raises into a "the pipeline is busy" snackbar and leaves the
/// channel in the archive so the action stays retryable.
class ReenrichRunNotifier extends ChannelRunNotifier {
  Future<void> run({required String handle}) {
    return launch(
      kind: ChannelRunKind.reenrich,
      handle: handle,
      otherJobRunning:
          ref.read(backfillRunControllerProvider.notifier).isRunning,
      start: (pythonExecutable, paths) => ScraperProcess.reenrichHandleStreamed(
        pythonExecutable: pythonExecutable,
        paths: paths,
        handle: handle,
      ),
    );
  }

  @override
  void didFinish(ChannelRun run, {required bool succeeded}) {
    if (succeeded) {
      bump(const {
        DataDomain.channels,
        DataDomain.videos,
        DataDomain.archive,
        DataDomain.activity,
      });
    }
  }
}

final reenrichRunControllerProvider =
    NotifierProvider<ReenrichRunNotifier, ChannelRun?>(
  ReenrichRunNotifier.new,
);
