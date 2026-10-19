import 'dart:async';
import 'dart:math' as math;

import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_mapping.dart';

/// Hands control back to the event loop between batches of a bulk write.
///
/// `LocalSyncDb` wraps the synchronous `sqlite3` FFI package in `async`
/// methods, which does not make them non-blocking — each call still blocks
/// this isolate, which is also the UI isolate, for its own duration. Awaiting
/// an already-completed Future only schedules a microtask, and microtasks
/// drain before Flutter ever gets a chance to pump a frame; only a real event
/// (a Timer, which `Future.delayed` schedules) does that. Without this, a
/// loop of many synchronous SQLite calls runs as one uninterrupted stretch
/// with no repaint and no input handling — indistinguishable, to whoever is
/// watching, from a hung app.
Future<void> _yieldToUi() => Future.delayed(Duration.zero);

/// How many channels one transaction covers.
///
/// Each batch is a fixed handful of `IN (...)` statements, so the cost of a
/// batch is the rows it touches, not the channels it names; this is sized so a
/// batch stays comfortably inside one frame on a cold disk while a sweep of a
/// few thousand is a few dozen commits. Well under SQLite's bound-variable
/// ceiling, even for the per-row insert's nine parameters.
const _archiveBatch = 100;

List<List<T>> _chunks<T>(List<T> items, int size) => [
      for (var start = 0; start < items.length; start += size)
        items.sublist(start, math.min(start + size, items.length)),
    ];

String _placeholders(int count) => List.filled(count, '?').join(', ');

/// The archive's frozen numbers, as this machine can see them.
///
/// `median` and `videosFound` are the only derived facts the archive keeps
/// and the only ones it cannot recover — the sweep that writes them deletes
/// the videos they came from. [basis] says which set the median was taken
/// over, so the Archive page can show a lifetime median without passing it
/// off as a 30-day one.
///
/// All three null means "this machine could not see the channel's videos",
/// which is not the same as zero and must never be written over a real count.
/// See [_measureArchiveNumbers] and [_archiveUpsertSql].
typedef _ArchiveNumbers = ({int? median, String? basis, int? videosFound});

/// The trailing-30-day window — the basis the rollup on `channels` carries.
const _basisWindow30 = 'window30';

/// Every stored video — the fallback when the 30-day window held nothing.
const _basisLifetime = 'lifetime';

/// Works out [_ArchiveNumbers] for each of [ids] from the videos this machine
/// holds at this moment. [channels] is the already-read `channels` row per id.
///
/// The median is `channels.median_views_last_30` — the rollup the pipeline
/// maintains over the trailing 30 days — and when that is null but videos are
/// stored, the median over all of them instead. A channel with fifteen
/// uploads and none in the last thirty days used to freeze as "15 videos,
/// median unknown", which is the shape of every inactive channel, and so
/// exactly the row the archive kept losing the number on.
///
/// A channel with no `videos` rows is only counted as zero when this machine
/// is entitled to say so: it ran the video pass itself (it uploaded the
/// object) or it applied somebody else's (it downloaded one). Otherwise the
/// rows are simply elsewhere — the sweep runs on every machine's sync tick,
/// including ones that pulled the channel from the catalog and never
/// downloaded its videos — and the answer is null, meaning unknown.
///
/// One case reads as unknown that really is zero: a channel scraped on this
/// machine, genuinely holding no uploads, archived in the window before its
/// object went up. It leans this way on purpose — an unknown is a number the
/// merge can still fill in from any machine that knows better, and a wrong
/// zero is a claim on the page that nothing will ever correct.
///
/// Mirrors `store.measure_archive_numbers`; the two write the same rows into
/// the same file and must not drift.
Map<String, _ArchiveNumbers> _measureArchiveNumbers(
  LocalSyncTx tx,
  List<String> ids,
  Map<String, Map<String, Object?>> channels,
) {
  if (ids.isEmpty) return const {};
  final counted = <String, int>{};
  for (final row in tx.select(
    'SELECT channel_id, COUNT(*) AS n FROM videos '
    'WHERE channel_id IN (${_placeholders(ids.length)}) GROUP BY channel_id',
    ids,
  )) {
    counted['${row['channel_id']}'] = _asInt(row['n']) ?? 0;
  }

  // The view counts are only read for the channels that actually need the
  // fallback — a rollup that is already there answers the question, and the
  // rows behind it are the bulk of this database.
  final needLifetime = [
    for (final id in ids)
      if ((counted[id] ?? 0) > 0 &&
          _asInt(channels[id]?['median_views_last_30']) == null)
        id,
  ];
  final views = <String, List<int>>{};
  if (needLifetime.isNotEmpty) {
    for (final row in tx.select(
      'SELECT channel_id, view_count FROM videos '
      'WHERE channel_id IN (${_placeholders(needLifetime.length)})',
      needLifetime,
    )) {
      // A video with no count is not a video with zero views, so it stays out
      // of the median rather than dragging it down — the same rule
      // `compute_channel_rollups` follows inside the 30-day window.
      final count = _asInt(row['view_count']);
      if (count != null) {
        views.putIfAbsent('${row['channel_id']}', () => []).add(count);
      }
    }
  }

  final out = <String, _ArchiveNumbers>{};
  for (final id in ids) {
    final stored = counted[id] ?? 0;
    if (stored == 0) {
      final row = channels[id];
      final held = row != null &&
          _asString(row['videos_fetched_at']) != null &&
          (_asString(row['blob_applied_version']) != null ||
              _asString(row['blob_uploaded_at']) != null);
      out[id] = (median: null, basis: null, videosFound: held ? 0 : null);
      continue;
    }
    final window = _asInt(channels[id]?['median_views_last_30']);
    if (window != null) {
      out[id] = (median: window, basis: _basisWindow30, videosFound: stored);
      continue;
    }
    final lifetime = _median(views[id] ?? const []);
    out[id] = (
      median: lifetime,
      basis: lifetime == null ? null : _basisLifetime,
      videosFound: stored,
    );
  }
  return out;
}

/// The 50th percentile of [values], or null when there are none. Even lengths
/// take the mean of the middle pair, as the pipeline's rollup does.
int? _median(List<int> values) {
  if (values.isEmpty) return null;
  final sorted = [...values]..sort();
  final mid = sorted.length ~/ 2;
  if (sorted.length.isOdd) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) ~/ 2;
}

int? _asInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  final text = '${value ?? ''}'.replaceAll(',', '').trim();
  if (text.isEmpty) return null;
  return int.tryParse(text) ?? double.tryParse(text)?.toInt();
}

String? _asString(Object? value) {
  final text = '${value ?? ''}'.trim();
  return text.isEmpty ? null : text;
}

/// Picks the better of the incoming value and the one already on the
/// tombstone, as a SQL expression over `excluded` and `channel_archive`.
///
/// `videos_found_count` ranks the two observations: a machine that counted
/// fifteen videos knows more about this channel than one that counted none,
/// and more still than one that could not count at all (null, which the `-1`
/// sorts below a real zero). [column] travels with that ranking rather than
/// being merged on its own — a median over fifteen videos sitting next to a
/// count of three would describe a set the row does not claim.
String _betterOf(String column) => '''
    CASE
      WHEN excluded.$column IS NULL THEN channel_archive.$column
      WHEN channel_archive.$column IS NULL THEN excluded.$column
      WHEN COALESCE(excluded.videos_found_count, -1)
           >= COALESCE(channel_archive.videos_found_count, -1)
        THEN excluded.$column
      ELSE channel_archive.$column
    END''';

/// Writes a tombstone without ever making it say less than it already did.
///
/// Who the channel is and what was decided about it are this write's to
/// state. Its numbers are not: they belong to whichever machine held the
/// videos, and the sweep runs on whichever machine's tick comes round first.
/// This used to be an `INSERT OR REPLACE`, so a machine with nothing to
/// measure blanked a real median every time it got there first — and then
/// announced the blank, and `apply_remote_archive` on the machine that did
/// hold the videos replaced its own good row with it.
///
/// Mirrors `store.merge_archive_numbers`. Keep the rule the same on both
/// sides.
final String _archiveUpsertSql = '''
  INSERT INTO channel_archive
    (channel_id, handle, label, archived_at, subscribers, found_at,
     found_via, source, announced, median_views_last_30, median_basis,
     videos_found_count)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'local', 1, ?, ?, ?)
  ON CONFLICT(channel_id) DO UPDATE SET
    handle = excluded.handle,
    label = excluded.label,
    archived_at = excluded.archived_at,
    subscribers = excluded.subscribers,
    found_at = excluded.found_at,
    found_via = excluded.found_via,
    source = 'local',
    announced = 1,
    median_views_last_30 = ${_betterOf('median_views_last_30')},
    median_basis = ${_betterOf('median_basis')},
    videos_found_count =
      CASE
        WHEN excluded.videos_found_count IS NULL
          THEN channel_archive.videos_found_count
        WHEN channel_archive.videos_found_count IS NULL
          THEN excluded.videos_found_count
        ELSE MAX(excluded.videos_found_count,
                 channel_archive.videos_found_count)
      END
''';

/// The two writes that move a channel in and out of the archive, shared by
/// the influencer and archive repositories so there is one definition of
/// each rather than two that can drift.
///
/// Both are local-first: the local tables change now, and the R2 side (the
/// object deletion and the catalog announcement, or the restore) is queued
/// for the pipeline through the outbox. Nothing here waits on a network.

/// Archives channels on this machine: writes the tombstones, removes the rows
/// and their typed-in state, and queues the R2 side for the pipeline.
///
/// The sweep the server used to run nightly, done here by whichever machine
/// notices a countdown has passed, or by a person pressing "archive now" /
/// the bulk clean. Idempotent: a channel already gone is skipped, EXCEPT that
/// an existing tombstone gets the new label — which is how the Archive page's
/// relabel reaches the pipeline through the same queue.
Future<int> archiveChannelsLocally(
  LocalSyncDb db,
  List<({String channelId, String label})> entries,
) async {
  if (entries.isEmpty) return 0;
  final now = DateTime.now().toUtc().toIso8601String();
  final queued = <Map<String, Object?>>[];
  final deleted = <String>[];
  for (final batch in _chunks(entries, _archiveBatch)) {
    await _yieldToUi();
    // Set-based, one transaction per batch: a fixed handful of statements
    // however many channels the batch names, and one commit for all of them.
    // This used to be eight auto-committed statements per channel, which is
    // what made a bulk clean — and the silent sweep on every sync tick —
    // read as a frozen app.
    await db.transaction((tx) {
      final labelOf = {for (final entry in batch) entry.channelId: entry.label};
      final ids = labelOf.keys.toList();
      final marks = _placeholders(ids.length);

      final present = <String, Map<String, Object?>>{};
      for (final row in tx.select(
        'SELECT channel_id, handle, subscribers, first_seen_at, '
        'median_views_last_30, videos_fetched_at, blob_applied_version, '
        'blob_uploaded_at FROM channels WHERE channel_id IN ($marks)',
        ids,
      )) {
        present['${row['channel_id']}'] = row;
      }

      // No channel row: either it was never here or it is already archived.
      // Only the second is anything to do, and what there is to do is the
      // label.
      final missing = [
        for (final id in ids)
          if (!present.containsKey(id)) id
      ];
      if (missing.isNotEmpty) {
        for (final row in tx.select(
          'SELECT channel_id, label FROM channel_archive '
          'WHERE channel_id IN (${_placeholders(missing.length)})',
          missing,
        )) {
          final id = '${row['channel_id']}';
          final label = labelOf[id]!;
          if (row['label'] == label) continue;
          tx.execute(
            'UPDATE channel_archive SET label = ? WHERE channel_id = ?',
            [label, id],
          );
          queued.add({'channel_id': id, 'label': label});
        }
      }
      if (present.isEmpty) return;

      final found = [
        for (final id in ids)
          if (present.containsKey(id)) id
      ];
      final foundMarks = _placeholders(found.length);
      final linksOf = <String, List<Map<String, Object?>>>{};
      for (final row in tx.select(
        'SELECT channel_id, keyword, discovered_at FROM channel_keywords '
        'WHERE channel_id IN ($foundMarks) ORDER BY discovered_at',
        found,
      )) {
        linksOf.putIfAbsent('${row['channel_id']}', () => []).add({
          'keyword': row['keyword'],
          'limit': null,
          'discovered_at': row['discovered_at'],
        });
      }
      final numbers = _measureArchiveNumbers(tx, found, present);

      // `announced = 1`: the pipeline writes the catalog op when the queued
      // entry is sent (and resets the flag itself), so its own "announce what
      // is unannounced" pass must not say it a second time in between.
      for (final id in found) {
        final row = present[id]!;
        final measured = numbers[id]!;
        tx.execute(_archiveUpsertSql, [
          id,
          row['handle'],
          labelOf[id],
          now,
          row['subscribers'],
          row['first_seen_at'],
          encodeJsonColumn(linksOf[id] ?? const []),
          measured.median,
          measured.basis,
          measured.videosFound,
        ]);
      }
      // Children first: the pipeline's own connection runs with foreign keys
      // on, and the same order here means the two never disagree about what
      // a half-finished archive looks like.
      for (final table in const [
        'videos',
        'channel_keywords',
        'channels',
        'channel_state',
      ]) {
        tx.execute(
          'DELETE FROM $table WHERE channel_id IN ($foundMarks)',
          found,
        );
      }
      deleted.addAll(found);
      for (final id in found) {
        queued.add({'channel_id': id, 'label': labelOf[id]});
      }
    });
  }
  await enqueueRowDeleteMany(db, table: 'channel_state', ids: deleted);
  if (queued.isNotEmpty) {
    await enqueueOutbox(
      db,
      kind: OutboxKind.archiveChannels,
      payload: {'entries': queued},
    );
  }
  return queued.length;
}

/// Brings channels back from the archive: the tombstone goes, a bare
/// `channels` row flagged for a full re-fetch takes its place (the object was
/// deleted from the bucket when it was archived, and nothing but a scrape can
/// rebuild it), and the pipeline is asked to announce it.
///
/// Returns the ids that were actually archived here; the rest are ignored.
Future<List<String>> restoreChannelsLocally(
  LocalSyncDb db,
  List<String> channelIds,
) async {
  if (channelIds.isEmpty) return const [];
  final now = DateTime.now().toUtc().toIso8601String();
  final restored = <String>[];
  for (final batch in _chunks(channelIds.toSet().toList(), _archiveBatch)) {
    await _yieldToUi();
    await db.transaction((tx) {
      final marks = _placeholders(batch.length);
      final rows = tx.select(
        'SELECT channel_id, handle FROM channel_archive '
        'WHERE channel_id IN ($marks)',
        batch,
      );
      if (rows.isEmpty) return;
      final found = <String>[];
      for (final row in rows) {
        final id = '${row['channel_id']}';
        tx.execute(
          'INSERT INTO channels '
          '(channel_id, handle, first_seen_at, force_refetch) '
          'VALUES (?, ?, ?, 1) '
          'ON CONFLICT(channel_id) DO UPDATE SET force_refetch = 1',
          [id, row['handle'] ?? id, now],
        );
        found.add(id);
      }
      tx.execute(
        'DELETE FROM channel_archive '
        'WHERE channel_id IN (${_placeholders(found.length)})',
        found,
      );
      restored.addAll(found);
    });
  }
  if (restored.isNotEmpty) {
    await enqueueOutbox(
      db,
      kind: OutboxKind.archiveRestore,
      payload: {'channel_ids': restored},
    );
  }
  return restored;
}

/// The archive sweep: every channel whose countdown has passed goes.
///
/// Used to be a nightly `pg_cron` job; it is whichever machine's sync tick
/// runs next now (`mirror_engine_io.dart` calls this before draining its
/// queue, so the tombstones and the R2 side go out in the same pass). Two
/// machines sweeping the same channel is harmless: the second finds no row.
///
/// Refuses, as the server did, a channel somebody has a deal or an outreach
/// thread with — a rejected channel the agency actually negotiated with is
/// a contradiction for a person to settle, and archiving it would cascade
/// the negotiation away. Also refuses a countdown whose tags are no longer
/// rejecting (a stale date), rather than deleting on the strength of a
/// decision that was reversed.
///
/// Returns how many were archived.
Future<int> sweepDueArchives(LocalSyncDb db, {DateTime? now}) async {
  final cutoff = (now ?? DateTime.now()).toUtc().toIso8601String();
  final rows = await db.getAll(
    'SELECT c.channel_id, c.channel_tags FROM influencer_channels c '
    'WHERE c.archive_due_at IS NOT NULL AND c.archive_due_at <= ? '
    '  AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.channel_id = c.channel_id) '
    '  AND NOT EXISTS (SELECT 1 FROM outreach_threads t '
    '                  WHERE t.channel_id = c.channel_id) '
    'ORDER BY c.archive_due_at',
    [cutoff],
  );
  final entries = <({String channelId, String label})>[];
  for (final row in rows) {
    final label = rejectingLabelOf(decodeStringList(row['channel_tags']));
    if (label == null) continue;
    entries.add((channelId: '${row['channel_id']}', label: label));
  }
  return archiveChannelsLocally(db, entries);
}

/// The label a channel would be archived under: the strongest rejecting tag
/// it carries, per `ChannelTag.rejecting`'s order — or null when its tags
/// are not all rejecting ones, which is the server's `channel_is_rejected`
/// rule.
String? rejectingLabelOf(List<String> tags) {
  if (tags.isEmpty) return null;
  final parsed = <ChannelTag>[];
  for (final wire in tags) {
    final tag = ChannelTag.fromWire(wire);
    if (tag == null || !ChannelTag.rejecting.contains(tag)) return null;
    parsed.add(tag);
  }
  for (final tag in ChannelTag.rejecting) {
    if (parsed.contains(tag)) return tag.wire;
  }
  return null;
}
