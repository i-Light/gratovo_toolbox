import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/core/native/video_stats_protocol.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';

/// Reads one YouTube video's current views, for a deliverable's 30-day
/// report. Behind a provider so tests answer without Python or the network.
abstract class VideoStatsGateway {
  Future<VideoStatsResult> fetch(String video);
}

/// Runs `tools/video_stats.py` in this machine's pipeline folder.
class PipelineVideoStatsGateway implements VideoStatsGateway {
  PipelineVideoStatsGateway(this._ref);

  final Ref _ref;

  @override
  Future<VideoStatsResult> fetch(String video) async {
    final env = _ref.read(pythonEnvironmentProvider);
    final override = env.projectRootOverride.trim();
    final paths = ScraperProcess.resolvePaths(
      projectRootOverride: override.isEmpty ? null : override,
    );
    if (paths == null) {
      return const VideoStatsResult.failure(VideoStatsError(
        code: 'unavailable',
        message: 'There is no local pipeline on this machine to ask YouTube.',
      ));
    }
    try {
      final result = await ScraperProcess.videoStats(
        pythonExecutable: env.pythonExecutable,
        paths: paths,
        video: video,
      );
      return parseVideoStats(result.output);
    } on Object catch (error) {
      return VideoStatsResult.failure(
        VideoStatsError(code: 'unavailable', message: '$error'),
      );
    }
  }
}

final videoStatsGatewayProvider =
    Provider<VideoStatsGateway>(PipelineVideoStatsGateway.new);
