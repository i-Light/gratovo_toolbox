import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';

/// One page of the log, plus whether there is another.
///
/// [hasMore] means "the database returned a full page", exactly as
/// [InfluencerPage.hasMore] does, and for the same reason — a total count is a
/// second query over a table that only ever grows, for a number the UI uses as
/// a boolean.
class ActivityLogPage {
  const ActivityLogPage({required this.items, required this.hasMore});

  const ActivityLogPage.empty()
      : items = const [],
        hasMore = false;

  final List<ActivityLogEntry> items;
  final bool hasMore;
}

/// What the Logs page is currently showing.
///
/// The actor is filtered by id where there is one, so renaming somebody does
/// not split their history in two. A deleted account has no id left, which is
/// what [actorName] is for — it is the only handle remaining on those entries,
/// and they are exactly the ones anyone most wants to be able to ask about.
class ActivityLogQuery {
  const ActivityLogQuery({
    this.search,
    this.actorId,
    this.actorName,
    this.action,
    this.entityType,
    this.entityId,
    this.from,
    this.to,
  });

  /// Free text across the actor name, the entity label, and the field name.
  final String? search;

  final String? actorId;

  /// An exact actor name, used to reach the history of an account that no
  /// longer exists.
  ///
  /// Matching on a name is weaker than matching on an id — two people who have
  /// held the same display name would come back together. That is the right
  /// trade here: the alternative for a deleted account is no way to filter to
  /// them at all, and a name collision produces a superset rather than a wrong
  /// answer.
  final String? actorName;
  final ActivityAction? action;
  final String? entityType;

  /// Narrows to one record's history — what the profile pages use.
  final String? entityId;

  /// Inclusive lower bound, exclusive upper bound. Half-open so that "today"
  /// is expressible without worrying about the last millisecond of the day.
  final DateTime? from;
  final DateTime? to;

  bool get isUnfiltered =>
      (search == null || search!.trim().isEmpty) &&
      actorId == null &&
      actorName == null &&
      action == null &&
      entityType == null &&
      entityId == null &&
      from == null &&
      to == null;

  int get activeFilterCount => [
        search != null && search!.trim().isNotEmpty,
        actorId != null || actorName != null,
        action != null,
        entityType != null,
        from != null || to != null,
      ].where((active) => active).length;

  /// Nullable fields take a `T? Function()?` for the same reason
  /// [InfluencerQuery.copyWith] does: null means "no constraint", so a plain
  /// `T?` could not express clearing one.
  ActivityLogQuery copyWith({
    String? Function()? search,
    String? Function()? actorId,
    String? Function()? actorName,
    ActivityAction? Function()? action,
    String? Function()? entityType,
    String? Function()? entityId,
    DateTime? Function()? from,
    DateTime? Function()? to,
  }) {
    return ActivityLogQuery(
      search: search != null ? search() : this.search,
      actorId: actorId != null ? actorId() : this.actorId,
      actorName: actorName != null ? actorName() : this.actorName,
      action: action != null ? action() : this.action,
      entityType: entityType != null ? entityType() : this.entityType,
      entityId: entityId != null ? entityId() : this.entityId,
      from: from != null ? from() : this.from,
      to: to != null ? to() : this.to,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is ActivityLogQuery &&
      other.search == search &&
      other.actorId == actorId &&
      other.actorName == actorName &&
      other.action == action &&
      other.entityType == entityType &&
      other.entityId == entityId &&
      other.from == from &&
      other.to == to;

  @override
  int get hashCode => Object.hash(
      search, actorId, actorName, action, entityType, entityId, from, to);
}

/// One action about to be recorded.
///
/// The actor is deliberately absent: it is never passed in by a caller, it is
/// read from the current session by the logger. A call site that could name
/// its own actor is a call site that could name the wrong one.
class ActivityDraft {
  const ActivityDraft({
    required this.action,
    required this.entityType,
    this.entityId,
    this.entityLabel,
    this.field,
    this.oldValue,
    this.newValue,
    this.detail,
  });

  final ActivityAction action;
  final String entityType;
  final String? entityId;
  final String? entityLabel;
  final String? field;
  final String? oldValue;
  final String? newValue;
  final Map<String, dynamic>? detail;
}
