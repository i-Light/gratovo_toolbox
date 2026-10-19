import 'package:gratovo_toolbox/core/sync/pipeline_bridge.dart';

/// Web: there is no pipeline. Never constructed in practice, because
/// `openSyncEngine` is also a stub there and returns null before this is
/// ever handed to it.
class ProcessPipelineBridge implements PipelineBridge {
  const ProcessPipelineBridge();

  @override
  Future<PipelinePullOutcome> pullShared({bool force = false}) async =>
      const PipelinePullOutcome(ran: false, succeeded: false);

  @override
  Future<void> archiveChannels(List<Map<String, Object?>> entries) async {
    throw PipelineBridgeException('No pipeline on this platform.');
  }

  @override
  Future<void> restoreChannels(List<String> channelIds) async {
    throw PipelineBridgeException('No pipeline on this platform.');
  }
}
