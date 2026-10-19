import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// One teammate's outstanding local merges: a `public.client_merge_status` row.
///
/// When a build ships a `reset_manifest.json` action that retires a bundled
/// database, each machine moves the stale file into a quarantine folder rather
/// than deleting it (see `lib/core/native/pipeline_reset.dart`) and upserts
/// this row so the rest of the team can see who still has files to reconcile.
/// The row is created lazily on the first launch that has anything to report,
/// so a teammate with nothing pending simply has no row — [pendingCount] 0 and
/// an empty [entries] for the UI's purposes.
///
/// [updatedAt] is the server clock at the last change (the
/// `trg_touch_client_merge_status` trigger, never the client), so it is the
/// "last updated" the board shows. UTC, like every instant in the app — render
/// it through `InstantFormatter`.
class ClientMergeStatus {
  const ClientMergeStatus({
    required this.userId,
    required this.pendingCount,
    required this.entries,
    required this.updatedAt,
  });

  final String userId;

  /// Denormalised count of unresolved files, so the common read (a number per
  /// teammate) needs no list work. Always equals `entries.length` as written,
  /// but read defensively — an older client could have written one without the
  /// other.
  final int pendingCount;

  final List<MergeStatusEntry> entries;

  final DateTime updatedAt;

  bool get hasPending => pendingCount > 0 || entries.isNotEmpty;

  static ClientMergeStatus fromRow(Map<String, dynamic> row) {
    final rawEntries = row['entries'];
    return ClientMergeStatus(
      userId: row['user_id'] as String,
      pendingCount: parseInt(row['pending_count']) ?? 0,
      entries: [
        if (rawEntries is List)
          for (final e in rawEntries)
            if (MergeStatusEntry.fromJson(e) case final entry?) entry,
      ],
      updatedAt: parseDate(row['updated_at']) ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    );
  }
}

/// One quarantined file, as it appears on the shared board — just the path, the
/// time, and the release note. No machine-local detail (the stored filename,
/// the on-disk location) travels: the board is "who has work to do", not a
/// remote file browser.
class MergeStatusEntry {
  const MergeStatusEntry({
    required this.path,
    required this.quarantinedAt,
    this.note,
  });

  /// The file's path relative to the pipeline data dir, e.g.
  /// `database/email_library.db`.
  final String path;

  final DateTime quarantinedAt;

  /// From the `reset_manifest.json` action that set it aside.
  final String? note;

  Map<String, Object?> toJson() => {
        'path': path,
        'quarantined_at': quarantinedAt.toUtc().toIso8601String(),
        if (note != null) 'note': note,
      };

  static MergeStatusEntry? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final path = raw['path'];
    final at = parseDate(raw['quarantined_at']);
    if (path is! String || path.isEmpty || at == null) return null;
    final note = raw['note'];
    return MergeStatusEntry(
      path: path,
      quarantinedAt: at,
      note: note is String && note.isNotEmpty ? note : null,
    );
  }
}
