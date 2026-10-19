import 'dart:math' as math;

import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/core/utils/blank.dart';
import 'package:gratovo_toolbox/data/models/edit_conflict.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/data/models/keyword_view_sample.dart';
import 'package:gratovo_toolbox/data/models/media_kit.dart';
import 'package:gratovo_toolbox/data/models/sponsor_sighting.dart';
import 'package:gratovo_toolbox/data/models/video.dart';
import 'package:gratovo_toolbox/data/repositories/edit_cas.dart';
import 'package:gratovo_toolbox/data/repositories/influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/local_archive.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_mapping.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// Who is making the edits, for the conflict rows this machine files itself.
///
/// Snapshotted as a name as well as an id, for the same reason `activity_log`
/// and `edit_conflicts` both do it: the account may be gone before anyone
/// resolves the conflict, and "conflicts with an edit by (deleted)" is not
/// something a person can act on.
class SyncActor {
  const SyncActor({this.id, required this.name});

  final String? id;
  final String name;
}

/// Reads and writes the local database — the only place the app reads a
/// channel from.
///
/// A channel is two rows in two tables owned by two programs: the pipeline's
/// `channels` (scraped facts, rollups, R2 bookkeeping) and this app's
/// `channel_state` (everything a person typed). The `influencer_channels`
/// view (`mirror_schema.dart`) joins them into the column shape
/// `influencer_rows` used to have on the server, so every read below is a
/// query against that view and every write is an upsert into
/// `channel_state`. The pipeline's row is never written here except by
/// [create], for a channel added by hand that no search has found.
///
/// **Every write is a compare-and-set, decided locally and again on the
/// server.** The local decision is what lets an edit be accepted or refused
/// instantly and offline; the server's is what makes it true for the team.
/// They use the same rules — [decideEdit] and `apply_channel_edit` are the
/// same decision table — so the usual case is that the server agrees. When it
/// does not, because somebody else's edit landed while this one sat in the
/// upload queue, the server files the conflict and it syncs back down.
class MirrorInfluencerRepository implements InfluencerRepository {
  const MirrorInfluencerRepository(this._db, {required this.actor});

  final LocalSyncDb _db;
  final SyncActor actor;

  /// The columns the model reads, off the view. `days_since_last_deal` is
  /// computed here with `julianday()` — it parses the ISO stamps the tables
  /// hold and `CAST(... AS INTEGER)` truncates the way the old view did.
  static const _rowSelect = '''
SELECT c.channel_id, c.handle, c.name, c.link, c.description,
       c.profile_picture, c.banner, c.subscribers, c.country, c.notes,
       c.relevance_criteria, c.provided_data, c.vetting_status,
       c.pipeline_stage, c.channel_tags, c.contacts,
       c.last_deal_at, c.first_seen_at, c.last_fetched_at, c.archive_due_at,
       CASE WHEN c.last_deal_at IS NULL THEN NULL
            ELSE CAST(julianday('now') - julianday(c.last_deal_at) AS INTEGER)
       END                                       AS days_since_last_deal,
       c.videos_last_30, c.median_views_last_30, c.latest_upload_at,
       c.outreach_outbound_count, c.owner_id, c.manual_engagement_rate,
       c.manual_engagement_note, c.manual_engagement_updated_at,
       c.sponsored_ratio, c.seen_brands, c.found_emails, c.media_kit,
       c.creator_gender
  FROM influencer_channels c
''';

  /// The quick filters, as SQL over the view. `readyToPitch` is
  /// `PitchReadiness` (media_kit.dart) written out, with the same constants;
  /// the repository test checks both against the same rows.
  static final Map<InfluencerFlag, String> _flagSql = {
    InfluencerFlag.hasEmail:
        "(json_array_length(COALESCE(c.found_emails, '[]')) > 0 OR EXISTS "
            "(SELECT 1 FROM json_each(COALESCE(c.contacts, '[]')) "
            "WHERE json_extract(json_each.value, '\$.method') = 'email'))",
    InfluencerFlag.sponsored: 'c.sponsored_ratio > 0',
    InfluencerFlag.shortlisted: "c.vetting_status = 'shortlisted'",
    InfluencerFlag.readyToPitch: '(c.media_kit IS NOT NULL '
        "AND COALESCE(c.creator_gender, '') NOT IN ('female', 'couple') "
        "AND COALESCE(json_array_length(c.media_kit, '\$.countries'), 0) > 0 "
        "AND COALESCE(json_extract(c.media_kit, '\$.ageBand'), '') != '' "
        "AND EXISTS (SELECT 1 FROM json_each(c.media_kit, '\$.rates') r "
        "WHERE json_extract(r.value, '\$.agreed') = 1) "
        "AND (SELECT COALESCE(SUM(json_extract(x.value, '\$.pct')), 0) "
        "FROM json_each(c.media_kit, '\$.countries') x "
        "WHERE upper(json_extract(x.value, '\$.code')) IN "
        "(${kDefaultBrandCountries.map((code) => "'$code'").join(', ')})) "
        '>= ${kAgencyNicheIsTech ? kAudienceShareTech : kAudienceShareGood})',
    InfluencerFlag.neverContacted: 'COALESCE(c.outreach_outbound_count, 0) = 0',
  };

  /// `?, ?, ?` for an `IN (...)` list of [count] bound parameters.
  static String _placeholders(int count) => List.filled(count, '?').join(',');

  @override
  Future<List<Influencer>> getAll() async {
    final rows = await _db.getAll(
      '$_rowSelect ORDER BY c.first_seen_at DESC NULLS LAST',
    );
    return _withKeywords(rows);
  }

  @override
  Future<int> countByVettingStatus(VettingStatus status) async {
    // `idx_channels_stage` is on `pipeline_stage`, not on this column, so this
    // is a scan of `channels` — but of one column of one table on local disk,
    // with no rows crossing an isolate boundary. The Supabase path answers the
    // same question over the network; this one answers it while offline.
    final rows = await _db.getAll(
      'SELECT COUNT(*) AS n FROM influencer_channels WHERE vetting_status = ?',
      [status.name],
    );
    if (rows.isEmpty) return 0;
    return (rows.first['n'] as int?) ?? 0;
  }

  @override
  Future<List<KeywordViewSample>> keywordViewSamples() async {
    // Straight off the tables rather than the view: the view's per-row
    // outreach subquery and casts are for the list, and this needs two
    // columns and a flag. Same population as the view — every `channels` row,
    // with or without a `channel_state` row.
    //
    // An unmeasured median is zero, not left out — see [KeywordViewSample].
    final rows = await _db.getAllOffThread(
      'SELECT k.keyword, COALESCE(c.median_views_last_30, 0) AS views, '
      '  (s.archive_due_at IS NOT NULL) AS pending '
      'FROM channel_keywords k '
      'JOIN channels c ON c.channel_id = k.channel_id '
      'LEFT JOIN channel_state s ON s.channel_id = c.channel_id',
    );
    return [
      for (final row in rows)
        if (parseInt(row['views']) case final views?)
          KeywordViewSample(
            keyword: parseString(row['keyword']) ?? '',
            medianViews: views,
            pendingArchive: parseInt(row['pending']) == 1,
          ),
    ];
  }

  @override
  Future<List<String>> getVideoThumbnails(List<String> channelIds) async {
    if (channelIds.isEmpty) return const [];
    final urls = <String>{};
    for (final chunk in _chunks(channelIds, _queryBatch)) {
      final placeholders = List.filled(chunk.length, '?').join(', ');
      final rows = await _db.getAll(
        'SELECT DISTINCT thumbnail FROM videos '
        'WHERE channel_id IN ($placeholders) AND thumbnail IS NOT NULL',
        chunk,
      );
      for (final row in rows) {
        if (parseString(row['thumbnail']) case final url?) urls.add(url);
      }
    }
    return urls.toList();
  }

  @override
  Future<int> countArchiveDue() async {
    // Same local-disk scan as [countByVettingStatus], just over
    // `archive_due_at` instead of `vetting_status`.
    final rows = await _db.getAll(
      'SELECT COUNT(*) AS n FROM channel_state WHERE archive_due_at IS NOT NULL '
      'AND channel_id IN (SELECT channel_id FROM channels)',
    );
    if (rows.isEmpty) return 0;
    return (rows.first['n'] as int?) ?? 0;
  }

  @override
  Future<InfluencerPage> getPage({
    required int offset,
    required int limit,
    InfluencerQuery query = const InfluencerQuery(),
  }) async {
    final where = <String>[];
    final params = <Object?>[];
    var readsVideos = false;

    final search = query.search?.trim();
    if (search != null && search.isNotEmpty) {
      // `%` and `_` are LIKE's own wildcards and are stripped rather than
      // escaped, for the same reason the Supabase path strips them: somebody
      // typing "50%" means the characters, not "anything at all". The comma and
      // bracket stripping there is a PostgREST syntax concern that does not
      // apply to a bound parameter, but the two paths matching each other
      // matters more than shaving two characters off one of them.
      final safe = search.replaceAll(RegExp(r'[,()%_*\\]'), ' ').trim();
      if (safe.isNotEmpty) {
        final pattern = '%${safe.toLowerCase()}%';
        final scopes = query.searchIn.isEmpty
            ? const {InfluencerSearchScope.names}
            : query.searchIn;
        final anyOf = <String>[];
        if (scopes.contains(InfluencerSearchScope.names)) {
          anyOf
            ..add("LOWER(COALESCE(c.name, '')) LIKE ?")
            ..add('LOWER(c.handle) LIKE ?');
          params
            ..add(pattern)
            ..add(pattern);
        }
        if (scopes.contains(InfluencerSearchScope.channelDescriptions)) {
          anyOf.add("LOWER(COALESCE(c.description, '')) LIKE ?");
          params.add(pattern);
        }
        if (scopes.contains(InfluencerSearchScope.videoDescriptions)) {
          // Per channel through `idx_videos_channel_published`, but a term
          // that matches nothing still reads every stored video once (~250 ms
          // on a copy of the real 30k-video database) -- which is why this
          // page is then read off the UI isolate, below.
          anyOf.add(
            'EXISTS (SELECT 1 FROM videos v WHERE v.channel_id = c.channel_id '
            "AND LOWER(COALESCE(v.description, '')) LIKE ?)",
          );
          params.add(pattern);
          readsVideos = true;
        }
        where.add('(${anyOf.join(' OR ')})');
      }
    }
    if (query.includeCountries.isNotEmpty) {
      where.add(
          'c.country IN (${_placeholders(query.includeCountries.length)})');
      params.addAll(query.includeCountries);
    }
    if (query.excludeCountries.isNotEmpty) {
      // OR IS NULL: a channel whose country is unknown is not "the excluded
      // country", and `NULL NOT IN (...)` in SQLite (as in Postgres) evaluates
      // to NULL rather than true, which would otherwise drop it from every
      // exclude filter.
      where.add(
        '(c.country NOT IN (${_placeholders(query.excludeCountries.length)}) '
        'OR c.country IS NULL)',
      );
      params.addAll(query.excludeCountries);
    }
    // The local column is a JSON array in a text field, so "has this tag" is a
    // `json_each` scan rather than the `@>` operator a GIN index serves. The
    // arrays are three or four elements long, so the difference is not
    // measurable — but the COALESCE is load-bearing: `json_each(NULL)` raises,
    // and a channel with no tags at all is an ordinary row.
    if (query.includeChannelTags.isNotEmpty) {
      where.add(
        "EXISTS (SELECT 1 FROM json_each(COALESCE(c.channel_tags, '[]')) "
        'WHERE json_each.value IN '
        '(${_placeholders(query.includeChannelTags.length)}))',
      );
      params.addAll(query.includeChannelTags.map((tag) => tag.wire));
    }
    if (query.excludeChannelTags.isNotEmpty) {
      where.add(
        "NOT EXISTS (SELECT 1 FROM json_each(COALESCE(c.channel_tags, '[]')) "
        'WHERE json_each.value IN '
        '(${_placeholders(query.excludeChannelTags.length)}))',
      );
      params.addAll(query.excludeChannelTags.map((tag) => tag.wire));
    }
    if (query.includePipelineStages.isNotEmpty) {
      where.add(
        'c.pipeline_stage IN '
        '(${_placeholders(query.includePipelineStages.length)})',
      );
      params.addAll(query.includePipelineStages.map((stage) => stage.wire));
    }
    if (query.excludePipelineStages.isNotEmpty) {
      // No OR IS NULL needed here, unlike country: `pipeline_stage` is
      // `not null default 'new'` in the schema, so every row has one.
      where.add(
        'c.pipeline_stage NOT IN '
        '(${_placeholders(query.excludePipelineStages.length)})',
      );
      params.addAll(query.excludePipelineStages.map((stage) => stage.wire));
    }
    if (query.minSubscribers != null) {
      where.add('c.subscribers >= ?');
      params.add(query.minSubscribers);
    }
    if (query.maxSubscribers != null) {
      where.add('c.subscribers <= ?');
      params.add(query.maxSubscribers);
    }
    if (query.minMedianViews != null) {
      where.add('c.median_views_last_30 >= ?');
      params.add(query.minMedianViews);
    }
    if (query.maxMedianViews != null) {
      where.add('c.median_views_last_30 <= ?');
      params.add(query.maxMedianViews);
    }
    // Written out rather than referring to the `days_since_last_deal` alias:
    // SQLite resolves output aliases in ORDER BY but not in WHERE. A channel
    // that has never had a deal has a null here and so matches neither bound,
    // which is correct — "at least 90 days since the last deal" is a question
    // about channels that have had one.
    const daysSinceLastDeal =
        "CAST(julianday('now') - julianday(c.last_deal_at) AS INTEGER)";
    if (query.minDaysSinceLastDeal != null) {
      where.add('$daysSinceLastDeal >= ?');
      params.add(query.minDaysSinceLastDeal);
    }
    if (query.maxDaysSinceLastDeal != null) {
      where.add('$daysSinceLastDeal <= ?');
      params.add(query.maxDaysSinceLastDeal);
    }

    for (final flag in query.requireFlags) {
      where.add(_flagSql[flag]!);
    }

    final sort = query.sortBy.column;
    final direction = query.descending ? 'DESC' : 'ASC';
    final sql = StringBuffer(_rowSelect)
      ..write(where.isEmpty ? '' : ' WHERE ${where.join(' AND ')}')
      // `NULLS LAST` rather than a leading `($sort IS NULL)`, which is what
      // this used to say. Both produce the same order — SQLite treats null as
      // the smallest value, so ascending would otherwise float every channel
      // with no uploads this month to the top — but only one of them can be
      // answered by an index.
      //
      // An index cannot be walked for an ORDER BY whose first term is an
      // expression, so the old form sorted the whole table on every page even
      // with `Index('median_views', ...)` sitting right there. `NULLS LAST` is
      // the natural order of a DESC index (null sorts smallest, so descending
      // puts it last), which means the default direction — and `descending`
      // defaults to true for every sort the list offers — walks the index
      // instead. Ascending still sorts; that is inherent, and it is the
      // direction nobody opens the screen in.
      ..write(' ORDER BY $sort $direction NULLS LAST')
      // channel_id breaks ties. Without it two channels with the same
      // subscriber count can swap places between page requests, showing one
      // twice and hiding the other.
      ..write(', c.channel_id ASC')
      ..write(' LIMIT ? OFFSET ?');
    params
      ..add(limit)
      ..add(offset);

    final rows = readsVideos
        ? await _db.getAllOffThread(sql.toString(), params)
        : await _db.getAll(sql.toString(), params);
    return InfluencerPage(
      items: await _withKeywords(rows),
      hasMore: rows.length == limit,
    );
  }

  @override
  Future<Influencer?> getById(String id) async {
    final rows = await _db.getAll('$_rowSelect WHERE c.channel_id = ?', [id]);
    if (rows.isEmpty) return null;
    final items = await _withKeywords(rows);
    return items.first;
  }

  /// Attaches source keywords to a page of rows in ONE extra query — the same
  /// shape as the Supabase path, and for the same reason: asking per row is the
  /// N+1 that made the list slow in the first place. It is cheap enough locally
  /// that a join would also have been fine; keeping the two implementations the
  /// same shape is worth more than the one query saved.
  Future<List<Influencer>> _withKeywords(
      List<Map<String, Object?>> rows) async {
    if (rows.isEmpty) return const [];

    final ids = [
      for (final row in rows)
        if (row['channel_id'] != null) row['channel_id'] as String,
    ];

    final byChannel = <String, List<String>>{};
    // Chunked, not one `IN (...)` per id: [getAll] (the dashboard's keyword
    // evaluation) hands this every channel in the roster with no LIMIT, and
    // one placeholder per id blew straight past SQLite's bound-variable
    // ceiling ("too many SQL variables") once the roster passed a few
    // hundred channels. Same batch size and reasoning as
    // `MirrorArchiveRepository._writeBatch`.
    for (final chunk in _chunks(ids, _queryBatch)) {
      final placeholders = List.filled(chunk.length, '?').join(', ');
      final keywordRows = await _db.getAll(
        'SELECT channel_id, keyword FROM channel_keywords '
        'WHERE channel_id IN ($placeholders)',
        chunk,
      );
      for (final row in keywordRows) {
        final channelId = row['channel_id'] as String?;
        final keyword = row['keyword'] as String?;
        if (channelId == null || keyword == null) continue;
        byChannel.putIfAbsent(channelId, () => []).add(keyword);
      }
    }

    return [
      for (final row in rows)
        _toInfluencer(row, byChannel[row['channel_id']] ?? const []),
    ];
  }

  @override
  Future<List<Video>> getRecentVideos(String influencerId) async {
    final rows = await _db.getAll(
      'SELECT video_id, title, description, thumbnail, published_at, '
      'view_count FROM videos WHERE channel_id = ? '
      // Nulls last: a video whose fetch failed has no date and must not be
      // mistaken for the newest upload. Written as `NULLS LAST` rather than a
      // leading `(published_at IS NULL)` so `channel_published` answers the
      // ORDER BY instead of the whole channel being sorted to find 200 rows.
      'ORDER BY published_at DESC NULLS LAST LIMIT 200',
      [influencerId],
    );
    return [for (final row in rows) _toVideo(row)];
  }

  @override
  Future<Map<String, Video>> getLatestVideoPerChannel(
    List<String> channelIds,
  ) async {
    if (channelIds.isEmpty) return const {};

    // One row per channel, not every video of every channel. `max()` in a
    // grouped SELECT is SQLite's documented "bare column" case: the other
    // columns are taken from the row that produced the maximum, which is
    // exactly the newest-upload-per-channel this returns. It reads through
    // `channel_published` and produces as many rows as there are channels.
    //
    // The old form asked for every video of every channel and kept the first
    // of each here. At 13.5 videos per channel that is fourteen rows read and
    // decoded for each one used — and because the caller passes every id
    // loaded so far rather than just the new page, the tenth page asked for
    // all of them again.
    final latest = <String, Video>{};
    for (final chunk in _chunks(channelIds, _queryBatch)) {
      final placeholders = List.filled(chunk.length, '?').join(', ');
      final rows = await _db.getAll(
        'SELECT channel_id, video_id, title, description, thumbnail, '
        'MAX(published_at) AS published_at, view_count FROM videos '
        'WHERE channel_id IN ($placeholders) AND published_at IS NOT NULL '
        'GROUP BY channel_id',
        chunk,
      );
      for (final row in rows) {
        final channelId = parseString(row['channel_id']);
        if (channelId == null) continue;
        latest[channelId] = _toVideo(row);
      }
    }
    return latest;
  }

  /// How many ids one SQL statement names — see
  /// `MirrorArchiveRepository._writeBatch`'s doc comment for why this stays
  /// well under SQLite's bound-variable ceiling.
  static const _queryBatch = 500;

  static List<List<String>> _chunks(List<String> ids, int size) => [
        for (var start = 0; start < ids.length; start += size)
          ids.sublist(start, math.min(start + size, ids.length)),
      ];

  @override
  Future<List<String>> getCountries() async {
    final rows = await _db.getAll(
      'SELECT DISTINCT UPPER(country) AS country FROM channels '
      "WHERE country IS NOT NULL AND TRIM(country) <> '' ORDER BY 1",
    );
    return [
      for (final row in rows)
        if (parseString(row['country']) case final code?) code,
    ];
  }

  @override
  Future<String> create(NewInfluencer draft) async {
    final handle = '@${draft.handle.trim().replaceFirst('@', '')}';
    // The same id rule as every other implementation, computed locally so a
    // channel added with no signal at all still gets its real primary key and
    // still merges with the eventual pipeline discovery.
    final channelId = draft.channelId.trimmedOrNull ?? 'manual:$handle';
    final now = DateTime.now().toUtc().toIso8601String();
    final tags = Influencer.normalizeChannelTags(draft.channelTags);

    // The one write this app makes to the pipeline's table: a bare row for a
    // channel no search has found, flagged for a fetch so the next backfill
    // reads its details and videos. The pipeline treats it exactly like a
    // channel a keyword discovered; `INSERT OR IGNORE` because a channel that
    // IS already there must keep whatever the pipeline scraped.
    await _db.execute(
      'INSERT OR IGNORE INTO channels '
      '(channel_id, handle, name, link, country, subscribers, first_seen_at, '
      'force_refetch) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      [
        channelId,
        handle,
        draft.name.trimmedOrNull,
        draft.channelUrl.trimmedOrNull ?? 'https://www.youtube.com/$handle',
        draft.country,
        draft.subscriberCount?.toString(),
        now,
      ],
    );
    // Brought back if it was archived: the archive is the one thing a manual
    // add is allowed to override, because a person typing a handle in has
    // decided the channel is worth a look.
    await restoreChannelsLocally(_db, [channelId]);

    final notes = draft.notes.trimmedOrNull;
    final tagWires = [for (final tag in tags) tag.wire];
    await _db.execute(
      'INSERT INTO channel_state (channel_id, handle, notes, channel_tags, '
      'vetting_status, pipeline_stage, contacts, updated_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?) '
      'ON CONFLICT(channel_id) DO UPDATE SET '
      'notes = COALESCE(excluded.notes, channel_state.notes), '
      'channel_tags = excluded.channel_tags, updated_at = excluded.updated_at',
      [
        channelId,
        handle,
        notes,
        encodeJsonColumn(tagWires),
        VettingStatus.newlyFound.name,
        PipelineStage.isNew.wire,
        '[]',
        now,
      ],
    );
    await enqueueRowUpsert(
      _db,
      table: 'channel_state',
      id: channelId,
      row: {
        'channel_id': channelId,
        'handle': handle,
        'notes': notes,
        // A real list, not the JSON string the local column holds.
        'channel_tags': tagWires,
      },
    );
    return channelId;
  }

  @override
  Future<void> archiveNow(String id) async {
    // Not a compare-and-set: this moves a countdown forward rather than
    // changing a field somebody could have been looking at.
    final now = DateTime.now().toUtc().toIso8601String();
    await _writeState(id, 'archive_due_at', now);
    await _queueStateRow(id, {'archive_due_at': now});
    // And the sweep itself, straight away rather than on the next tick: the
    // dialog that leads here says the deletion is permanent, and a person who
    // confirmed it should see the channel go. `archiveChannels` tombstones
    // locally and queues the R2 side.
    await archiveChannels([
      (channelId: id, label: await _rejectingLabel(id) ?? 'irrelevant'),
    ]);
  }

  /// The label the channel's tags say it should be archived under, or null if
  /// it carries no rejecting tag.
  Future<String?> _rejectingLabel(String id) async {
    final rows = await _db.getAll(
      'SELECT channel_tags FROM influencer_channels WHERE channel_id = ?',
      [id],
    );
    if (rows.isEmpty) return null;
    for (final wire in decodeStringList(rows.first['channel_tags'])) {
      final tag = ChannelTag.fromWire(wire);
      if (tag != null && ChannelTag.rejecting.contains(tag)) return tag.wire;
    }
    return null;
  }

  /// Archives channels on this machine — see `archiveChannelsLocally`.
  Future<int> archiveChannels(
    List<({String channelId, String label})> entries,
  ) =>
      archiveChannelsLocally(_db, entries);

  /// Upserts one typed-in column into `channel_state`, creating the row on a
  /// channel's first edit (with its handle, so the server can name it).
  Future<void> _writeState(String id, String column, Object? value) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.execute(
      'INSERT INTO channel_state (channel_id, handle, $column, updated_at) '
      'VALUES (?, (SELECT handle FROM channels WHERE channel_id = ?), ?, ?) '
      'ON CONFLICT(channel_id) DO UPDATE SET $column = excluded.$column, '
      'updated_at = excluded.updated_at',
      [id, id, value, now],
    );
  }

  /// Queues a whole-row upsert of the given `channel_state` columns — for the
  /// columns outside the compare-and-set (the archive countdown).
  Future<void> _queueStateRow(String id, Map<String, Object?> columns) async {
    final rows = await _db
        .getAll('SELECT handle FROM channels WHERE channel_id = ?', [id]);
    await enqueueRowUpsert(
      _db,
      table: 'channel_state',
      id: id,
      row: {
        'channel_id': id,
        'handle': rows.isEmpty ? id : rows.first['handle'],
        ...columns,
      },
    );
  }

  /// One compare-and-set against the local mirror.
  ///
  /// [base] and [next] are in wire form — what the Postgres column would hold
  /// as jsonb — so this and `apply_channel_edit` are comparing the same values
  /// by the same rules.
  ///
  /// On [EditOutcome.applied] the local row is written and the upload is
  /// queued, carrying [base] with it so the server runs the same
  /// compare-and-set against whatever the column holds by the time it arrives.
  /// On [EditOutcome.conflict] nothing is written to `channels` at all and a
  /// conflict row is filed locally instead — the refused text has to live
  /// somewhere, and this record is the only copy of it.
  Future<EditOutcome> _apply(
    String id,
    String field,
    Object? base,
    Object? next,
  ) async {
    // The same whitelist `apply_channel_edit` enforces, restated because this
    // is the other place a column name reaches a statement by interpolation.
    // Every caller below passes a literal, so this can only fire on a bug —
    // which is exactly when it is worth having.
    if (!kEditableChannelFields.contains(field)) {
      throw ArgumentError.value(field, 'field', 'is not an editable column');
    }

    final rows = await _db.getAll(
      'SELECT $field AS value, handle, COALESCE(name, handle) AS label, '
      'last_edited_by_name FROM influencer_channels WHERE channel_id = ?',
      [id],
    );
    if (rows.isEmpty) return EditOutcome.missing;

    final row = rows.first;
    final current = kLocalJsonColumns.contains(field)
        ? decodeJsonColumn(row['value'])
        : row['value'];

    final outcome =
        decideEdit(field: field, current: current, base: base, next: next);

    switch (outcome) {
      case EditOutcome.noop:
      case EditOutcome.auto:
      case EditOutcome.missing:
        return outcome;

      case EditOutcome.conflict:
        await _recordConflict(
          channelId: id,
          channelLabel: parseString(row['label']) ?? id,
          field: field,
          base: base,
          mine: next,
          theirs: current,
          theirsActorName: parseString(row['last_edited_by_name']),
        );
        return EditOutcome.conflict;

      case EditOutcome.applied:
        await _writeState(
          id,
          field,
          kLocalJsonColumns.contains(field) ? encodeJsonColumn(next) : next,
        );
        await _db.execute(
          'UPDATE channel_state SET last_edited_by = ?, last_edited_by_name = ? '
          'WHERE channel_id = ?',
          [actor.id, actor.name, id],
        );
        // The base travels with the edit, and this is the one place the queue
        // is strictly better than the replication it replaced: PowerSync
        // reconstructed a base from the row's previous value, and its own
        // connector conceded that value could be missing — in which case an
        // informed edit had to be sent as if it were a stale one. Here the base
        // is the argument this method was called with: what the editor was
        // actually looking at, never guessed and never absent.
        await enqueueOutbox(
          _db,
          kind: OutboxKind.channelEdit,
          payload: {
            'channel_id': id,
            'field': field,
            'base': base,
            'next': next,
            'label': parseString(row['handle']) ?? id,
          },
        );
        return EditOutcome.applied;
    }
  }

  /// Files a conflict this machine detected before the server saw the write.
  ///
  /// Mirrors the `on conflict ... do update` in `apply_channel_edit`: one open
  /// conflict per person per field per channel, so somebody who keeps re-saving
  /// against a stale base updates what they are proposing instead of stacking a
  /// fresh row every attempt. The base is deliberately left as first recorded —
  /// that is the point the two versions actually diverged.
  Future<void> _recordConflict({
    required String channelId,
    required String channelLabel,
    required String field,
    required Object? base,
    required Object? mine,
    required Object? theirs,
    required String? theirsActorName,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();

    final existing = await _db.getAll(
      'SELECT id FROM edit_conflicts WHERE channel_id = ? AND field = ? '
      'AND resolved_at IS NULL AND mine_actor_id IS ? LIMIT 1',
      [channelId, field, actor.id],
    );

    final String id;
    if (existing.isNotEmpty) {
      id = '${existing.first['id']}';
      await _db.execute(
        'UPDATE edit_conflicts SET mine_value = ?, theirs_value = ?, '
        'theirs_actor_name = ?, detected_at = ? WHERE id = ?',
        [
          encodeJsonColumn(mine),
          encodeJsonColumn(theirs),
          theirsActorName,
          now,
          id,
        ],
      );
    } else {
      id = localUuid();
      await _db.execute(
        'INSERT INTO edit_conflicts (id, channel_id, channel_label, field, '
        'base_value, mine_value, theirs_value, mine_actor_id, mine_actor_name, '
        'theirs_actor_name, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          channelId,
          channelLabel,
          field,
          encodeJsonColumn(base),
          encodeJsonColumn(mine),
          encodeJsonColumn(theirs),
          actor.id,
          actor.name,
          theirsActorName,
          now,
        ],
      );
    }

    // One queued entry covers both branches. The uploader inserts and falls
    // back to updating the open conflict on a 23505, which is the same
    // `on conflict ... do update` shape `apply_channel_edit` uses server-side —
    // so a conflict this machine filed and one the database filed converge on
    // the same row whichever arrives first.
    //
    // Values go into the payload decoded, not as the JSON strings the local
    // columns hold, because `edit_conflicts.base_value` and its two siblings
    // are `jsonb` on the server.
    await enqueueOutbox(
      _db,
      kind: OutboxKind.conflictFile,
      payload: {
        'id': id,
        'channel_id': channelId,
        'channel_label': channelLabel,
        'field': field,
        'base_value': base,
        'mine_value': mine,
        'theirs_value': theirs,
        'mine_actor_id': actor.id,
        'mine_actor_name': actor.name,
        'theirs_actor_name': theirsActorName,
        'detected_at': now,
      },
    );
  }

  @override
  Future<EditOutcome> updateVettingStatus(
    String id,
    VettingStatus status, {
    required VettingStatus base,
  }) {
    return _apply(id, 'vetting_status', base.name, status.name);
  }

  @override
  Future<EditOutcome> updateRelevanceCriteria(
    String id,
    List<String> criteria, {
    required List<String> base,
  }) {
    return _apply(id, 'relevance_criteria', base, criteria);
  }

  @override
  Future<EditOutcome> updateNotes(
    String id,
    String notes, {
    required String? base,
  }) {
    return _apply(id, 'notes', base, notes);
  }

  @override
  Future<EditOutcome> updatePipelineStage(
    String id,
    PipelineStage stage, {
    required PipelineStage base,
  }) {
    return _apply(id, 'pipeline_stage', base.wire, stage.wire);
  }

  @override
  Future<EditOutcome> updateChannelTags(
    String id,
    List<ChannelTag> tags, {
    required List<ChannelTag> base,
  }) async {
    final normalized = Influencer.normalizeChannelTags(tags);
    final outcome = await _apply(
      id,
      'channel_tags',
      [for (final tag in base) tag.wire],
      [for (final tag in normalized) tag.wire],
    );
    if (outcome != EditOutcome.applied) return outcome;

    // Mirrors `trg_channels_archive_due` in backend/schema.sql, including
    // the part that is easy to leave out: a channel already counting down keeps
    // the date it has rather than restarting the 7 days, so re-tagging cannot
    // postpone an archive indefinitely.
    //
    // Done locally as well as server-side because the countdown chip has to
    // appear the moment the tag goes on, not when the machine next reconnects.
    // The server's trigger overrules whatever is written here, which is what
    // makes writing it safe.
    if (Influencer.isRejectedBy(normalized)) {
      await _db.execute(
        'UPDATE channel_state SET archive_due_at = ? '
        'WHERE channel_id = ? AND archive_due_at IS NULL',
        [
          DateTime.now().toUtc().add(const Duration(days: 7)).toIso8601String(),
          id,
        ],
      );
    } else {
      await _db.execute(
        'UPDATE channel_state SET archive_due_at = NULL WHERE channel_id = ?',
        [id],
      );
    }

    // Queued from what the row actually holds rather than from what was just
    // written, because the `archive_due_at IS NULL` guard above means a channel
    // already counting down keeps the date it has. Sending the new date would
    // restart its 7 days server-side and let re-tagging postpone an archive
    // indefinitely.
    //
    // Reached only after the tag edit applied — the early return above — which
    // is the same rule the old connector spelled out as "applied only if
    // nothing was refused": a countdown for tags the server did not accept
    // would schedule a deletion for a decision nobody made.
    // The server's own trigger sets the same date on the tag edit above, so
    // nothing is queued for it: the countdown arrives on the next pull, and
    // the one written here is what the row shows until then.
    return EditOutcome.applied;
  }

  @Deprecated(
    'Contact attempts are derived from the count of outbound outreach '
    'messages; see backend/schema.sql',
  )
  @override
  Future<void> incrementContactAttempts(String id) async {
    // Deliberately does nothing. The column this used to bump is not what the
    // app reads any more — the number on screen is the count of outbound
    // outreach messages — and there is no offline-safe way to increment a
    // counter anyway: two machines each adding one to a stale value both write
    // the same number and one attempt disappears. That is the exact failure the
    // server-side RPC exists to prevent, and it cannot be reproduced locally.
  }

  @override
  Future<EditOutcome> updateProvidedData(
    String id,
    Map<String, dynamic>? data, {
    required Map<String, dynamic>? base,
  }) {
    return _apply(id, 'provided_data', base, data);
  }

  @override
  Future<List<SponsorSighting>> sponsorSightings() async {
    // Straight off the pipeline's table: a few hundred rows at most carry
    // brands, and the view's per-row outreach subquery is not needed here.
    final rows = await _db.getAll(
      'SELECT channel_id, handle, name, latest_upload_at, seen_brands '
      'FROM channels '
      "WHERE seen_brands IS NOT NULL AND seen_brands NOT IN ('', '[]')",
    );
    return [
      for (final row in rows)
        SponsorSighting(
          channelId: row['channel_id']! as String,
          handle: parseString(row['handle']) ?? '',
          name: parseString(row['name']),
          latestUploadAt: parseDate(row['latest_upload_at']),
          brands: decodeStringList(row['seen_brands']),
        ),
    ];
  }

  @override
  Future<EditOutcome> updateMediaKit(
    String id,
    MediaKit? kit, {
    required MediaKit? base,
  }) {
    return _apply(id, 'media_kit', base?.toJson(), kit?.toJson());
  }

  @override
  Future<EditOutcome> updateCreatorGender(
    String id,
    CreatorGender? gender, {
    required CreatorGender? base,
  }) {
    return _apply(id, 'creator_gender', base?.name, gender?.name);
  }

  @override
  Future<EditOutcome> updateContacts(
    String id,
    List<InfluencerContact> contacts, {
    required List<InfluencerContact> base,
  }) {
    // Normalized on both sides, so "the same list, normalized differently"
    // cannot read as a change.
    return _apply(
      id,
      'contacts',
      [for (final c in InfluencerContact.normalize(base)) c.toJson()],
      [for (final c in InfluencerContact.normalize(contacts)) c.toJson()],
    );
  }

  @override
  Future<void> updateOwner(String id, String? ownerId) async {
    // Not compare-and-set — same reasoning as [archiveNow]: a whole-value
    // pick, not a field two people are likely mid-edit on together.
    await _writeState(id, 'owner_id', ownerId);
    await _queueStateRow(id, {'owner_id': ownerId});
  }

  @override
  Future<void> updateManualEngagement(
    String id, {
    required double? rate,
    required String? note,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.execute(
      'INSERT INTO channel_state (channel_id, handle, manual_engagement_rate, '
      'manual_engagement_note, manual_engagement_updated_at, updated_at) '
      'VALUES (?, (SELECT handle FROM channels WHERE channel_id = ?), ?, ?, ?, ?) '
      'ON CONFLICT(channel_id) DO UPDATE SET '
      'manual_engagement_rate = excluded.manual_engagement_rate, '
      'manual_engagement_note = excluded.manual_engagement_note, '
      'manual_engagement_updated_at = excluded.manual_engagement_updated_at, '
      'updated_at = excluded.updated_at',
      [id, id, rate, note, now, now],
    );
    await _queueStateRow(id, {
      'manual_engagement_rate': rate,
      'manual_engagement_note': note,
      'manual_engagement_updated_at': now,
    });
  }

  static Video _toVideo(Map<String, Object?> row) {
    final videoId = parseString(row['video_id']) ?? '';
    return Video(
      id: videoId,
      title: parseString(row['title']) ?? '(untitled)',
      url: 'https://www.youtube.com/watch?v=$videoId',
      publishedAt: parseDate(row['published_at']),
      viewCount: parseInt(row['view_count']),
      thumbnail: parseString(row['thumbnail']),
      description: parseString(row['description']),
    );
  }

  static Influencer _toInfluencer(
    Map<String, Object?> row,
    List<String> keywords,
  ) {
    final handle = parseString(row['handle']) ?? '';
    return Influencer(
      id: row['channel_id'] as String,
      handle: handle,
      channelUrl: parseString(row['link']) ??
          (handle.isEmpty ? '' : 'https://www.youtube.com/$handle'),
      platform: InfluencerPlatform.youtube,
      subscriberCount: parseInt(row['subscribers']) ?? 0,
      name: parseString(row['name']),
      description: parseString(row['description']),
      profilePicture: parseString(row['profile_picture']),
      banner: parseString(row['banner']),
      country: parseString(row['country']),
      lastVideoAt: parseDate(row['latest_upload_at']),
      medianViewsLast30: parseInt(row['median_views_last_30']),
      sourceKeywords: keywords,
      vettingStatus: switch (parseString(row['vetting_status'])) {
        'shortlisted' => VettingStatus.shortlisted,
        'rejected' => VettingStatus.rejected,
        _ => VettingStatus.newlyFound,
      },
      discoveredAt: parseDate(row['first_seen_at']) ??
          DateTime.fromMillisecondsSinceEpoch(0),
      notes: parseString(row['notes']),
      relevanceCriteria: decodeStringList(row['relevance_criteria']),
      pipelineStage: PipelineStage.fromWire(parseString(row['pipeline_stage'])),
      contactAttempts: parseInt(row['outreach_outbound_count']) ??
          parseInt(row['contact_attempts']) ??
          0,
      channelTags: Influencer.normalizeChannelTags([
        for (final w in decodeStringList(row['channel_tags']))
          if (ChannelTag.fromWire(w) case final t?) t,
      ]),
      lastDealAt: parseDate(row['last_deal_at']),
      daysSinceLastDeal: parseInt(row['days_since_last_deal']),
      videosLast30: parseInt(row['videos_last_30']) ?? 0,
      providedData: parseJsonMap(decodeJsonColumn(row['provided_data'])),
      lastFetchedAt: parseDate(row['last_fetched_at']),
      contacts:
          InfluencerContact.listFromJson(decodeJsonColumn(row['contacts'])),
      archiveDueAt: parseDate(row['archive_due_at']),
      ownerId: parseString(row['owner_id']),
      manualEngagementRate: parseDouble(row['manual_engagement_rate']),
      manualEngagementNote: parseString(row['manual_engagement_note']),
      manualEngagementUpdatedAt: parseDate(row['manual_engagement_updated_at']),
      sponsoredRatio: parseDouble(row['sponsored_ratio']),
      seenBrands: decodeStringList(row['seen_brands']),
      foundEmails: decodeStringList(row['found_emails']),
      mediaKit: MediaKit.tryParse(decodeJsonColumn(row['media_kit'])),
      creatorGender: CreatorGender.fromWire(parseString(row['creator_gender'])),
    );
  }
}
