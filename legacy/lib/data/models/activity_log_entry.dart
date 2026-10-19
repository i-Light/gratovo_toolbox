import 'package:gratovo_toolbox/data/models/team_member.dart';

/// What kind of thing happened. Deliberately a small, closed vocabulary
/// rather than free text: the Logs page filters on it, and a log where one
/// person writes "changed tag" and the next writes "tag changed" cannot be
/// filtered at all.
///
/// [wire] is what is stored. An action recorded by a future build that this
/// build does not know about reads back as [unknown] and still shows its
/// actor, entity and timestamp — a log that hides entries it cannot fully
/// parse is worse than useless, because it looks complete.
enum ActivityAction {
  created,
  updated,
  deleted,
  tagsChanged,
  stageChanged,
  vettingChanged,
  notesChanged,
  contactsChanged,
  contactAttempt,
  emailSent,

  /// A reply arrived and the mailbox reported it (see
  /// `outreach_inbox_controller.dart`). Recorded by the app rather than by a
  /// person, which is precisely why it is worth logging: it is the one entry
  /// that explains a channel moving to `interested` with nobody having
  /// touched it.
  replyReceived,

  searchStarted,
  videosPulled,
  unknown;

  String get wire => name;

  static ActivityAction fromWire(String? value) {
    if (value == null) return ActivityAction.unknown;
    for (final action in ActivityAction.values) {
      if (action.name == value) return action;
    }
    return ActivityAction.unknown;
  }
}

/// One recorded action, with everything needed to read it years later already
/// inside the row.
///
/// The denormalisation is the entire point and is not an oversight. [actorId]
/// is a nullable link to `profiles`, so deleting an account does not delete
/// its history — but a link alone would leave "someone, we no longer know
/// who, changed this". [actorName] and [actorRole] are therefore snapshots
/// taken at the moment of the action: the name the person had then, and the
/// authority they held then. Promoting someone to `full` next month must not
/// retroactively make last month's entries look like they were made with full
/// authority, which is exactly what joining live to `profiles` would do.
///
/// [entityLabel] is a snapshot for the same reason: a channel can be renamed
/// or removed, and "changed tags on UC123..." is not a log anyone can read.
class ActivityLogEntry {
  const ActivityLogEntry({
    required this.id,
    required this.at,
    required this.actorName,
    required this.actorRole,
    required this.action,
    required this.entityType,
    this.actorId,
    this.entityId,
    this.entityLabel,
    this.field,
    this.oldValue,
    this.newValue,
    this.detail,
  });

  final String id;
  final DateTime at;

  /// Null once the account has been deleted. The entry survives; only the link
  /// back to a live profile is lost.
  final String? actorId;

  /// The display name as it was when this happened.
  final String actorName;

  /// The authority held when this happened, not the authority held now.
  final AccessLevel actorRole;

  final ActivityAction action;

  /// 'channel', 'deal', 'brand', 'thread', 'run', 'settings' — matches the
  /// `type` strings the presence system already uses for editing targets, so
  /// one vocabulary covers both.
  final String entityType;

  final String? entityId;

  /// How the entity was named at the time — a channel handle, a brand name.
  final String? entityLabel;

  /// Which field changed, for [ActivityAction.updated]-shaped entries.
  final String? field;

  /// Before and after, as short display strings rather than typed values.
  /// A log is read, not recomputed from; storing "shortlisted" beats storing
  /// an enum index that a later reordering would silently re-point.
  final String? oldValue;
  final String? newValue;

  /// Anything that does not fit the from/to shape (how many videos a pull
  /// returned, which keywords a run started with).
  final Map<String, dynamic>? detail;

  /// True when this entry's actor no longer has an account.
  bool get actorIsGone => actorId == null;
}
