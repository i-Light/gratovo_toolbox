/// Keyset paging over PostgREST: the "after this row" filter and the cursor
/// key it is built from. Pure functions, separate from the puller because they
/// are the one part of the paging that fails silently when wrong — a badly
/// escaped filter is still a valid filter that returns a plausible page of
/// the wrong rows — so they are the part worth testing on their own.
library;

import 'dart:convert';

/// The PostgREST filter meaning "everything after this row in the sort order".
///
/// Top-level rather than a method because it is pure, and because it is the one
/// part of the paging that fails silently when it is wrong: a filter that
/// escapes a value badly is still a valid filter, and it returns a plausible
/// page of the wrong rows. See `MirrorPuller._keysetFilter` for why the paging
/// is a keyset at all.
///
/// [key] is [encodeCursorKey]'s output for the last row applied, as stored in
/// `_sync_meta` — one field for what may be a composite key, because the meta
/// table holds strings and a second column would have to be kept in step with
/// this one anyway.
String buildKeysetFilter({
  required String cursorColumn,
  required List<String> keyColumns,
  required String cursor,
  String? key,
}) {
  final keyValues = decodeCursorKey(key);
  final clauses = <String>['$cursorColumn.gt.${_quoteFilterValue(cursor)}'];

  for (var i = 0; i < keyColumns.length && i < keyValues.length; i++) {
    final terms = <String>['$cursorColumn.eq.${_quoteFilterValue(cursor)}'];
    for (var j = 0; j < i; j++) {
      terms.add('${keyColumns[j]}.eq.${_quoteFilterValue(keyValues[j])}');
    }
    terms.add('${keyColumns[i]}.gt.${_quoteFilterValue(keyValues[i])}');
    clauses.add('and(${terms.join(',')})');
  }

  return clauses.join(',');
}

/// Quotes a filter value, because these are not all machine-generated ids.
///
/// `channel_keywords.keyword` is whatever somebody typed into the search box,
/// and a comma in it would otherwise be read as the end of one condition and
/// the start of the next — turning a filter into a different, valid, wrong
/// filter. PostgREST takes a double-quoted value with backslash escapes.
/// The composite cursor key, as one `_sync_meta` value.
///
/// JSON rather than joining on a separator, which is the obvious encoding and
/// is wrong: `channel_keywords.keyword` is whatever somebody typed into the
/// search box, and "gaming setup" is two words. Split on a space, the cursor
/// silently becomes `gaming`, and the next page resumes from a keyword nobody
/// searched for — skipping every row in between.
String encodeCursorKey(List<String> values) => jsonEncode(values);

/// The inverse, tolerating anything that is not a list of strings.
///
/// A null or unreadable key reads as "no key yet", which degrades the filter to
/// a plain `cursor > value`. That re-fetches at most one timestamp's worth of
/// rows into an INSERT OR REPLACE, which costs a little bandwidth and cannot
/// lose anything.
List<String> decodeCursorKey(String? raw) {
  if (raw == null) return const [];
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! List) return const [];
    return [for (final value in decoded) '$value'];
  } on FormatException {
    return const [];
  }
}

String _quoteFilterValue(String value) {
  final escaped = value.replaceAll(r'\', r'\\').replaceAll('"', r'\"');
  return '"$escaped"';
}
