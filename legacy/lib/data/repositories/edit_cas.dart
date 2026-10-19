/// The Dart side of `canonical_edit_value` and `apply_channel_edit` — see
/// `backend/schema.sql` section 10, which defines what a conflict is.
///
/// This exists as its own file because three separate places have to agree on
/// it to the letter, and a copy in each would be three chances to drift:
///
///  * [MockInfluencerRepository], so a test can observe a lost update.
///  * `MirrorInfluencerRepository`, which decides locally and offline, long
///    before the server ever sees the write.
///  * `MirrorUploader`, which is what finally asks the server, whenever the
///    machine next has a connection.
///
/// The rule they must agree on is not "did the value change" but "was the base
/// still there" — see [decideEdit].
library;

import 'package:gratovo_toolbox/data/models/edit_conflict.dart';

/// Exactly the columns `apply_channel_edit` will accept, in the same order.
///
/// Duplicated from the SQL's `if p_field not in (...)` guard on purpose: this
/// is a whitelist, and a whitelist that lives in only one of two processes is a
/// whitelist the other one does not have. Anything outside it is a column the
/// Python pipeline owns, or one no user is allowed to write at all.
/// A list rather than a set, because the order is the SQL's order and nine
/// entries is not a lookup worth a hash table.
const List<String> kEditableChannelFields = [
  'notes',
  'vetting_status',
  'pipeline_stage',
  'channel_tags',
  'relevance_criteria',
  'provided_data',
  'contacts',
  'media_kit',
  'creator_gender',
];

/// Order-insensitive, for the two fields the SQL also sorts.
///
/// Tags and criteria are SETS: nothing in the app depends on their order and
/// the UI renders them sorted anyway, so a reordering must not read as a
/// change. `contacts` is deliberately absent — its order is meaningful, because
/// the primary contact is the first one and "make primary" reorders on purpose
/// (see `InfluencerContact.normalize`).
List<String> sortedEditSet(Iterable<String> values) => values.toList()..sort();

/// Mirrors `canonical_edit_value(p_field, p_value)`.
///
/// Two normalisations, both of which exist to prevent conflicts about nothing:
/// null and the empty string are the same fact for a text field (the app sends
/// `''` for a cleared note; the database stores NULL), and tag/criteria lists
/// are compared as sets.
Object? canonicalEditValue(String field, Object? value) {
  if (value == null) return null;
  if (field == 'notes' ||
      field == 'vetting_status' ||
      field == 'pipeline_stage' ||
      field == 'creator_gender') {
    return value == '' ? null : value;
  }
  if (field == 'channel_tags' || field == 'relevance_criteria') {
    if (value is List) {
      return sortedEditSet([for (final e in value) '$e']);
    }
  }
  return value;
}

/// Deep equality over the shapes these values actually take — scalars, and
/// lists and maps of them.
///
/// `==` on a List is identity in Dart, so without this every list comparison
/// would report a change and every list edit would conflict with itself.
bool sameEditValue(Object? a, Object? b) {
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!sameEditValue(a[i], b[i])) return false;
    }
    return true;
  }
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final key in a.keys) {
      if (!b.containsKey(key) || !sameEditValue(a[key], b[key])) return false;
    }
    return true;
  }
  // Null and empty string are the same fact for a text field, matching
  // `canonical_edit_value`. Kept here as well as in [canonicalEditValue]
  // because this function is also called on values that were canonicalised
  // under a different field name.
  if (a == null && b == '') return true;
  if (a == '' && b == null) return true;
  return a == b;
}

/// `apply_channel_edit`'s decision table, minus the write.
///
/// [current] is what the record holds now, [base] what the editor was looking
/// at, [next] what they want. All three are in wire form — the shape the
/// database column would hold as jsonb — and are canonicalised here.
///
/// Never returns [EditOutcome.missing]: whether the channel exists at all is
/// something the caller knows and this function does not.
///
/// The order of the three tests is load-bearing and matches the SQL:
///
///  1. Nothing is being changed — a save with no edit in it must never file a
///     conflict, even against a stale base.
///  2. The value already equals what is being written. Two people reaching the
///     same conclusion independently is not a disagreement.
///  3. Only then, staleness of the base.
EditOutcome decideEdit({
  required String field,
  required Object? current,
  required Object? base,
  required Object? next,
}) {
  final canonicalCurrent = canonicalEditValue(field, current);
  final canonicalBase = canonicalEditValue(field, base);
  final canonicalNext = canonicalEditValue(field, next);

  if (sameEditValue(canonicalBase, canonicalNext)) return EditOutcome.noop;
  if (sameEditValue(canonicalCurrent, canonicalNext)) return EditOutcome.auto;
  if (!sameEditValue(canonicalCurrent, canonicalBase)) {
    return EditOutcome.conflict;
  }
  return EditOutcome.applied;
}
