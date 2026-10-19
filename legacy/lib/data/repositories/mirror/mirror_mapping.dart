/// Reading rows out of the local mirror, where SQLite has only text, integer
/// and real.
///
/// The Supabase repositories get real Dart lists and maps back from PostgREST,
/// which decodes `jsonb` for them. Nothing decodes anything here: a Postgres
/// `text[]` or `jsonb` column arrives as a JSON *string*, so `channel_tags` is
/// the seven characters `["new"]` rather than a one-element list. Every read of
/// such a column goes through this file, and every write goes back through
/// [encodeJsonColumn], so the two can never disagree about the encoding.
library;

import 'dart:convert';

/// The columns that hold JSON text locally — see `lib/core/sync/mirror_schema.dart`.
const Set<String> kLocalJsonColumns = {
  'channel_tags',
  'relevance_criteria',
  'provided_data',
  'contacts',
  'media_kit',
  'base_value',
  'mine_value',
  'theirs_value',
};

/// Decodes a JSON column, tolerating everything the real data does.
///
/// Returns null for a value that is not valid JSON rather than throwing. A
/// single malformed row would otherwise take down whichever screen happened to
/// scroll past it, which is never the right trade here — the same rule
/// `supabase_mapping.dart` follows for the network path.
Object? decodeJsonColumn(Object? raw) {
  if (raw == null) return null;
  if (raw is! String) return raw;
  final text = raw.trim();
  if (text.isEmpty) return null;
  try {
    return jsonDecode(text);
  } on FormatException {
    return null;
  }
}

/// A JSON column on the way back into the mirror.
///
/// Null stays null rather than becoming the text `"null"`: a cleared field is
/// an absent value, and a column holding the four characters `null` is a column
/// that reads as present to every query that checks `IS NOT NULL`.
String? encodeJsonColumn(Object? value) =>
    value == null ? null : jsonEncode(value);

/// A JSON array column as a list of strings.
///
/// Non-string and blank members are dropped rather than crashing the read, and
/// a value that is not an array at all yields an empty list — matching
/// `parseStringList` in `supabase_mapping.dart`, which faces the same mixed
/// data from the other direction.
List<String> decodeStringList(Object? raw) {
  final decoded = decodeJsonColumn(raw);
  if (decoded is! List) return const [];
  return [
    for (final item in decoded)
      if (item != null && item.toString().trim().isNotEmpty) item.toString(),
  ];
}
