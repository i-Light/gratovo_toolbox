import 'package:gratovo_toolbox/data/models/email_tag.dart';

/// Selected tags first, everything else behind them in vocabulary order.
///
/// The one rule both selection controls share, extracted so it is stated once
/// and can be unit-tested without building a widget. Within each group the
/// incoming order is preserved — [emailTagsProvider] has already sorted by
/// `sortOrder` then label, and re-sorting here would silently override the
/// sequence order the seeded stage tags carry.
///
/// Pure, and stable: two tags that are both selected keep their relative order,
/// so a row does not reshuffle itself when an unrelated chip is tapped.
List<EmailTag> orderSelectedFirst(
  List<EmailTag> tags,
  Set<String> selectedIds,
) {
  if (selectedIds.isEmpty) return tags;
  return [
    for (final tag in tags)
      if (selectedIds.contains(tag.id)) tag,
    for (final tag in tags)
      if (!selectedIds.contains(tag.id)) tag,
  ];
}

/// The subset of [tags] whose label contains [query], case-insensitively.
///
/// A plain substring match, not a fuzzy one. The niche vocabulary is typed by
/// the same person who searches it, so "fit" finding "Fitness" is the whole
/// requirement, and a fuzzy matcher would mostly serve to rank "Fintech" above
/// it on the same three letters.
///
/// A blank query returns [tags] unchanged rather than an empty list — an empty
/// search box means "no filter", not "match nothing".
List<EmailTag> filterTagsByQuery(List<EmailTag> tags, String query) {
  final needle = query.trim().toLowerCase();
  if (needle.isEmpty) return tags;
  return [
    for (final tag in tags)
      if (tag.labelKey.contains(needle)) tag,
  ];
}
