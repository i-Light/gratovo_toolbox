import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/native/pending_merge_boot.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/client_merge_status.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';

/// This machine's quarantined databases — the files a shipped `reset_manifest.json`
/// action moved into `data/database/_needs_merge/` instead of deleting (see
/// `lib/core/native/pipeline_reset.dart`).
///
/// Reads the on-disk `index.json` (empty on web and on a machine nothing has
/// been set aside on). Whenever it loads or changes and there is a session, it
/// pushes the unresolved count and paths to `public.client_merge_status` so the
/// team board in Settings shows who still has work to do.
class LocalMergeQuarantineController
    extends AsyncNotifier<MergeQuarantineIndex> {
  ScraperProcessPaths? _paths;

  @override
  Future<MergeQuarantineIndex> build() async {
    // Re-read disk when a realtime push bumps this domain. The local list only
    // really changes on a resolve here or a reset on the next launch, but a
    // re-read is cheap and keeps the two views from drifting.
    ref.watch(dataRevisionProvider(DataDomain.mergeStatus));
    // Also re-run when the session appears: the app may have started signed
    // out (so the boot-time publish below was skipped), and signing in is when
    // this machine's count first needs to reach the team board.
    ref.watch(currentSessionProvider);

    final paths = _paths ??= ScraperProcess.resolvePaths();
    if (paths == null) {
      // Web, or no pipeline on this platform. The boot index is already empty
      // here; nothing local to show.
      return ref.read(pendingMergeBootProvider);
    }

    final index = await PipelineDataDir.readQuarantineIndex(paths);
    unawaited(_publish(index));
    return index;
  }

  /// Mark one set-aside file dealt with. [deleteFile] removes the quarantined
  /// copy from disk; false keeps it (the person merged from it and wants it
  /// kept, or is not sure yet).
  Future<void> markResolved(String storedName,
      {required bool deleteFile}) async {
    final paths = _paths ??= ScraperProcess.resolvePaths();
    if (paths == null) return;

    final updated = await PipelineDataDir.resolveQuarantinedFile(
      paths: paths,
      storedName: storedName,
      deleteFile: deleteFile,
    );
    state = AsyncData(updated);
    await _publish(updated);
  }

  /// Re-read from disk on demand (the "refresh" affordance on the card).
  Future<void> refresh() async {
    ref.invalidateSelf();
    await future;
  }

  /// Upsert this account's row on the shared board. Best-effort: a board that
  /// is briefly stale is not worth surfacing an error for, and the next
  /// load/resolve pushes again.
  Future<void> _publish(MergeQuarantineIndex index) async {
    final session = ref.read(currentSessionProvider);
    if (session == null) return;
    try {
      await ref.read(clientMergeStatusRepositoryProvider).saveMine(
        pendingCount: index.pendingCount,
        entries: [
          for (final f in index.pending)
            MergeStatusEntry(
              path: f.originalRelPath,
              quarantinedAt: f.quarantinedAt,
              note: f.note,
            ),
        ],
      );
    } catch (_) {
      // Swallowed on purpose — see the doc comment.
    }
  }
}

final localMergeQuarantineProvider =
    AsyncNotifierProvider<LocalMergeQuarantineController, MergeQuarantineIndex>(
  LocalMergeQuarantineController.new,
);

/// The whole team's outstanding merges, newest-updated first, joined to the
/// team directory so the card can show names rather than account ids.
///
/// Re-reads on a realtime push to `client_merge_status` (via
/// [DataDomain.mergeStatus]).
final teamMergeStatusProvider =
    FutureProvider<List<TeamMergeStatusRow>>((ref) async {
  ref.watch(dataRevisionProvider(DataDomain.mergeStatus));

  final rows = await ref.watch(clientMergeStatusRepositoryProvider).fetchAll();
  final members = await ref.watch(teamMembersProvider.future);
  final myId = ref.watch(currentSessionProvider)?.user.id;

  return [
    for (final row in rows)
      TeamMergeStatusRow(
        status: row,
        displayName: members[row.userId]?.displayName,
        isMe: row.userId == myId,
      ),
  ];
});

/// One row of the team board: a `client_merge_status` row plus the display
/// name it belongs to (null if that account is no longer in the directory).
class TeamMergeStatusRow {
  const TeamMergeStatusRow({
    required this.status,
    required this.displayName,
    required this.isMe,
  });

  final ClientMergeStatus status;
  final String? displayName;
  final bool isMe;

  String get name => displayName ?? 'Unknown teammate';
}
