/// What happened to one compare-and-set write.
///
/// Mirrors the strings `public.apply_channel_edit` returns — see
/// `backend/schema.sql` section 10, which defines what a conflict is and why.
enum EditOutcome {
  /// The base still matched, so the edit went in.
  applied,

  /// Nothing was being changed. Opening a field and closing it again.
  noop,

  /// The value already equalled what was being written. Two people reaching
  /// the same conclusion independently is not a disagreement, so nobody is
  /// asked to adjudicate it.
  auto,

  /// The base was stale: this edit was composed without knowledge of somebody
  /// else's. The column was NOT written, and an [EditConflict] now holds all
  /// three values.
  conflict,

  /// No such channel. Most likely archived out from under the editor.
  missing;

  /// Whether the field now reads as the caller intended. True for everything
  /// except [conflict] and [missing] — [noop] and [auto] both mean the value is
  /// already what was wanted, which is a success from the caller's point of
  /// view even though nothing was written.
  bool get succeeded =>
      this == EditOutcome.applied ||
      this == EditOutcome.noop ||
      this == EditOutcome.auto;

  static EditOutcome fromWire(String? value) {
    for (final outcome in EditOutcome.values) {
      if (outcome.name == value) return outcome;
    }
    // An unrecognized answer is treated as a conflict rather than a success:
    // the safe reading of "I don't know what happened" is "assume it did not
    // land", which shows the user something rather than silently losing an edit.
    return EditOutcome.conflict;
  }
}

/// Two edits to the same field that were composed independently.
///
/// Not "two people edited this" — see `backend/schema.sql`. Sequential
/// edits, where the second person could see the first person's work, never
/// produce one of these however many times they happen. This is specifically
/// the case where two versions branched from the same base and neither
/// contains the other, so there is no correct automatic answer and a person has
/// to choose.
class EditConflict {
  const EditConflict({
    required this.id,
    required this.channelId,
    required this.channelLabel,
    required this.field,
    required this.mineActorName,
    required this.detectedAt,
    this.baseValue,
    this.mineValue,
    this.theirsValue,
    this.theirsActorName,
    this.resolvedAt,
    this.resolvedByName,
    this.resolution,
  });

  final String id;
  final String channelId;

  /// What the channel was called when this happened. A snapshot, for the same
  /// reason `activity_log.entity_label` is one: a channel can be renamed, and
  /// "a conflict on UCa1b2c3…" is not something anyone can act on.
  final String channelLabel;

  /// The column, as the database names it (`notes`, `channel_tags`, …).
  final String field;

  /// What the person who hit the conflict was looking at when they started.
  final Object? baseValue;

  /// What they wrote. Held here and nowhere else — it was refused by the
  /// database, so this record is the only copy.
  final Object? mineValue;

  /// What was actually in the column instead.
  final Object? theirsValue;

  final String mineActorName;

  /// Null when the other edit predates the `last_edited_by` column or came
  /// from an account since deleted. The UI says "someone else" rather than
  /// inventing a name.
  final String? theirsActorName;

  final DateTime detectedAt;

  final DateTime? resolvedAt;
  final String? resolvedByName;
  final ConflictResolution? resolution;

  bool get isOpen => resolvedAt == null;
}

/// Which of the three values a person chose.
enum ConflictResolution {
  /// The value the person who hit the conflict had written.
  mine,

  /// The value that was already on the server.
  theirs,

  /// Neither — a third value typed while looking at both. The reason this
  /// exists is that for free text it is usually the right answer: two people
  /// each added a paragraph, and both paragraphs should survive.
  merged;

  String get wire => name;

  static ConflictResolution? fromWire(String? value) {
    for (final resolution in ConflictResolution.values) {
      if (resolution.wire == value) return resolution;
    }
    return null;
  }
}
