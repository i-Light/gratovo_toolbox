import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Bumped after any successful write to any skill group or card — the signal
/// `skillsLibrarySnapshotProvider` (`skills_library_snapshot.dart`) re-reads
/// on, so the cross-skill `@` mention menu and export transclusion see the
/// newest cards without a full realtime sync layer. Local to this session
/// only, same as `ScratchpadSyncEvent`'s log — nobody else's edits move this
/// counter.
class SkillsRevisionNotifier extends Notifier<int> {
  @override
  int build() => 0;

  void bump() => state++;
}

final skillsRevisionProvider =
    NotifierProvider<SkillsRevisionNotifier, int>(SkillsRevisionNotifier.new);
