import 'package:gratovo_toolbox/data/models/edit_conflict.dart';

/// The edits that could not be applied because somebody else got there first.
///
/// Note what is NOT here: filing one. A conflict is recorded by
/// `apply_channel_edit` inside the same statement that refused the write — see
/// `backend/schema.sql`. A client that could file its own would be able
/// to claim a disagreement that never happened, and a client that had to
/// remember to file one would eventually forget, which is worse: the edit would
/// vanish with nothing recording that it existed.
abstract class ConflictRepository {
  /// Every unresolved conflict, newest first.
  Future<List<EditConflict>> getOpen();

  /// Unresolved conflicts on one channel, for the banner on its profile.
  Future<List<EditConflict>> getOpenForChannel(String channelId);

  /// Recently settled ones, so the page can show that a disagreement was dealt
  /// with rather than making a resolved conflict disappear without trace.
  Future<List<EditConflict>> getResolved({int limit = 50});

  /// Applies [value] to the field and marks the conflict settled.
  ///
  /// [value] is passed rather than derived from [resolution] because
  /// [ConflictResolution.merged] means a person typed a third thing that is
  /// neither side — which, for free text, is usually the right answer: two
  /// people each added a paragraph and both should survive.
  ///
  /// The write is forced. The base deliberately no longer matters: a human has
  /// looked at both values and chosen, which is the only thing that can settle
  /// this.
  Future<void> resolve(
    String conflictId,
    ConflictResolution resolution,
    Object? value,
  );
}
