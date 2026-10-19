import 'dart:developer' as developer;

import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/core/sync/pipeline_bridge.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';

/// The [PipelineBridge] that actually runs `search.py`.
///
/// Reads the Python interpreter and project-root settings fresh on every call
/// rather than once at construction: they are per-machine settings a person
/// can change in Settings while the app runs, and the engine that holds this
/// bridge outlives that.
class ProcessPipelineBridge implements PipelineBridge {
  const ProcessPipelineBridge();

  Future<(String, ScraperProcessPaths)?> _resolve() async {
    final env = await readPersistedPythonEnvironment();
    final override = env.projectRootOverride.trim();
    final paths = ScraperProcess.resolvePaths(
      projectRootOverride: override.isEmpty ? null : override,
    );
    if (paths == null) return null;
    return (env.pythonExecutable, paths);
  }

  @override
  Future<PipelinePullOutcome> pullShared({bool force = false}) async {
    final resolved = await _resolve();
    if (resolved == null) {
      return const PipelinePullOutcome(ran: false, succeeded: false);
    }
    final (python, paths) = resolved;
    try {
      final result = await ScraperProcess.pullSharedState(
        pythonExecutable: python,
        paths: paths,
        force: force,
      );
      return PipelinePullOutcome(
        ran: true,
        succeeded: result.succeeded,
        output: result.output,
      );
    } catch (error, stackTrace) {
      // A missing interpreter or an unreadable pipeline folder. Reported as a
      // pull that ran and failed, so it shows in the sync card, rather than as
      // "no pipeline here", which would stop the engine asking again.
      developer.log(
        'search.py --pull-only could not be started.',
        name: 'gratovo.sync.pipeline',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
      return PipelinePullOutcome(ran: true, succeeded: false, output: '$error');
    }
  }

  @override
  Future<void> archiveChannels(List<Map<String, Object?>> entries) async {
    final resolved = await _resolve();
    if (resolved == null) {
      throw PipelineBridgeException(
        'The Python pipeline is not available on this machine, so the archive '
        'cannot be shared yet.',
      );
    }
    final (python, paths) = resolved;
    final result = await ScraperProcess.archiveChannels(
      pythonExecutable: python,
      paths: paths,
      entries: entries,
    );
    if (!result.succeeded) {
      throw PipelineBridgeException(
        'search.py --archive-ids exited ${result.exitCode}: '
        '${_tail(result.output)}',
      );
    }
  }

  @override
  Future<void> restoreChannels(List<String> channelIds) async {
    final resolved = await _resolve();
    if (resolved == null) {
      throw PipelineBridgeException(
        'The Python pipeline is not available on this machine, so the '
        'un-archive cannot be shared yet.',
      );
    }
    final (python, paths) = resolved;
    final result = await ScraperProcess.restoreChannels(
      pythonExecutable: python,
      paths: paths,
      channelIds: channelIds,
    );
    if (!result.succeeded) {
      throw PipelineBridgeException(
        'search.py --unarchive-ids exited ${result.exitCode}: '
        '${_tail(result.output)}',
      );
    }
  }

  static String _tail(String output) {
    final lines = output.trim().split('\n');
    return lines.length <= 3
        ? output.trim()
        : lines.sublist(lines.length - 3).join('\n');
  }
}
