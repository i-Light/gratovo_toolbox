import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/sync/sync_providers.dart';

/// How long the updater will wait for replication to finish before it stops
/// waiting and asks the user instead. Long enough for a normal outbox drain,
/// short enough that a wedged sync doesn't mean the Update button never does
/// anything.
const kUpdateSyncDrainTimeout = Duration(seconds: 45);

/// Whether it is safe to quit right now.
///
/// Restarting mid-replication is how edits made offline get lost: the outbox
/// is a queue on this machine, and a process that goes away with rows still
/// in it takes them with it if anything about the new build reads that queue
/// differently. So the updater drains before it quits, rather than trusting a
/// fixed pause to have been long enough.
abstract class UpdateSyncGate {
  /// Pushes anything queued, then waits for the engine to go idle. True when
  /// it did, false when [timeout] ran out with work still in flight — which
  /// is the caller's cue to ask the user rather than to quit anyway.
  Future<bool> drain({Duration timeout});
}

/// The real gate: asks the sync engine to run a final pass, then watches its
/// status until nothing is uploading or downloading.
class SyncEngineUpdateGate implements UpdateSyncGate {
  const SyncEngineUpdateGate(this._ref);

  final Ref _ref;

  @override
  Future<bool> drain({Duration timeout = kUpdateSyncDrainTimeout}) async {
    final engine = _ref.read(syncEngineProvider);
    // No engine means nothing to lose: signed out, web, or a machine with the
    // local mirror switched off.
    if (engine == null) return true;

    final deadline = DateTime.now().add(timeout);
    try {
      // `syncNow` rather than `catchUp`: this is a person pressing Update, and
      // it is the last chance this build gets to push what is queued.
      await engine.syncNow().timeout(timeout);
    } catch (error) {
      // A failed final pass is not a reason to refuse to update — it usually
      // means offline, and the outbox survives on disk either way. Fall
      // through to the idle check so a wedged *in-flight* pass is still
      // caught.
      developer.log(
        'Final sync before update did not complete; checking whether anything '
        'is still in flight.',
        name: 'gratovo.update',
        level: 800,
        error: error,
      );
    }

    while (DateTime.now().isBefore(deadline)) {
      final status = engine.status;
      if (!status.uploading && !status.downloading) return true;
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }
    return false;
  }
}

final updateSyncGateProvider = Provider<UpdateSyncGate>(
  SyncEngineUpdateGate.new,
);
