import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// One person's scratchpad box: a `public.scratchpads` row.
///
/// The row is created the first time that person saves, so a teammate who has
/// never opened the page has no note at all — the UI shows their tab with an
/// empty box and no "last edited" time, which is the honest state.
///
/// [updatedAt] is the server's clock at the last save (stamped by the
/// `trg_touch_scratchpads` trigger, never the client), so it is the value the
/// page labels "last edited". It is UTC, like every other instant in the app —
/// render it through `InstantFormatter`.
class ScratchpadNote {
  const ScratchpadNote({
    required this.userId,
    required this.body,
    required this.updatedAt,
  });

  final String userId;
  final String body;
  final DateTime updatedAt;

  static ScratchpadNote fromRow(Map<String, dynamic> row) {
    return ScratchpadNote(
      userId: row['user_id'] as String,
      body: parseString(row['body']) ?? '',
      updatedAt: parseDate(row['updated_at']) ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    );
  }

  ScratchpadNote copyWith({String? body, DateTime? updatedAt}) =>
      ScratchpadNote(
        userId: userId,
        body: body ?? this.body,
        updatedAt: updatedAt ?? this.updatedAt,
      );
}
