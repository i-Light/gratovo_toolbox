import 'dart:convert';

import 'package:gratovo_toolbox/core/local_db/local_db_types.dart';
import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/data/models/email_tag.dart';
import 'package:gratovo_toolbox/data/repositories/email_library_repository.dart';

/// The Email Critique Library on top of a [LocalDb].
///
/// No `dart:io` and no `package:sqlite3` here — only SQL — so this file
/// compiles on every platform and its behaviour is testable against any
/// [LocalDb], including an in-memory one. The platform-specific part is
/// exactly the four files in `core/local_db/`, and this is why they are worth
/// having.
class SqliteEmailLibraryRepository implements EmailLibraryRepository {
  const SqliteEmailLibraryRepository(this._db);

  final LocalDb _db;

  @override
  bool get isAvailable => true;

  // ---------------------------------------------------------------------
  // Records
  // ---------------------------------------------------------------------

  @override
  Future<List<EmailRecord>> listRecords({
    required EmailAudience audience,
    String? search,
    List<String> stageTagIds = const [],
    List<String> nicheTagIds = const [],
    EmailRecordSort sort = EmailRecordSort.lastEdited,
    EmailRecordSource? source,
  }) async {
    final where = <String>['audience = ?'];
    final params = <Object?>[audience.storageValue];
    if (source != null) {
      where.add('source = ?');
      params.add(source.storageValue);
    }

    final term = search?.trim().toLowerCase();
    if (term != null && term.isNotEmpty) {
      // LIKE across four columns rather than an FTS table: a study corpus is
      // thousands of rows at the very most, and FTS is a second structure to
      // keep in step with every write for a search that is already instant.
      //
      // The term is bound four times rather than once as a numbered `?1`
      // parameter. Mixing numbered and positional placeholders in one
      // statement makes every `?` fight over the same index — SQLite gives the
      // bare `?` before this clause index 1 too, so `?1` silently rebound the
      // audience.
      where.add(
        r"(lower(subject) LIKE ? ESCAPE '\' "
        r"OR lower(body) LIKE ? ESCAPE '\' "
        r"OR lower(context) LIKE ? ESCAPE '\' "
        r"OR lower(critique) LIKE ? ESCAPE '\')",
      );
      final pattern = '%${escapeLikeTerm(term)}%';
      params.addAll([pattern, pattern, pattern, pattern]);
    }

    // AND semantics: one EXISTS per required tag. The useful question is
    // "cold opens in fitness", not "cold opens or fitness".
    for (final tagId in [...stageTagIds, ...nicheTagIds]) {
      where.add(
        'EXISTS (SELECT 1 FROM email_record_tags rt '
        'WHERE rt.record_id = email_records.id AND rt.tag_id = ?)',
      );
      params.add(tagId);
    }

    // Every option is most-recent-first. `video_date` is a `YYYY-MM-DD`
    // string, so a plain sort is chronological; SQLite drops the NULLs
    // (records with no date yet) to the end under DESC, which is where a
    // missing date belongs.
    //
    // Under `videoDate` the second key is the timecode, descending: a run of
    // emails lifted from one video then reads top-to-bottom in the order they
    // appear in it. `timecode_seconds IS NULL` first pushes the ones with no
    // recorded moment below the ones that have one. `updated_at` is the final
    // tie-break so the order is always total and stable.
    final orderBy = switch (sort) {
      EmailRecordSort.lastEdited => 'updated_at DESC',
      EmailRecordSort.lastCreated => 'created_at DESC',
      EmailRecordSort.videoDate => 'video_date DESC, '
          'timecode_seconds IS NULL, timecode_seconds DESC, updated_at DESC',
    };
    final rows = _db.select(
      'SELECT * FROM email_records WHERE ${where.join(' AND ')} '
      'ORDER BY $orderBy',
      params,
    );
    if (rows.isEmpty) return const [];

    final tags = _tagsFor([for (final row in rows) row['id'] as String]);
    return [
      for (final row in rows)
        _recordFromRow(row, tags[row['id'] as String] ?? const []),
    ];
  }

  @override
  Future<List<EmailRecord>> listRecordsInVideoDateRange({
    required EmailAudience audience,
    required DateTime from,
    required DateTime to,
  }) async {
    // `video_date` is a `YYYY-MM-DD` string, so a BETWEEN on the same format
    // is a chronological comparison - the reason the column is stored that way
    // rather than as an epoch (see the schema). Both ends inclusive: a person
    // picking 1 Jan to 31 Jan means January, all of it.
    //
    // NULLs fail the comparison and drop out on their own, which is the
    // wanted behaviour - a record with no video date is in no range. See the
    // interface for why that is a decision and not an oversight.
    final rows = _db.select(
      'SELECT * FROM email_records '
      'WHERE audience = ? AND video_date IS NOT NULL '
      'AND video_date BETWEEN ? AND ? '
      'ORDER BY video_date ASC, '
      'timecode_seconds IS NULL, timecode_seconds DESC, created_at ASC',
      [
        audience.storageValue,
        formatDateOnly(from),
        formatDateOnly(to),
      ],
    );
    if (rows.isEmpty) return const [];

    final tags = _tagsFor([for (final row in rows) row['id'] as String]);
    return [
      for (final row in rows)
        _recordFromRow(row, tags[row['id'] as String] ?? const []),
    ];
  }

  @override
  Future<EmailVideoDateBounds?> videoDateBounds(EmailAudience audience) async {
    // `video_date` is a `YYYY-MM-DD` string, so MIN and MAX over it are
    // chronological - the same property `listRecordsInVideoDateRange` leans on
    // for its BETWEEN, and the reason the column is stored that way.
    //
    // Both aggregates skip NULLs, so a tab whose records carry no dates comes
    // back as a row of nulls rather than as a false floor - which is exactly
    // the "no bounds" case, and why the return is nullable.
    final rows = _db.select(
      'SELECT min(video_date) AS earliest, max(video_date) AS latest '
      'FROM email_records WHERE audience = ?',
      [audience.storageValue],
    );
    final earliest = parseDateOnly(rows.first['earliest'] as String?);
    final latest = parseDateOnly(rows.first['latest'] as String?);
    if (earliest == null || latest == null) return null;
    return EmailVideoDateBounds(earliest: earliest, latest: latest);
  }

  @override
  Future<EmailRecord?> getRecord(String id) async {
    final rows = _db.select('SELECT * FROM email_records WHERE id = ?', [id]);
    if (rows.isEmpty) return null;
    return _recordFromRow(rows.first, _tagsFor([id])[id] ?? const []);
  }

  @override
  Future<void> saveRecord(EmailRecord record) async {
    _db.transaction(() => _write(record));
  }

  /// The upsert and the tag rows, for a caller already in a transaction.
  void _write(EmailRecord record) {
    _db.execute(_upsertRecordSql, [
      record.id,
      record.audience.storageValue,
      formatDateOnly(record.videoDate),
      record.videoUrl.trim(),
      record.timecodeSeconds,
      record.context,
      record.subject,
      record.body,
      record.critique,
      record.createdAt.toUtc().toIso8601String(),
      record.updatedAt.toUtc().toIso8601String(),
      record.source.storageValue,
      record.sourceRef,
      _jsonObject(record.knobs),
      _jsonObject(record.facts),
      record.verdict?.storageValue,
      record.verdictNote,
      record.verdictAt?.toUtc().toIso8601String(),
    ]);

    // Replace rather than diff. The set is a handful of rows, and "delete,
    // then insert what is now true" cannot drift — an add/remove diff has
    // two separate ways to be subtly wrong.
    _db.execute(
      'DELETE FROM email_record_tags WHERE record_id = ?',
      [record.id],
    );
    for (final tagId in {...record.stageTagIds, ...record.nicheTagIds}) {
      _db.execute(
        'INSERT OR IGNORE INTO email_record_tags (record_id, tag_id) '
        'VALUES (?, ?)',
        [record.id, tagId],
      );
    }
  }

  @override
  Future<int> importRecords(List<EmailRecord> records) async {
    var added = 0;
    // One transaction: a run is imported whole or not at all, so a failure
    // halfway cannot leave half a bench run looking like the whole of it.
    _db.transaction(() {
      for (final record in records) {
        final ref = record.sourceRef;
        if (ref != null &&
            _db.select(
              'SELECT 1 FROM email_records WHERE source_ref = ? LIMIT 1',
              [ref],
            ).isNotEmpty) {
          continue;
        }
        _write(record);
        added += 1;
      }
    });
    return added;
  }

  @override
  Future<void> deleteRecord(String id) async {
    // The join rows go with it through ON DELETE CASCADE — foreign keys are
    // on, see local_db_io.dart.
    _db.execute('DELETE FROM email_records WHERE id = ?', [id]);
  }

  @override
  Future<void> markRecordsCopied(List<String> ids, DateTime at) async {
    if (ids.isEmpty) return;
    final stamp = at.toUtc().toIso8601String();
    // One statement rather than a loop of them, and inside a transaction, so a
    // batch of forty either all carry the same stamp or none do. A half-marked
    // batch would leave the copy dialog describing a copy that never finished.
    final placeholders = List.filled(ids.length, '?').join(', ');
    _db.transaction(() {
      _db.execute(
        'UPDATE email_records SET last_copied_at = ? '
        'WHERE id IN ($placeholders)',
        [stamp, ...ids],
      );
    });
  }

  @override
  Future<Map<EmailAudience, int>> countRecords() async {
    final rows = _db.select(
      'SELECT audience, count(*) AS n FROM email_records GROUP BY audience',
    );
    return {
      for (final audience in EmailAudience.values) audience: 0,
      for (final row in rows)
        EmailAudience.fromStorage(row['audience'] as String):
            (row['n'] as int?) ?? 0,
    };
  }

  // ---------------------------------------------------------------------
  // Tags
  // ---------------------------------------------------------------------

  @override
  Future<List<EmailTag>> listTags(EmailTagKind kind) async {
    final rows = _db.select(
      'SELECT * FROM email_tags WHERE kind = ? ORDER BY sort_order, label_key',
      [kind.storageValue],
    );
    return [for (final row in rows) _tagFromRow(row)];
  }

  @override
  Future<EmailTag> addTag({
    required EmailTagKind kind,
    required String label,
  }) async {
    final trimmed = label.trim();
    final key = trimmed.toLowerCase();

    final existing = _db.select(
      'SELECT * FROM email_tags WHERE kind = ? AND label_key = ?',
      [kind.storageValue, key],
    );
    if (existing.isNotEmpty) return _tagFromRow(existing.first);

    // New tags sort after everything already there, so the seeded stage order
    // survives and a niche added mid-session does not jump to the front of a
    // list somebody is reading.
    final maxRow = _db.select(
      'SELECT max(sort_order) AS m FROM email_tags WHERE kind = ?',
      [kind.storageValue],
    );
    final nextOrder = ((maxRow.first['m'] as int?) ?? -1) + 1;

    final tag = EmailTag(
      id: localUuid(),
      kind: kind,
      label: trimmed,
      sortOrder: nextOrder,
    );
    _db.execute(
      'INSERT INTO email_tags '
      '(id, kind, label, label_key, sort_order, created_at) '
      'VALUES (?, ?, ?, ?, ?, ?)',
      [
        tag.id,
        kind.storageValue,
        tag.label,
        key,
        nextOrder,
        DateTime.now().toUtc().toIso8601String(),
      ],
    );
    return tag;
  }

  @override
  Future<void> renameTag(String id, String label) async {
    final trimmed = label.trim();
    if (trimmed.isEmpty) return;
    _db.execute(
      'UPDATE email_tags SET label = ?, label_key = ? WHERE id = ?',
      [trimmed, trimmed.toLowerCase(), id],
    );
  }

  @override
  Future<void> deleteTag(String id) async {
    _db.execute('DELETE FROM email_tags WHERE id = ?', [id]);
  }

  @override
  Future<Map<String, int>> tagUsageCounts(EmailTagKind kind) async {
    final rows = _db.select(
      'SELECT rt.tag_id AS id, count(*) AS n '
      'FROM email_record_tags rt '
      'JOIN email_tags t ON t.id = rt.tag_id '
      'WHERE t.kind = ? GROUP BY rt.tag_id',
      [kind.storageValue],
    );
    return {
      for (final row in rows) row['id'] as String: (row['n'] as int?) ?? 0,
    };
  }

  // ---------------------------------------------------------------------
  // Sticky defaults
  // ---------------------------------------------------------------------

  @override
  Future<EmailDraftDefaults> readDefaults(EmailAudience audience) async {
    final rows = _db.select(
      'SELECT * FROM email_draft_defaults WHERE audience = ?',
      [audience.storageValue],
    );
    if (rows.isEmpty) return const EmailDraftDefaults();
    final row = rows.first;
    return EmailDraftDefaults(
      videoDate: parseDateOnly(row['video_date'] as String?),
      videoUrl: (row['video_url'] as String?) ?? '',
      timecodeSeconds: row['timecode_seconds'] as int?,
      stageTagIds: _splitIdList(row['stage_tag_ids'] as String?),
    );
  }

  @override
  Future<void> writeDefaults(
    EmailAudience audience,
    EmailDraftDefaults value,
  ) async {
    _db.execute(
      'INSERT INTO email_draft_defaults '
      '(audience, video_date, video_url, timecode_seconds, stage_tag_ids, '
      'updated_at) '
      'VALUES (?, ?, ?, ?, ?, ?) '
      'ON CONFLICT (audience) DO UPDATE SET '
      'video_date       = excluded.video_date, '
      'video_url        = excluded.video_url, '
      'timecode_seconds = excluded.timecode_seconds, '
      'stage_tag_ids    = excluded.stage_tag_ids, '
      'updated_at       = excluded.updated_at',
      [
        audience.storageValue,
        formatDateOnly(value.videoDate),
        value.videoUrl.trim(),
        value.timecodeSeconds,
        value.stageTagIds.join(','),
        DateTime.now().toUtc().toIso8601String(),
      ],
    );
  }

  /// `stage_tag_ids` is a comma-separated id list; an empty or null cell means
  /// no tags. Ids never contain a comma (see the seeded `stage-*` ids), so a
  /// plain split is enough.
  static List<String> _splitIdList(String? raw) {
    final trimmed = raw?.trim() ?? '';
    if (trimmed.isEmpty) return const [];
    return [
      for (final id in trimmed.split(','))
        if (id.trim().isNotEmpty) id.trim(),
    ];
  }

  // ---------------------------------------------------------------------
  // Row mapping
  // ---------------------------------------------------------------------

  /// Every record's tags, with their kinds, in one query — so listing 200
  /// records costs two queries rather than 401.
  Map<String, List<_TagRef>> _tagsFor(List<String> recordIds) {
    if (recordIds.isEmpty) return const {};
    final placeholders = List.filled(recordIds.length, '?').join(', ');
    final rows = _db.select(
      'SELECT rt.record_id, rt.tag_id, t.kind '
      'FROM email_record_tags rt '
      'JOIN email_tags t ON t.id = rt.tag_id '
      'WHERE rt.record_id IN ($placeholders) '
      'ORDER BY t.sort_order, t.label_key',
      recordIds,
    );
    final result = <String, List<_TagRef>>{};
    for (final row in rows) {
      (result[row['record_id'] as String] ??= <_TagRef>[]).add(
        _TagRef(
          row['tag_id'] as String,
          EmailTagKind.fromStorage(row['kind'] as String),
        ),
      );
    }
    return result;
  }

  EmailRecord _recordFromRow(Map<String, Object?> row, List<_TagRef> tags) {
    return EmailRecord(
      id: row['id'] as String,
      audience: EmailAudience.fromStorage(row['audience'] as String),
      videoDate: parseDateOnly(row['video_date'] as String?),
      videoUrl: (row['video_url'] as String?) ?? '',
      timecodeSeconds: row['timecode_seconds'] as int?,
      stageTagIds: [
        for (final tag in tags)
          if (tag.kind == EmailTagKind.stage) tag.id,
      ],
      nicheTagIds: [
        for (final tag in tags)
          if (tag.kind == EmailTagKind.niche) tag.id,
      ],
      context: (row['context'] as String?) ?? '',
      subject: (row['subject'] as String?) ?? '',
      body: (row['body'] as String?) ?? '',
      critique: (row['critique'] as String?) ?? '',
      createdAt: DateTime.parse(row['created_at'] as String),
      updatedAt: DateTime.parse(row['updated_at'] as String),
      lastCopiedAt: _parseInstant(row['last_copied_at'] as String?),
      source: EmailRecordSource.fromStorage(row['source'] as String?),
      sourceRef: row['source_ref'] as String?,
      knobs: {
        for (final entry in _readObject(row['knobs']).entries)
          if (entry.value is String) entry.key: entry.value! as String,
      },
      facts: _readObject(row['facts']),
      verdict: EmailVerdict.fromStorage(row['verdict'] as String?),
      verdictNote: (row['verdict_note'] as String?) ?? '',
      verdictAt: _parseInstant(row['verdict_at'] as String?),
    );
  }

  /// `knobs` / `facts` are JSON objects in a text column; empty is the
  /// column's default and means none, so an empty map is written as that.
  static String _jsonObject(Map<String, Object?> value) =>
      value.isEmpty ? '' : jsonEncode(value);

  /// Lenient, like the factory's reader: a cell that is not a JSON object
  /// (hand-edited, or written by something else) reads as empty rather than
  /// failing the whole list.
  static Map<String, Object?> _readObject(Object? cell) {
    if (cell is! String || cell.trim().isEmpty) return const {};
    try {
      final value = jsonDecode(cell);
      return value is Map ? value.cast<String, Object?>() : const {};
    } on FormatException {
      return const {};
    }
  }

  /// A nullable ISO-8601 timestamp column. Unlike `created_at`, `last_copied_at`
  /// is absent for every record written before v5 of the schema and for every
  /// record never copied, so this tolerates null where [DateTime.parse] would
  /// throw.
  static DateTime? _parseInstant(String? value) {
    if (value == null || value.trim().isEmpty) return null;
    return DateTime.tryParse(value.trim())?.toUtc();
  }

  EmailTag _tagFromRow(Map<String, Object?> row) => EmailTag(
        id: row['id'] as String,
        kind: EmailTagKind.fromStorage(row['kind'] as String),
        label: row['label'] as String,
        sortOrder: (row['sort_order'] as int?) ?? 0,
      );
}

/// A tag id paired with the vocabulary it came from, which is what lets one
/// query fill both id lists on [EmailRecord].
class _TagRef {
  const _TagRef(this.id, this.kind);
  final String id;
  final EmailTagKind kind;
}

const _upsertRecordSql = '''
INSERT INTO email_records
  (id, audience, video_date, video_url, timecode_seconds,
   context, subject, body, critique, created_at, updated_at,
   source, source_ref, knobs, facts, verdict, verdict_note, verdict_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET
  audience         = excluded.audience,
  video_date       = excluded.video_date,
  video_url        = excluded.video_url,
  timecode_seconds = excluded.timecode_seconds,
  context          = excluded.context,
  subject          = excluded.subject,
  body             = excluded.body,
  critique         = excluded.critique,
  updated_at       = excluded.updated_at,
  source           = excluded.source,
  source_ref       = excluded.source_ref,
  knobs            = excluded.knobs,
  facts            = excluded.facts,
  verdict          = excluded.verdict,
  verdict_note     = excluded.verdict_note,
  verdict_at       = excluded.verdict_at
''';

/// `YYYY-MM-DD`, or null. Date only — see [EmailRecord.videoDate] for why a
/// publication day never becomes an instant.
///
/// Public so the in-memory implementation and the tests round-trip dates
/// through exactly the same pair of functions the SQLite one does.
String? formatDateOnly(DateTime? date) {
  if (date == null) return null;
  final month = date.month.toString().padLeft(2, '0');
  final day = date.day.toString().padLeft(2, '0');
  return '${date.year.toString().padLeft(4, '0')}-$month-$day';
}

/// Parses what [formatDateOnly] wrote, tolerating a full ISO timestamp in case
/// a row was written by something other than this app.
DateTime? parseDateOnly(String? value) {
  if (value == null || value.trim().isEmpty) return null;
  final parsed = DateTime.tryParse(value.trim());
  if (parsed == null) return null;
  return DateTime(parsed.year, parsed.month, parsed.day);
}

/// Escapes the LIKE wildcards in a typed search term, so searching for `100%`
/// finds `100%` rather than every record in the tab.
///
/// Pairs with the `ESCAPE '\'` clause on every LIKE above — SQLite's LIKE has
/// no escape character until one is named, so this and that clause are a
/// single decision and neither works without the other. The backslash itself
/// is escaped first, or a term containing one would consume the character
/// after it.
String escapeLikeTerm(String term) =>
    term.replaceAll(r'\', r'\').replaceAll('%', r'\%').replaceAll('_', r'\_');
