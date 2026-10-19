import 'package:gratovo_toolbox/data/models/activity_log_query.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';

/// Reads and appends the team's action history.
///
/// Append-only by design: there is no update and no delete on this interface,
/// and `backend/schema.sql` withholds those rights from every
/// role including `full`. A log that the people it records can edit is not a
/// log — and the request this implements was specifically that the history
/// survive a person being removed or having their authority changed, which an
/// editable table cannot promise.
abstract class ActivityLogRepository {
  /// One page, newest first. [offset] is a row offset, not a page number.
  Future<ActivityLogPage> getPage({
    required int offset,
    required int limit,
    ActivityLogQuery query = const ActivityLogQuery(),
  });

  /// Everyone who appears in the log, for the actor filter — including people
  /// whose account has since been deleted, who are exactly the ones a live
  /// read of `profiles` would miss.
  Future<List<ActivityActor>> getActors();

  /// Appends one entry. [actorId] may be null only when nobody is signed in,
  /// which in practice means the mock repository.
  ///
  /// Never throws for the caller's benefit: a failed write is logged to the
  /// developer console and swallowed. Recording history must not be able to
  /// fail the action it is recording — a tag change that succeeded and then
  /// showed an error because its log entry did not is worse than a gap.
  Future<void> record({
    required ActivityDraft draft,
    required String? actorId,
    required String actorName,
    required AccessLevel actorRole,
  });
}

/// A distinct person appearing in the log.
///
/// [isDeleted] is what the actor filter uses to mark someone whose account is
/// gone. Their entries are still there and still readable; only the account
/// behind them is not.
class ActivityActor {
  const ActivityActor({
    required this.name,
    this.id,
    this.isDeleted = false,
  });

  final String? id;
  final String name;
  final bool isDeleted;

  @override
  bool operator ==(Object other) =>
      other is ActivityActor && other.id == id && other.name == name;

  @override
  int get hashCode => Object.hash(id, name);
}
