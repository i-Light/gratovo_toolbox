import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/archived_channel.dart';
import 'package:gratovo_toolbox/data/models/bulk_archive_due.dart';
import 'package:gratovo_toolbox/data/models/bulk_rejection.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/keyword_view_sample.dart';
import 'package:gratovo_toolbox/data/repositories/archive_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/local_archive.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_mapping.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// The archive, read from and written to the local database.
///
/// The pipeline owns `channel_archive` (it is the tombstone its discovery
/// step consults), and the catalog log is how one machine's tombstones reach
/// the others. This repository's writes go through `local_archive.dart`, so
/// the R2 side — deleting the object, announcing the row — is queued for the
/// pipeline the same way whether one row was relabelled or three thousand
/// were swept.
///
/// The bulk tools used to be two Postgres functions, chosen so that "the
/// count the person confirmed" and "the rows that move" were one snapshot.
/// The same holds here for a simpler reason: the only writer to the tables
/// they scan is this process, and a search run adds rows only between the
/// dry run and the real one if a person lets it — which is what
/// `BulkRejectionRequest.firstSeenAfter` is for.
class MirrorArchiveRepository implements ArchiveRepository {
  const MirrorArchiveRepository(this._db);

  final LocalSyncDb _db;

  @override
  Future<List<ArchivedChannel>> getPage({
    required int offset,
    required int limit,
    ArchiveQuery query = const ArchiveQuery(),
  }) async {
    final where = <String>[];
    final params = <Object?>[];

    final search = query.search.trim();
    if (search.isNotEmpty) {
      // The handle is the only text the archive keeps, so it is the only thing
      // there is to search. LIKE's own wildcards are stripped for the same
      // reason the influencer list strips them.
      final safe = search.replaceAll(RegExp(r'[%_\\]'), ' ').trim();
      if (safe.isNotEmpty) {
        where.add('LOWER(handle) LIKE ?');
        params.add('%${safe.toLowerCase()}%');
      }
    }
    if (query.label != null) {
      where.add('label = ?');
      params.add(query.label!.wire);
    }

    // `subscribers` is text on the pipeline's table (the count as YouTube
    // returned it), so sorting on it has to go through the same cast the
    // influencer view uses, or "9" sorts after "10000".
    final sort = switch (query.sortBy) {
      ArchiveSortBy.subscribers =>
        "CAST(NULLIF(REPLACE(subscribers, ',', ''), '') AS INTEGER)",
      _ => query.sortBy.column,
    };
    final direction = query.descending ? 'DESC' : 'ASC';
    final sql = StringBuffer('SELECT * FROM channel_archive')
      ..write(where.isEmpty ? '' : ' WHERE ${where.join(' AND ')}')
      // Nulls last under both directions: a channel with no recorded
      // subscriber count sorts to the bottom rather than reading as the
      // smallest value.
      ..write(' ORDER BY $sort $direction NULLS LAST')
      // channel_id breaks ties, so two rows archived in the same sweep cannot
      // swap places between page requests and show one twice.
      ..write(', channel_id ASC LIMIT ? OFFSET ?');
    params
      ..add(limit)
      ..add(offset);

    final rows = await _db.getAll(sql.toString(), params);
    return [for (final row in rows) _toArchived(row)];
  }

  @override
  Future<List<ArchivedChannel>> getAll() async {
    // The whole table in one read, newest first. No WHERE, no LIMIT: the caller
    // (keyword evaluation) needs every row, and this table is short by design —
    // see [ArchivedChannel]'s doc for why.
    final rows = await _db.getAll(
      'SELECT * FROM channel_archive ORDER BY archived_at DESC, channel_id ASC',
    );
    return [for (final row in rows) _toArchived(row)];
  }

  @override
  Future<List<KeywordViewSample>> keywordViewSamples() async {
    // `found_via` is a JSON array of `{keyword, limit, discovered_at}`,
    // unnested with `json_each`. The `json_valid` guard is for a row somebody
    // edited by hand: `json_each` raises on malformed text, where the Dart
    // decoder in [_parseFoundVia] would have quietly read it as no keywords,
    // and this read must not be stricter than that one.
    //
    // An unmeasured median is zero, not left out — see [KeywordViewSample].
    // The archive is where that matters most: the auto-clean gate tombstones
    // a too-small channel before its videos are fetched, so the rows with no
    // median are precisely the ones a keyword should be marked down for.
    final rows = await _db.getAllOffThread(
      "SELECT json_extract(j.value, '\$.keyword') AS keyword, "
      '  COALESCE(a.median_views_last_30, 0) AS views '
      'FROM channel_archive a, '
      '  json_each(CASE WHEN json_valid(a.found_via) THEN a.found_via '
      "            ELSE '[]' END) AS j",
    );
    return [
      for (final row in rows)
        if (parseInt(row['views']) case final views?)
          KeywordViewSample(
            keyword: parseString(row['keyword']) ?? '',
            medianViews: views,
          ),
    ];
  }

  @override
  Future<int> count() async {
    final rows = await _db.getAll('SELECT COUNT(*) AS n FROM channel_archive');
    return parseInt(rows.first['n']) ?? 0;
  }

  @override
  Future<Set<String>> archivedIdsAmong(List<String> channelIds) async {
    if (channelIds.isEmpty) return const {};
    final found = <String>{};
    // Chunked like every other bulk id lookup here — see [_writeBatch]'s doc
    // comment for why one placeholder per id is not safe to assume stays
    // under SQLite's bound-variable ceiling.
    for (final chunk in _chunks(channelIds, _writeBatch)) {
      final placeholders = List.filled(chunk.length, '?').join(', ');
      final rows = await _db.getAll(
        'SELECT channel_id FROM channel_archive '
        'WHERE channel_id IN ($placeholders)',
        chunk,
      );
      for (final row in rows) {
        if (row['channel_id'] != null) found.add(row['channel_id'] as String);
      }
    }
    return found;
  }

  @override
  Future<void> updateLabel(String channelId, ChannelTag label) async {
    if (!ChannelTag.rejecting.contains(label)) {
      throw ArgumentError.value(label, 'label', 'must be a rejecting tag');
    }
    // `archiveChannelsLocally` on a channel that is already a tombstone is
    // exactly a relabel: the row keeps its date, count and keywords, only the
    // label changes, and the pipeline re-announces it.
    await archiveChannelsLocally(
      _db,
      [(channelId: channelId, label: label.wire)],
    );
  }

  @override
  Future<void> unarchive(String channelId) async {
    // Removing the tombstone is the whole operation — there is nothing to
    // restore, because the videos, notes and contacts went when the channel
    // was archived. What comes back is a bare row flagged for a fresh scrape.
    await restoreChannelsLocally(_db, [channelId]);
  }

  @override
  Future<BulkRejectionOutcome> bulkReject(
    BulkRejectionRequest request, {
    bool dryRun = true,
    void Function(int swept, int total)? onSweepProgress,
    bool Function()? shouldStop,
  }) async {
    if (!ChannelTag.rejecting.contains(request.label)) {
      throw ArgumentError.value(
          request.label, 'label', 'must be a rejecting tag');
    }
    if (!request.isValid) {
      throw ArgumentError(
          'a bulk rejection needs at least one subscriber, median-views or '
          'videos bound');
    }

    final scanned = await _scan(
      minSubscribers: request.minSubscribers,
      maxSubscribers: request.maxSubscribers,
      minMedianViews: request.minMedianViews,
      maxMedianViews: request.maxMedianViews,
      minVideosLast30: request.minVideosLast30,
      firstSeenAfter: request.firstSeenAfter,
      untouchedOnly: request.untouchedOnly,
      dueOnly: false,
    );

    var skippedUnknown = 0;
    var skippedTagged = 0;
    var skippedProtected = 0;
    final ids = <String>[];
    for (final row in scanned) {
      if (!row.rejected && row.sizeUnknown) skippedUnknown++;
      if (row.rejected && row.inRange) skippedTagged++;
      if (!row.rejected && row.inRange) {
        if (row.protected) {
          skippedProtected++;
        } else {
          ids.add(row.channelId);
        }
      }
    }

    var outcome = BulkRejectionOutcome(
      matched: ids.length,
      tagged: 0,
      archived: 0,
      skippedAlreadyTagged: skippedTagged,
      skippedProtected: skippedProtected,
      skippedUnknownSize: skippedUnknown,
    );
    if (dryRun || ids.isEmpty) return outcome;

    final now = DateTime.now().toUtc();
    final due = request.immediate ? now : now.add(const Duration(days: 7));
    await _tag(
      ids,
      tags: [request.label.wire],
      archiveDueAt: due.toIso8601String(),
    );
    outcome = BulkRejectionOutcome(
      matched: ids.length,
      tagged: ids.length,
      archived: 0,
      skippedAlreadyTagged: skippedTagged,
      skippedProtected: skippedProtected,
      skippedUnknownSize: skippedUnknown,
      pendingIds: request.immediate ? ids : const [],
    );
    if (!request.immediate) return outcome;

    final swept = await _sweep(
      {for (final id in ids) id: request.label.wire},
      onSweepProgress,
      shouldStop,
      verb: 'tagged',
    );
    return outcome.copyWith(archived: swept, pendingIds: const []);
  }

  @override
  Future<BulkArchiveDueOutcome> bulkManageArchiveDue(
    BulkArchiveDueRequest request, {
    bool dryRun = true,
    void Function(int swept, int total)? onSweepProgress,
    bool Function()? shouldStop,
  }) async {
    final scanned = await _scan(
      minSubscribers: request.minSubscribers,
      maxSubscribers: request.maxSubscribers,
      minMedianViews: request.minMedianViews,
      maxMedianViews: request.maxMedianViews,
      minVideosLast30: request.minVideosLast30,
      firstSeenAfter: null,
      untouchedOnly: false,
      dueOnly: true,
    );

    var skippedUnknown = 0;
    var skippedProtected = 0;
    final labels = <String, String>{};
    for (final row in scanned) {
      // Due means "rejected and counting down"; a row with a date but no
      // rejecting tag is a stale countdown, not a candidate.
      if (!row.rejected) continue;
      // A label filter narrows which due reason this run touches -- a channel
      // due for a different rejecting tag is simply not this run's business,
      // the same as a channel outside the size range is, so it is left out
      // silently rather than counted against any of the skip reasons below.
      if (request.label != null && !row.tags.contains(request.label!.wire)) {
        continue;
      }
      if (row.sizeUnknown) skippedUnknown++;
      if (row.inRange) {
        if (row.protected) {
          skippedProtected++;
        } else {
          labels[row.channelId] = row.label ?? ChannelTag.irrelevant.wire;
        }
      }
    }
    final ids = labels.keys.toList();

    var outcome = BulkArchiveDueOutcome(
      matched: ids.length,
      updated: 0,
      archived: 0,
      skippedProtected: skippedProtected,
      skippedUnknown: skippedUnknown,
    );
    if (dryRun || ids.isEmpty) return outcome;

    switch (request.action) {
      case ArchiveDueAction.undo:
        // Clearing the tags is what "keep this channel after all" means for
        // one row, done to many at once; the countdown goes with them, the
        // same as the server's trigger would clear it.
        await _tag(ids, tags: const [], archiveDueAt: null);
        return BulkArchiveDueOutcome(
          matched: ids.length,
          updated: ids.length,
          archived: 0,
          skippedProtected: skippedProtected,
          skippedUnknown: skippedUnknown,
        );
      case ArchiveDueAction.archiveNow:
        final now = DateTime.now().toUtc().toIso8601String();
        await _tag(ids, tags: null, archiveDueAt: now);
        outcome = BulkArchiveDueOutcome(
          matched: ids.length,
          updated: ids.length,
          archived: 0,
          skippedProtected: skippedProtected,
          skippedUnknown: skippedUnknown,
          pendingIds: ids,
        );
        final swept =
            await _sweep(labels, onSweepProgress, shouldStop, verb: 'due');
        return outcome.copyWith(archived: swept, pendingIds: const []);
    }
  }

  /// One pass over the influencer view for the rows a bulk tool could touch:
  /// everything in range, plus everything whose size cannot be judged, with
  /// the facts each decision needs read alongside.
  ///
  /// The range test is SQL so the database walks its indexes; the tag test is
  /// Dart because `channel_tags` is JSON text and "every tag is a rejecting
  /// one" is easier to say — and to read back later — in a language with
  /// sets.
  Future<List<_Candidate>> _scan({
    required int? minSubscribers,
    required int? maxSubscribers,
    required int? minMedianViews,
    required int? maxMedianViews,
    required int? minVideosLast30,
    required DateTime? firstSeenAfter,
    required bool untouchedOnly,
    required bool dueOnly,
  }) async {
    // Bounds are integers typed by the person and checked as such by Dart, so
    // they can go into the text safely; the date is a parameter.
    final range = <String>[
      if (minSubscribers != null) 'subscribers >= $minSubscribers',
      if (maxSubscribers != null) 'subscribers <= $maxSubscribers',
      // Unmeasured (NULL) counts as zero, the same rule the dashboard's
      // view-tier chart and `videos_last_30` just above already follow: the
      // auto-clean gate archives a too-small channel before its videos are
      // ever fetched, so a null median here is not "we don't know yet", it is
      // "this channel is dead on arrival" -- exactly the population a
      // median-views clean is meant to reach. Treating it as unknown (as this
      // used to) meant the very channels that make up a chart's <10K bucket
      // could never be matched by a clean aimed at that bucket.
      if (minMedianViews != null)
        'COALESCE(median_views_last_30, 0) >= $minMedianViews',
      if (maxMedianViews != null)
        'COALESCE(median_views_last_30, 0) <= $maxMedianViews',
      if (minVideosLast30 != null)
        'COALESCE(videos_last_30, 0) < $minVideosLast30',
    ];
    final inRange = range.isEmpty ? '1' : 'COALESCE(${range.join(' AND ')}, 0)';
    final unknown = <String>[
      // Subscribers are known from the moment a channel is discovered, before
      // any median is possible -- a null one really is missing data (YouTube
      // hides it, or the row has not synced yet), not a size judgement this
      // scan can make for itself the way it can for an unmeasured median.
      if (minSubscribers != null || maxSubscribers != null)
        'subscribers IS NULL',
    ];
    final sizeUnknown = unknown.isEmpty ? '0' : '(${unknown.join(' OR ')})';

    final where = <String>['(in_range OR size_unknown)'];
    final params = <Object?>[];
    if (firstSeenAfter != null) {
      where.add('first_seen_at >= ?');
      // UTC on the wire: `first_seen_at` is written by the pipeline as a UTC
      // instant, and a local-time string would shift the window by the
      // machine's offset — in the direction that sweeps channels the run
      // never found.
      params.add(firstSeenAfter.toUtc().toIso8601String());
    }
    if (dueOnly) where.add('archive_due_at IS NOT NULL');
    // The view already COALESCEs the three state columns to their defaults
    // for a channel with no `channel_state` row at all, so "untouched" is one
    // test whether or not anyone ever opened the row. `json_array_length`
    // rather than a literal `'[]'` compare, so a tag list that was cleared
    // back to empty — however it was spelled — still reads as no tags; and a
    // column that is not valid JSON reads as *touched*, since an unattended
    // sweep should skip a row it cannot read rather than guess it is blank.
    if (untouchedOnly) {
      where.add(
        "vetting_status = 'newlyFound' AND pipeline_stage = 'new' "
        'AND json_valid(channel_tags) AND json_array_length(channel_tags) = 0',
      );
    }

    final rows = await _db.getAll(
      'SELECT channel_id, channel_tags, in_range, size_unknown, '
      '  (EXISTS (SELECT 1 FROM deals d WHERE d.channel_id = x.channel_id) '
      '   OR EXISTS (SELECT 1 FROM outreach_threads t '
      '              WHERE t.channel_id = x.channel_id)) AS protected '
      'FROM (SELECT channel_id, channel_tags, first_seen_at, archive_due_at, '
      '        vetting_status, pipeline_stage, '
      '        ($inRange) AS in_range, ($sizeUnknown) AS size_unknown '
      '      FROM influencer_channels) x '
      'WHERE ${where.join(' AND ')} '
      // Deterministic, so the sweep's batches — and the progress somebody is
      // watching — go in the same order every run rather than in whichever
      // order the planner's chosen index happens to walk.
      'ORDER BY channel_id',
      params,
    );
    return [
      for (final row in rows)
        _Candidate(
          channelId: parseString(row['channel_id']) ?? '',
          tags: decodeStringList(row['channel_tags']),
          inRange: parseInt(row['in_range']) == 1,
          sizeUnknown: parseInt(row['size_unknown']) == 1,
          protected: parseInt(row['protected']) == 1,
        ),
    ];
  }

  /// Writes the tags and/or countdown onto every listed channel's state row,
  /// creating rows for channels nobody had touched, and queues the same for
  /// the team as one outbox entry.
  ///
  /// [tags] null leaves the tags as they are (the archive-now case only moves
  /// the date); [archiveDueAt] null clears the countdown.
  Future<void> _tag(
    List<String> ids, {
    required List<String>? tags,
    required String? archiveDueAt,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();
    final queued = <Map<String, Object?>>[];
    for (final chunk in _chunks(ids, _writeBatch)) {
      // See `local_archive.dart`'s `_yieldToUi` for why this loop needs a real
      // event-loop yield, not just an `await` on an already-completed Future:
      // this database is synchronous FFI on the UI isolate, and enough chunks
      // in a row otherwise reads as a frozen app.
      await Future.delayed(Duration.zero);
      final placeholders = List.filled(chunk.length, '?').join(', ');
      final handles = await _db.getAll(
        'SELECT channel_id, handle FROM channels '
        'WHERE channel_id IN ($placeholders)',
        chunk,
      );
      final tagText = tags == null ? null : encodeJsonColumn(tags);
      // `WHERE true` on the SELECT is SQLite's rule for an INSERT…SELECT
      // with an upsert clause, not a stray.
      await _db.execute(
        'INSERT INTO channel_state '
        '(channel_id, handle, channel_tags, archive_due_at, updated_at) '
        'SELECT channel_id, handle, ?, ?, ? FROM channels '
        'WHERE channel_id IN ($placeholders) '
        'ON CONFLICT(channel_id) DO UPDATE SET '
        '  channel_tags = COALESCE(?, channel_state.channel_tags), '
        '  archive_due_at = excluded.archive_due_at, '
        '  updated_at = excluded.updated_at',
        [tagText ?? '[]', archiveDueAt, now, ...chunk, tagText],
      );
      for (final row in handles) {
        queued.add({
          'channel_id': row['channel_id'],
          'handle': row['handle'],
          if (tags != null) 'channel_tags': tags,
          'archive_due_at': archiveDueAt,
        });
      }
    }
    await enqueueRowUpsertMany(_db, table: 'channel_state', rows: queued);
  }

  /// Deletes the channels a bulk tool just made due, a batch at a time, with
  /// progress between batches.
  ///
  /// The tags and dates are already written when this starts, and that is what
  /// makes the loop safe to interrupt: every id here is rejected and past its
  /// archive date, so a batch that never runs is a channel the ordinary sweep
  /// takes on the next tick rather than a channel left in limbo. Failing
  /// loudly still matters — somebody watching a confirmed delete deserves to
  /// know it did not finish — which is what [BulkSweepFailure] is for.
  Future<int> _sweep(
    Map<String, String> labels,
    void Function(int swept, int total)? onProgress,
    bool Function()? shouldStop, {
    required String verb,
  }) async {
    final ids = labels.keys.toList();
    var swept = 0;
    onProgress?.call(0, ids.length);
    for (final batch in sweepBatches(ids)) {
      // Between batches, never inside one.
      if (shouldStop?.call() ?? false) break;
      try {
        swept += await archiveChannelsLocally(_db, [
          for (final id in batch) (channelId: id, label: labels[id]!),
        ]);
      } catch (error) {
        throw BulkSweepFailure(
          swept: swept,
          total: ids.length,
          cause: error,
          verb: verb,
        );
      }
      onProgress?.call(swept, ids.length);
    }
    return swept;
  }

  /// How many channels one local delete batch takes: small enough that
  /// progress moves, large enough that a few thousand is a few dozen steps.
  static const _sweepBatch = 50;

  /// How many ids one SQL statement names. Well under SQLite's bound-variable
  /// ceiling.
  static const _writeBatch = 500;

  /// The ids split into the batches that will be deleted.
  ///
  /// Visible to tests because the off-by-one that matters here is silent: a
  /// loop that drops the last partial batch leaves channels tagged, due and
  /// undeleted, and the only sign is a count being lower than the one that
  /// was confirmed.
  @visibleForTesting
  static List<List<String>> sweepBatches(
    List<String> ids, {
    int size = _sweepBatch,
  }) =>
      _chunks(ids, size);

  static List<List<String>> _chunks(List<String> ids, int size) => [
        for (var start = 0; start < ids.length; start += size)
          ids.sublist(start, math.min(start + size, ids.length)),
      ];

  static ArchivedChannel _toArchived(Map<String, Object?> row) {
    return ArchivedChannel(
      channelId: parseString(row['channel_id']) ?? '',
      handle: parseString(row['handle']) ?? '',
      // Only the rejecting tags are ever written here, so anything else means
      // a database somebody edited by hand. Falling back to `irrelevant` keeps
      // the page rendering; treating it as the harsher label would be putting
      // words in someone's mouth.
      label: ChannelTag.fromWire(parseString(row['label'])) ??
          ChannelTag.irrelevant,
      archivedAt: parseDate(row['archived_at']) ?? DateTime.now().toUtc(),
      subscriberCount: parseInt(row['subscribers']),
      medianViewsLast30: parseInt(row['median_views_last_30']),
      medianBasis: parseString(row['median_basis']),
      videosFound: parseInt(row['videos_found_count']),
      foundAt: parseDate(row['found_at']),
      foundVia: _parseFoundVia(row['found_via']),
    );
  }
}

/// One row a bulk tool looked at.
class _Candidate {
  const _Candidate({
    required this.channelId,
    required this.tags,
    required this.inRange,
    required this.sizeUnknown,
    required this.protected,
  });

  final String channelId;
  final List<String> tags;
  final bool inRange;
  final bool sizeUnknown;

  /// Somebody has a deal or an outreach thread with them. A rejected channel
  /// the agency has actually negotiated with is a contradiction for a human
  /// to settle, and archiving it would cascade the negotiation away.
  final bool protected;

  /// Carries at least one tag, and every tag is a rejecting one — the same
  /// rule the server's `channel_is_rejected` applied.
  bool get rejected =>
      tags.isNotEmpty &&
      tags.every((wire) {
        final tag = ChannelTag.fromWire(wire);
        return tag != null && ChannelTag.rejecting.contains(tag);
      });

  /// The label it would be archived under: the strongest rejecting tag it
  /// carries, per [ChannelTag.rejecting]'s order.
  String? get label {
    for (final tag in ChannelTag.rejecting) {
      if (tags.contains(tag.wire)) return tag.wire;
    }
    return null;
  }
}

/// The pipeline stores `found_via` as JSON text — see `mirror_mapping.dart`.
List<ArchiveKeywordHit> _parseFoundVia(Object? raw) {
  final decoded = decodeJsonColumn(raw);
  if (decoded is! List) return const [];
  return [
    for (final item in decoded)
      if (item is Map)
        ArchiveKeywordHit(
          keyword: parseString(item['keyword']) ?? '',
          limit: parseInt(item['limit']),
          discoveredAt: parseDate(item['discovered_at']),
        ),
  ];
}
