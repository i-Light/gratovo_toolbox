import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/pipeline_reset.dart';

/// The merge-quarantine index as it stood at boot, after `main()` applied any
/// pending `reset_manifest.json` actions (see
/// `PipelineDataDir.applyPendingResets`).
///
/// Injected as a `ProviderScope` override rather than recomputed, for the same
/// reason `supabaseBootProvider` and `syncBootProvider` are: the work happens
/// once, before the first frame, and the widget tree just reads the outcome.
/// [MergeQuarantineIndex.empty] on web and on any desktop machine that had
/// nothing to set aside.
///
/// `merge_status_controller.dart` reads this once to publish the count to the
/// team board, then the on-disk `index.json` is the source of truth for
/// everything after (a file resolved in Settings, a later reset).
///
/// Defaults to [MergeQuarantineIndex.empty] rather than throwing when no
/// override is supplied: unlike `supabaseBootProvider`, a missing value here is
/// not a misconfiguration to catch — it just means "nothing was set aside",
/// which is the right answer for a widget test that never ran `main()`.
final pendingMergeBootProvider = Provider<MergeQuarantineIndex>(
  (ref) => MergeQuarantineIndex.empty,
);
