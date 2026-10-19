import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/utils/blank.dart';

/// What a signed-in account is allowed to see.
///
/// Mirrors the `app_role` enum in `backend/schema.sql` exactly. This copy
/// exists only so the UI can *explain* the level and grey out controls that
/// would fail anyway — it is never the thing that enforces access. Enforcement
/// is entirely server-side, in the row level security policies. If these two
/// ever disagree, the database wins and the user sees an error, which is the
/// correct failure direction: a client that lies about its own level gains
/// nothing.
enum AccessLevel {
  /// The default for every newly created account. Reads nothing at all;
  /// email data requests are refused outright rather than returning empty.
  unauthorized,

  /// Sees that emails and deals happened, and their status and timing. Never
  /// influencer names, channels, brands, prices, or email addresses — those
  /// fields are stripped by the server before the reply is sent.
  basic,

  /// Sees everything.
  full;

  static AccessLevel fromWire(String? value) => switch (value) {
        'full' => AccessLevel.full,
        'basic' => AccessLevel.basic,
        _ => AccessLevel.unauthorized,
      };

  String get wireValue => name;

  /// Can this level read the app's business data at all?
  bool get isAuthorized => this != AccessLevel.unauthorized;

  /// Can this level see uncensored email bodies, prices, and brand names?
  bool get seesSensitiveData => this == AccessLevel.full;
}

/// A member of the team, as the app knows them: the `profiles` row that the
/// database trigger creates for every new auth account.
class TeamMember {
  const TeamMember({
    required this.id,
    required this.displayName,
    required this.color,
    required this.accessLevel,
  });

  final String id;
  final String displayName;

  /// This person's color everywhere in the app — the border drawn around
  /// whatever they are currently editing, and their chip in the presence bar.
  /// Assigned deterministically at signup from the account id so it never
  /// changes between sessions, and editable afterwards.
  final Color color;

  final AccessLevel accessLevel;

  static TeamMember fromRow(Map<String, dynamic> row) {
    return TeamMember(
      id: row['id'] as String,
      displayName:
          (row['display_name'] as String?).trimmedOrNull ?? 'No Nickname',
      color: parseColor(row['color'] as String?),
      accessLevel: AccessLevel.fromWire(row['role'] as String?),
    );
  }

  /// The colors a member can pick for themselves, in the order the picker
  /// shows them. The first is also what a missing or malformed color falls
  /// back to.
  static const palette = <Color>[
    Color(0xFF3B82F6),
    Color(0xFFEF4444),
    Color(0xFF10B981),
    Color(0xFFF59E0B),
    Color(0xFF8B5CF6),
    Color(0xFFEC4899),
    Color(0xFF14B8A6),
    Color(0xFFF97316),
  ];

  /// '#RRGGBB' -> Color. Falls back to [palette]'s first entry rather than
  /// throwing — a malformed color is a cosmetic problem and must never stop
  /// a teammate's presence from being shown at all.
  static Color parseColor(String? hex) {
    final fallback = palette.first;
    if (hex == null) return fallback;
    final cleaned = hex.replaceAll('#', '').trim();
    if (cleaned.length != 6) return fallback;
    final value = int.tryParse(cleaned, radix: 16);
    return value == null ? fallback : Color(0xFF000000 | value);
  }

  static String colorToHex(Color color) {
    // toARGB32() rather than the deprecated .value — same 32-bit packing.
    final rgb = color.toARGB32() & 0x00FFFFFF;
    return '#${rgb.toRadixString(16).padLeft(6, '0').toUpperCase()}';
  }

  TeamMember copyWith({String? displayName, Color? color}) => TeamMember(
        id: id,
        displayName: displayName ?? this.displayName,
        color: color ?? this.color,
        accessLevel: accessLevel,
      );
}
