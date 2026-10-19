/// How the sync engine reaches the Python pipeline, with no mention of how.
///
/// Everything scraped is shared through R2 by the pipeline and only by the
/// pipeline (`pipeline/gratovo/sync.py`): it holds the bucket keys, the zstd
/// codec and the catalog logic, and the app never talks to the bucket itself.
/// So the three things the app needs from the bucket — "pull what the team
/// found", "archive these channels", "bring these back" — are requests to
/// run `search.py` with the right flags. This interface is that request, and
/// `core/native/pipeline_bridge_io.dart` is the one that actually spawns a
/// process. The engine and the uploader depend on this file only, which is
/// what keeps them unit-testable with a fake.
library;

/// What one `search.py --pull-only` came back with.
class PipelinePullOutcome {
  const PipelinePullOutcome({
    required this.ran,
    required this.succeeded,
    this.output = '',
  });

  /// False when the pipeline could not be found on this machine at all (no
  /// interpreter, no `pipeline/` folder) — not a failure of the pull, just
  /// nothing to run. The engine reports it once and stops asking.
  final bool ran;
  final bool succeeded;
  final String output;
}

/// Raised by [PipelineBridge.archiveChannels] and
/// [PipelineBridge.restoreChannels] when the process ran and refused, so the
/// uploader can leave the entry queued and try again next pass.
class PipelineBridgeException implements Exception {
  PipelineBridgeException(this.message);

  final String message;

  @override
  String toString() => message;
}

abstract class PipelineBridge {
  /// `search.py --pull-only`: apply the catalog, download missing objects.
  /// Never throws; the outcome says what happened.
  Future<PipelinePullOutcome> pullShared({bool force = false});

  /// `search.py --archive-ids`: tombstone locally (already done by the
  /// repository for this machine's own rows — the pipeline's write is
  /// idempotent), delete the objects, announce it. [entries] is a list of
  /// `{channel_id, label}`.
  Future<void> archiveChannels(List<Map<String, Object?>> entries);

  /// `search.py --unarchive-ids`.
  Future<void> restoreChannels(List<String> channelIds);
}
