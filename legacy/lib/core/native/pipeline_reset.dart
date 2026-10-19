/// The parsing and record-keeping half of "a new build can retire a stale
/// local database". No `dart:io` here on purpose, so it is unit-testable on
/// every platform; the file moving lives in `scraper_process_io.dart`
/// ([PipelineDataDir.applyPendingResets]), which is the only caller.
///
/// The problem this solves: `PipelineDataDir.ensureDataDir` copies a shipped
/// file into the writable per-user data folder only if it is not already there
/// -- never overwriting, because that folder holds the team's own edits. So
/// when a build ships a restructured `email_library.db`, or changes a schema in
/// a way that makes an old local `gratovo.db` unreadable, every machine that
/// already ran the previous build keeps the old file forever.
///
/// A blunt "app version changed, wipe the databases" would also throw away
/// files a release did not touch. Instead each release names exactly what it
/// invalidates, in `data/reset_manifest.json` (staged into
/// `pipeline_data_seed/` by scripts/build_windows.ps1 and read straight from
/// there). Each [ResetAction] carries a stable [ResetAction.id]; a machine
/// records the ids it has applied in `data/.applied_resets.json` and runs each
/// unseen one exactly once. "Run" means move, not delete: the named files go
/// into `data/database/_needs_merge/` with a timestamp prefix, logged in
/// `index.json` there, so nothing is lost and the person can merge by hand.
library;

import 'dart:convert';

/// Where the applied-id ledger and the quarantine live, relative to the
/// pipeline data dir. Kept here so the io side and any test agree on them.
const String kResetManifestFileName = 'reset_manifest.json';
const String kAppliedResetsFileName = '.applied_resets.json';
const String kNeedsMergeDirName = '_needs_merge';
const String kQuarantineIndexFileName = 'index.json';

/// The SQLite sidecars that must travel with any `.db` that is moved: a `-wal`
/// can hold committed rows not yet checkpointed into the main file, so moving
/// the `.db` alone can strand the most recent writes (same reasoning as
/// `PipelineDataDir._moveLegacyDatabases`).
const List<String> kSqliteSiblingSuffixes = ['-wal', '-shm'];

/// One release's "this file is now stale" instruction.
class ResetAction {
  const ResetAction({required this.id, required this.paths, this.note});

  /// Stable, unique, human-meaningful -- it ends up in a log line and in the
  /// team's merge board. A date-plus-slug like `2026-09-08-email-lib` reads
  /// well and never collides.
  final String id;

  /// Files to move aside, each relative to the pipeline data dir and using
  /// forward slashes (e.g. `database/email_library.db`). Already validated:
  /// absolute paths and any `..` segment are dropped during parsing, so a
  /// manifest can only ever name something inside the data dir.
  final List<String> paths;

  /// Shown beside the quarantined file in Settings, so whoever picks it up
  /// knows why it was set aside. Optional.
  final String? note;

  /// Parses `reset_manifest.json`. Tolerant by design: this runs on every
  /// launch before the first frame, and a manifest that is malformed, or was
  /// hand-edited badly, must cost zero resets rather than a failed boot. The
  /// caller logs; this just returns what it could make sense of.
  ///
  ///   { "actions": [
  ///       { "id": "2026-09-08-email-lib",
  ///         "paths": ["database/email_library.db"],
  ///         "note": "Library restructured" } ] }
  static List<ResetAction> parseManifest(String jsonText) {
    Object? decoded;
    try {
      decoded = jsonDecode(jsonText);
    } catch (_) {
      return const [];
    }
    if (decoded is! Map) return const [];
    final rawActions = decoded['actions'];
    if (rawActions is! List) return const [];

    final actions = <ResetAction>[];
    final seenIds = <String>{};
    for (final raw in rawActions) {
      if (raw is! Map) continue;
      final id = raw['id'];
      if (id is! String || id.trim().isEmpty) continue;
      if (!seenIds.add(id)) continue; // first wins, later dupes ignored

      final rawPaths = raw['paths'];
      if (rawPaths is! List) continue;
      final paths = <String>[];
      for (final p in rawPaths) {
        final safe = _sanitizeRelativePath(p);
        if (safe != null && !paths.contains(safe)) paths.add(safe);
      }
      if (paths.isEmpty) continue;

      final note = raw['note'];
      actions.add(ResetAction(
        id: id,
        paths: paths,
        note: note is String && note.trim().isNotEmpty ? note.trim() : null,
      ));
    }
    return actions;
  }

  /// A manifest path turned into a safe forward-slash relative path, or null if
  /// it is not one we will act on. Rejects absolute paths (`/x`, `C:\x`,
  /// `\\server\share`), any `.` / `..` segment, and empty results -- a reset
  /// must never be able to reach outside the data dir or name the dir itself.
  static String? _sanitizeRelativePath(Object? value) {
    if (value is! String) return null;
    final s = value.trim().replaceAll('\\', '/');
    if (s.isEmpty) return null;
    if (s.startsWith('/')) return null; // POSIX absolute
    if (RegExp('^[a-zA-Z]:').hasMatch(s)) return null; // Windows drive
    final segments = <String>[];
    for (final seg in s.split('/')) {
      if (seg.isEmpty || seg == '.') continue;
      if (seg == '..') return null;
      segments.add(seg);
    }
    if (segments.isEmpty) return null;
    return segments.join('/');
  }
}

/// One file that a reset moved out of the way, as stored in the quarantine's
/// `index.json` and mirrored (minus nothing sensitive -- these are just paths
/// and times) to the team board.
class QuarantinedFile {
  const QuarantinedFile({
    required this.resetId,
    required this.originalRelPath,
    required this.storedName,
    required this.quarantinedAt,
    this.note,
    this.resolved = false,
  });

  /// Which [ResetAction] set this file aside.
  final String resetId;

  /// The file's path relative to the data dir before it was moved, forward
  /// slashes (e.g. `database/email_library.db`). What the person restores or
  /// merges back into.
  final String originalRelPath;

  /// The file's name now, inside `data/database/_needs_merge/`. Timestamp
  /// prefix keeps successive resets of the same file from colliding and sorts
  /// them oldest-first: `2026-09-08T10-00-00Z__email_library.db`.
  final String storedName;

  /// When the move happened (UTC).
  final DateTime quarantinedAt;

  /// Copied from [ResetAction.note].
  final String? note;

  /// Set once the person has merged or discarded this file from Settings. Kept
  /// in the index rather than deleted so "resolved 3, 1 to go" stays truthful
  /// and a mistaken resolve is recoverable.
  final bool resolved;

  QuarantinedFile copyWith({bool? resolved}) => QuarantinedFile(
        resetId: resetId,
        originalRelPath: originalRelPath,
        storedName: storedName,
        quarantinedAt: quarantinedAt,
        note: note,
        resolved: resolved ?? this.resolved,
      );

  Map<String, Object?> toJson() => {
        'reset_id': resetId,
        'original_rel_path': originalRelPath,
        'stored_name': storedName,
        'quarantined_at': quarantinedAt.toUtc().toIso8601String(),
        if (note != null) 'note': note,
        'resolved': resolved,
      };

  static QuarantinedFile? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final resetId = raw['reset_id'];
    final original = raw['original_rel_path'];
    final stored = raw['stored_name'];
    final at = DateTime.tryParse('${raw['quarantined_at']}');
    if (resetId is! String ||
        original is! String ||
        stored is! String ||
        at == null) {
      return null;
    }
    final note = raw['note'];
    return QuarantinedFile(
      resetId: resetId,
      originalRelPath: original,
      storedName: stored,
      quarantinedAt: at.toUtc(),
      note: note is String && note.isNotEmpty ? note : null,
      resolved: raw['resolved'] == true,
    );
  }

  /// The `2026-09-08T10-00-00Z__` prefix for [when]. `:` is not legal in a
  /// Windows filename, so the ISO time's colons become dashes.
  static String stemFor(DateTime when) =>
      '${when.toUtc().toIso8601String().split('.').first.replaceAll(':', '-')}Z__';
}

/// The whole `data/database/_needs_merge/index.json`: every file any reset has
/// ever moved aside on this machine, resolved or not.
class MergeQuarantineIndex {
  const MergeQuarantineIndex(this.files);

  final List<QuarantinedFile> files;

  static const MergeQuarantineIndex empty = MergeQuarantineIndex([]);

  /// Files still waiting for a person to deal with them.
  List<QuarantinedFile> get pending =>
      files.where((f) => !f.resolved).toList(growable: false);

  int get pendingCount => files.where((f) => !f.resolved).length;

  Map<String, Object?> toJson() => {
        'files': [for (final f in files) f.toJson()],
      };

  String encode() => const JsonEncoder.withIndent('  ').convert(toJson());

  static MergeQuarantineIndex decode(String jsonText) {
    Object? decoded;
    try {
      decoded = jsonDecode(jsonText);
    } catch (_) {
      return empty;
    }
    if (decoded is! Map) return empty;
    final rawFiles = decoded['files'];
    if (rawFiles is! List) return empty;
    return MergeQuarantineIndex([
      for (final raw in rawFiles)
        if (QuarantinedFile.fromJson(raw) case final f?) f,
    ]);
  }

  MergeQuarantineIndex withFile(QuarantinedFile file) =>
      MergeQuarantineIndex([...files, file]);

  /// Returns a copy with [storedName] marked resolved, or this same index
  /// unchanged if nothing matched.
  MergeQuarantineIndex markResolved(String storedName) => MergeQuarantineIndex([
        for (final f in files)
          if (f.storedName == storedName) f.copyWith(resolved: true) else f,
      ]);
}

/// Parses `.applied_resets.json` -- a bare JSON array of id strings. Anything
/// unparseable means "nothing applied yet", which is safe: the worst case is a
/// reset runs a second time, and moving an already-moved file is a no-op
/// because the original is no longer there.
Set<String> parseAppliedResetIds(String jsonText) {
  Object? decoded;
  try {
    decoded = jsonDecode(jsonText);
  } catch (_) {
    return <String>{};
  }
  if (decoded is! List) return <String>{};
  return {
    for (final v in decoded)
      if (v is String) v
  };
}

String encodeAppliedResetIds(Set<String> ids) =>
    const JsonEncoder.withIndent('  ').convert(ids.toList()..sort());
