import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/logging/activity_logger.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/data/models/channel_run.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/features/search/application/channel_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/reenrich_run_controller.dart';

/// The "pull more videos" run started from an Influencer Profile:
/// `tools/enrich.py --only backfill`, which walks the channel's older uploads
/// back `months` and then fetches their stats within the API-call budget.
/// Everything about running it lives in [ChannelRunNotifier].
class BackfillRunNotifier extends ChannelRunNotifier {
  /// Held only for the activity log entry the run leaves behind — `enrich.py`
  /// only ever sees a handle, but the log wants the influencer's id too.
  Influencer? _influencer;

  Future<void> runBackfill({
    required Influencer influencer,
    required int months,
    int maxApiCalls = 20,
  }) {
    _influencer = influencer;
    return launch(
      kind: ChannelRunKind.backfill,
      handle: influencer.handle,
      months: months,
      otherJobRunning:
          ref.read(reenrichRunControllerProvider.notifier).isRunning,
      start: (pythonExecutable, paths) => ScraperProcess.backfillChannelVideos(
        pythonExecutable: pythonExecutable,
        paths: paths,
        handle: influencer.handle,
        months: months,
        maxApiCalls: maxApiCalls,
      ),
    );
  }

  @override
  void didFinish(ChannelRun run, {required bool succeeded}) {
    final influencer = _influencer;
    if (influencer != null) {
      ref.read(activityLoggerProvider).videosPulled(
            influencer,
            months: run.months ?? 0,
            succeeded: succeeded,
          );
    }
    if (succeeded) {
      bump(const {
        DataDomain.videos,
        DataDomain.channels,
        DataDomain.activity,
      });
    }
  }
}

final backfillRunControllerProvider =
    NotifierProvider<BackfillRunNotifier, ChannelRun?>(
  BackfillRunNotifier.new,
);
