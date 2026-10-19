/// Shared parsing for rows coming back from PostgREST.
///
/// Every helper here tolerates null, the wrong type, and unparseable text,
/// because the real data has all three: subscriber counts imported as strings,
/// publish dates absent on videos whose fetch failed, JSON columns that are
/// null on rows written before the column existed. A mapper that throws on any
/// of those takes down a whole screen over one bad row, which is never the
/// right trade for this app.
library;

import 'dart:convert';

/// Every instant in the app is stored and passed around in UTC; it is only
/// shifted into a wall clock at the moment it is rendered, by
/// `InstantFormatter` / `TzClock` against the user's chosen display zone.
///
/// `timestamptz` comes back from PostgREST as an offset-aware ISO string, so
/// `DateTime.parse` already yields the correct instant and `.toUtc()` just
/// normalises the representation. A string with no timezone designator is
/// read as UTC (not the device's local zone, which `DateTime.parse`'s
/// default would assume) — the database and the local mirror both store
/// UTC, and a naive local reading would silently shift every such value by
/// the reader's offset.
final _hasTimeZoneDesignator = RegExp(r'(Z|[+-]\d\d:?\d\d)$');

DateTime? parseDate(Object? value) {
  if (value == null) return null;
  if (value is DateTime) return value.isUtc ? value : value.toUtc();

  var text = value.toString().trim();
  if (text.isEmpty) return null;
  if (text.contains(' ') && !text.contains('T')) {
    // Postgres' own `timestamp` text form uses a space, not a 'T'.
    text = text.replaceFirst(' ', 'T');
  }
  // Only a value that carries a time-of-day but no zone needs the explicit
  // UTC marker; a bare `yyyy-mm-dd` (a `date` column) has no instant to shift
  // and `DateTime.tryParse` + `.toUtc()` handles it fine.
  if (text.contains('T') && !_hasTimeZoneDesignator.hasMatch(text)) {
    text = '${text}Z';
  }
  return DateTime.tryParse(text)?.toUtc();
}

int? parseInt(Object? value) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is num) return value.toInt();
  final text = value.toString().replaceAll(',', '').trim();
  if (text.isEmpty) return null;
  return int.tryParse(text) ?? double.tryParse(text)?.toInt();
}

double? parseDouble(Object? value) {
  if (value == null) return null;
  if (value is num) return value.toDouble();
  final text = value.toString().replaceAll(',', '').trim();
  return text.isEmpty ? null : double.tryParse(text);
}

String? parseString(Object? value) {
  if (value == null) return null;
  final text = scrubUtf16(value.toString());
  return text.trim().isEmpty ? null : text;
}

/// Replaces unpaired UTF-16 surrogate code units with U+FFFD (`�`).
///
/// Text from the pipeline sometimes arrives with half of an emoji's surrogate
/// pair — a channel name truncated to a byte length upstream, a description
/// clipped mid-character, a title hand-edited in a sheet. Flutter's text layer
/// throws "string is not well-formed UTF-16" the instant such a string reaches
/// a TextSpan, taking down whatever row was scrolling past. Scrubbing it here,
/// at the one point every row's text comes through, keeps that off every
/// widget. A well-formed string is returned unchanged (and without allocating).
String scrubUtf16(String input) {
  StringBuffer? out;
  for (var i = 0; i < input.length; i++) {
    final unit = input.codeUnitAt(i);
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      final next = i + 1 < input.length ? input.codeUnitAt(i + 1) : 0;
      if (next >= 0xDC00 && next <= 0xDFFF) {
        // A valid high/low pair: keep both, skip the low half next iteration.
        out
          ?..writeCharCode(unit)
          ..writeCharCode(next);
        i++;
        continue;
      }
    } else if (unit < 0xDC00 || unit > 0xDFFF) {
      // An ordinary code unit.
      out?.writeCharCode(unit);
      continue;
    }
    // A high surrogate with no low half, or a stray low surrogate.
    (out ??= StringBuffer(input.substring(0, i))).writeCharCode(0xFFFD);
  }
  return out?.toString() ?? input;
}

bool parseBool(Object? value) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  return value?.toString().toLowerCase() == 'true';
}

/// Handles both a Postgres `text[]` (arrives as a List) and a `jsonb` array,
/// and quietly drops non-string members rather than crashing on a mixed array.
List<String> parseStringList(Object? value) {
  if (value is List) {
    return [
      for (final item in value)
        if (item != null && item.toString().trim().isNotEmpty)
          scrubUtf16(item.toString()),
    ];
  }
  if (value is String && value.trim().isNotEmpty) return [value];
  return const [];
}

/// A `jsonb` object column. Returns null for anything that is not a JSON
/// object — including a JSON array or scalar, which are valid `jsonb` but not
/// what any caller here means by "the extra fields on this row".
///
/// PostgREST decodes `jsonb` into real Dart maps already, so the String branch
/// only matters for a value that arrived as text (an older row written by a
/// tool that JSON-encoded it twice). Parsing it rather than dropping it is the
/// difference between showing the data and silently showing nothing.
Map<String, dynamic>? parseJsonMap(Object? value) {
  if (value is Map) {
    return {
      for (final entry in value.entries) entry.key.toString(): entry.value,
    };
  }
  if (value is String && value.trim().isNotEmpty) {
    try {
      final decoded = jsonDecode(value);
      if (decoded is Map) {
        return {
          for (final entry in decoded.entries)
            entry.key.toString(): entry.value,
        };
      }
    } on FormatException {
      return null;
    }
  }
  return null;
}

/// Postgres timestamps must go out as ISO-8601 UTC. Sending local time
/// without an offset is the classic way to write a value three hours off.
String toIso(DateTime value) => value.toUtc().toIso8601String();
