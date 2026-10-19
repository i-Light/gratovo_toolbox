import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:gratovo_toolbox/core/sync/event_loop_lag.dart';
import 'package:gratovo_toolbox/core/sync/mirror_database.dart';
import 'package:gratovo_toolbox/core/sync/mirror_keyset.dart';
import 'package:gratovo_toolbox/core/sync/mirror_network.dart';
import 'package:gratovo_toolbox/core/sync/mirror_schema.dart';
import 'package:gratovo_toolbox/core/sync/mirror_tables.dart';
import 'package:gratovo_toolbox/core/sync/server_schema.dart';
import 'package:gratovo_toolbox/core/sync/sync_diagnostics.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

export 'package:gratovo_toolbox/core/sync/mirror_keyset.dart';
export 'package:gratovo_toolbox/core/sync/mirror_tables.dart';

/// Rows per request on a machine that has never had trouble.
///
/// Big enough that the first sync is a handful of round trips rather than
/// hundreds, small enough that one page decodes and inserts well inside a frame
/// budget. 500 channels is roughly 1 MB on the wire, most of it description
/// text.
const int kMirrorDefaultPageSize = 500;

/// The least time worth starting a page request with.
///
/// A request begun with three seconds of the pass budget left cannot succeed
/// and cannot fail usefully: it spends a round trip to rediscover a deadline
/// that was already known before it was sent. Stopping the pass here instead
/// banks the pages that did land and lets the next one resume from them.
const Duration kMirrorMinPageTime = Duration(seconds: 10);

/// A page that used more than this share of its budget is logged as slow.
///
/// The early warning that did not exist. A timeout is the end of a story that
/// starts weeks earlier with pages creeping from four seconds to twenty, and
/// nothing was writing that down — so every failure arrived, as far as anyone
/// could see, out of nowhere.
const double _slowPageFraction = 0.6;

/// Brings the local mirror up to date with Supabase.
///
/// The download half of what PowerSync used to do, and the reason the app can
/// stop hosting it. The idea is one sentence long: every mirrored table has a
/// server-set timestamp that moves on every write, so "what changed since I
/// last looked" is a range query, and the client only has to remember where it
/// got to. `backend/schema.sql` is the other half.
///
/// This runs through PostgREST as the signed-in person, which is the material
/// improvement over replication. PowerSync read the write-ahead log, which does
/// not apply row level security, so `sync_rules.yaml` was the whole gate on
/// what each client could download and had to restate the `basic`/`full`
/// boundary in YAML. Here a download is subject to exactly the policies every
/// other read is — `channel_outreach_counts` simply returns nothing to a
/// `basic` account, with no rule written twice.
class MirrorPuller {
  MirrorPuller({
    required MirrorDatabase database,
    required SupabaseClient client,
    SyncDiagnostics? diagnostics,
    this.pageSize = kMirrorDefaultPageSize,
  })  : _db = database,
        _client = client,
        _log = diagnostics ?? SyncDiagnostics();

  final MirrorDatabase _db;
  final SupabaseClient _client;
  final SyncDiagnostics _log;

  /// The page size a healthy table reads.
  ///
  /// A ceiling rather than a constant: a table that could not land this many
  /// rows remembers a smaller number and starts there next pass, growing back
  /// towards this one as pages succeed. See [_pageSizeFor] and [_fetchPage].
  final int pageSize;

  /// What this table should ask for, which is the default until a page fails.
  ///
  /// Visible to tests: the whole point of this number is that it survives a
  /// restart, and "the size written last session is the size read this one" is
  /// not observable from [pull] without a server that fails on demand.
  @visibleForTesting
  int pageSizeFor(String table) {
    final stored = int.tryParse(
      _db.readMeta(MirrorMetaKeys.pageSize(table)) ?? '',
    );
    if (stored == null) return pageSize;
    return stored.clamp(kMirrorMinPageSize, pageSize);
  }

  /// Remembers a smaller page for next time, and says so.
  ///
  /// Written the moment a page fails rather than at the end of the pass: a
  /// pass can be killed by the app closing, and the whole value of this number
  /// is that the *next* process does not repeat the request that just failed.
  @visibleForTesting
  void notePageFailure(String table, int requested) {
    final next = mirrorRetryPageSize(requested);
    if (next >= requested) return;
    _db.writeMeta(MirrorMetaKeys.pageSize(table), '$next');
    _log.log(
      'pull.page.shrink',
      'Asking for fewer rows of $table next time.',
      level: SyncLogLevel.warn,
      fields: {'table': table, 'was': requested, 'now': next},
    );
  }

  /// Grows a shrunken table back after a page lands, and forgets the number
  /// entirely once it is back at the default.
  ///
  /// Growth is on success rather than after a counted run of them: a table
  /// that has been reading 31 rows a page has to climb four times to reach 500
  /// again, and making each of those climbs wait for several clean passes
  /// leaves a mirror crawling for a day after one bad ten minutes.
  @visibleForTesting
  void notePageSuccess(String table, int requested) {
    if (requested >= pageSize) return;
    final grown = (requested * 4).clamp(kMirrorMinPageSize, pageSize);
    if (grown >= pageSize) {
      // Null is a delete -- the row goes rather than sitting at the default,
      // so `_sync_meta` only ever holds sizes that mean something.
      _db.writeMeta(MirrorMetaKeys.pageSize(table), null);
    } else {
      _db.writeMeta(MirrorMetaKeys.pageSize(table), '$grown');
    }
    _log.log(
      'pull.page.grow',
      'Asking for more rows of $table next time.',
      fields: {'table': table, 'was': requested, 'now': grown},
    );
  }

  /// One full pass: every table, then the deletions, then the bookkeeping.
  ///
  /// Returns a [MirrorPullReport] rather than throwing, because "the pass
  /// failed" was never one fact. It used to be: the first table that threw
  /// ended the whole pull, so a slow `channels` meant `videos`,
  /// `channel_keywords`, the archive, the conflicts and the deletion log were
  /// all skipped too — none of which had anything wrong with them. A machine
  /// with one struggling table stopped syncing five healthy ones, for hours.
  ///
  /// Now every table is attempted, each records its own outcome, and the pass
  /// reports which ones got through. The caller shows the failures and tries
  /// again sooner; the tables that worked are already up to date.
  ///
  /// [MirrorMetaKeys.hasSynced] is written only by a *clean* pass, and that is
  /// load-bearing: it is the flag that switches every screen in the app over to
  /// reading the local file, and a half-downloaded channels table that
  /// announced itself as ready would show the team a list with rows missing
  /// from it and no indication anything was wrong.
  Future<MirrorPullReport> pull({MirrorDeadline? deadline}) async {
    final clock = deadline ?? MirrorDeadline.unbounded();
    final startedAt = DateTime.now();
    final failures = <MirrorPullFailure>[];
    var written = 0;
    var incomplete = false;
    _probed = false;

    _log.log('pull.start', 'Starting a download pass.', fields: {
      'tables': mirrorTables.length,
      'pageSize': pageSize,
      'budgetSec': clock.budget.inSeconds,
      'hasSynced': hasSynced,
      'lastSyncedAt': lastSyncedAt?.toIso8601String(),
    });

    try {
      await _resyncIfBehindHorizon();
      // Before the data pull, not after — see the method's own note on ordering.
      _seedTombstoneCursor();
    } catch (error) {
      // Recorded and carried on with rather than aborting. Neither of these
      // decides what gets downloaded, only whether a delta is still safe to
      // trust, and the next pass asks again — where refusing to pull at all
      // would leave the mirror stale for a question about the deletion log.
      failures.add(MirrorPullFailure('bookkeeping', error));
    }

    for (final table in mirrorTables) {
      if (!clock.hasRoomFor(kMirrorMinPageTime)) {
        incomplete = true;
        break;
      }
      final result = await _pullTable(table, clock);
      written += result.written;
      incomplete = incomplete || result.ranOutOfTime;
      if (result.error != null) {
        failures.add(MirrorPullFailure(table.name, result.error!));
      }
    }

    if (clock.hasRoomFor(kMirrorMinPageTime)) {
      final tombstones = await _pullTombstones(clock);
      written += tombstones.written;
      incomplete = incomplete || tombstones.ranOutOfTime;
      if (tombstones.error != null) {
        failures.add(MirrorPullFailure(_tombstoneTable, tombstones.error!));
      }
    } else {
      incomplete = true;
    }

    if (incomplete) {
      _log.log(
        'pull.incomplete',
        'The pass ran out of its time budget. What came down is kept; the '
            'next pass continues from here.',
        level: SyncLogLevel.warn,
        fields: {
          'budgetSec': clock.budget.inSeconds,
          'spentMs': clock.spent.inMilliseconds,
          'written': written,
        },
      );
    }

    if (failures.isEmpty && !incomplete) {
      _db.writeMeta(MirrorMetaKeys.hasSynced, 'true');
      _db.writeMeta(
        MirrorMetaKeys.lastSyncedAt,
        DateTime.now().toUtc().toIso8601String(),
      );
    }

    final report = MirrorPullReport(
      written: written,
      failures: failures,
      incomplete: incomplete,
      elapsed: DateTime.now().difference(startedAt),
    );
    _log.log(
      'pull.end',
      failures.isEmpty
          ? 'Download pass finished.'
          : 'Download pass finished with ${failures.length} table(s) '
              'incomplete.',
      level: failures.isEmpty ? SyncLogLevel.info : SyncLogLevel.error,
      fields: {
        'written': written,
        'elapsedMs': report.elapsed.inMilliseconds,
        'failed': failures.isEmpty
            ? null
            : [for (final failure in failures) failure.table].join(','),
        'incomplete': incomplete,
        'markedSynced': report.complete,
      },
    );
    return report;
  }

  /// Whether a first full pass has ever finished on this machine.
  ///
  /// Until it has, an empty local table means "not downloaded yet" and not "no
  /// channels" — which is why `localMirrorProvider` refuses to hand the mirror
  /// to a repository before this is true.
  bool get hasSynced => _db.readMeta(MirrorMetaKeys.hasSynced) == 'true';

  DateTime? get lastSyncedAt {
    final raw = _db.readMeta(MirrorMetaKeys.lastSyncedAt);
    return raw == null ? null : DateTime.tryParse(raw);
  }

  // ---------------------------------------------------------------------------
  // The horizon check
  // ---------------------------------------------------------------------------

  /// Starts again from empty if this machine has been away too long.
  ///
  /// Tombstones are purged after 90 days (`purge_sync_tombstones`), and a
  /// client whose tombstone cursor predates the purge cannot know which rows
  /// went away while it was gone. The alternative to re-syncing is a mirror
  /// quietly showing channels the team archived months ago, with nothing about
  /// the stale rows to say they are stale.
  ///
  /// Unsent edits survive this — see [MirrorDatabase.wipeData].
  Future<void> _resyncIfBehindHorizon() async {
    final cursor = _db.readMeta(MirrorMetaKeys.cursorValue(_tombstoneTable));
    // Nothing downloaded yet: there is no delta to be behind on, and the first
    // pull sees current state by definition.
    if (cursor == null) return;

    final rows = await runMirrorRequest(
      what: 'read the deletion horizon',
      event: 'pull.horizon',
      log: _log,
      call: () => _client
          .from('sync_control')
          .select('tombstones_purged_before')
          .limit(1),
    );
    if (rows.isEmpty) return;

    final horizonText = rows.first['tombstones_purged_before'] as String?;
    final horizon = horizonText == null ? null : DateTime.tryParse(horizonText);
    final mine = DateTime.tryParse(cursor);
    if (horizon == null || mine == null) return;

    if (mine.isBefore(horizon)) {
      _log.log(
        'pull.resync',
        'This machine has been away longer than the server keeps deletions. '
            'Re-downloading the mirror from scratch; queued edits are kept.',
        level: SyncLogLevel.warn,
        fields: {
          'mine': mine.toIso8601String(),
          'horizon': horizon.toIso8601String(),
        },
      );
      _db.wipeData();
    }
  }

  /// On an empty mirror, skips the deletion backlog instead of replaying it.
  ///
  /// A fresh data pull already reflects every deletion that has happened: a
  /// channel the sweep removed is simply not in the response. Replaying up to
  /// 90 days of tombstones on top of that is not merely wasted work — it is
  /// **wrong**, because a tombstone is not a statement about the present.
  ///
  /// Archiving a channel deletes it and leaves a tombstone. Adding that same
  /// channel back by hand creates a live row again, and the tombstone stays
  /// where it is. A first sync that pulled the live row and then applied the
  /// older tombstone would delete a channel somebody had deliberately re-added
  /// — and, because the cursor would then be past it, would keep the mirror
  /// wrong until the next full re-sync.
  ///
  /// So on an empty cursor the client records the moment it is about to start
  /// downloading and starts listening for tombstones from there.
  ///
  /// **Seeded before the data pull, deliberately, and to "now" rather than to
  /// the newest existing tombstone.** The initial data pull is not one
  /// round trip: [MirrorDeadline] budgets it across many real sessions, and on
  /// a large team's first sync it can take days to actually reach the
  /// present. The previous version of this method anchored to whatever
  /// tombstone happened to be newest *at seeding time* — found by querying
  /// `sync_tombstones` itself — which is exactly the row a nightly sweep
  /// running partway through that multi-day backfill had just written for a
  /// channel this same backfill had already fetched (old, rarely-touched rows
  /// sort early in the `updated_at` order the channel pull uses). Seeding to
  /// that row treated it as "already accounted for" and never applied it,
  /// orphaning the just-fetched live copy of that channel locally forever —
  /// every later sync's cursor already sat past it.
  ///
  /// A wall-clock anchor closes that window: it does not depend on a
  /// tombstone already existing, so it cannot land on one written mid-backfill.
  /// Anything deleted before this moment is still skipped, preserving the
  /// resurrection guard above; anything deleted from this moment on — which is
  /// every tombstone a sweep could possibly write while the backfill is still
  /// running — sorts after it and is picked up by the ordinary keyset pull.
  /// No key is stored alongside it: [buildKeysetFilter] with no key asks only
  /// `deleted_at.gt.cursor`, which is exactly "everything from here on".
  void _seedTombstoneCursor() {
    if (_db.readMeta(MirrorMetaKeys.cursorValue(_tombstoneTable)) != null) {
      return;
    }
    _db.writeMeta(
      MirrorMetaKeys.cursorValue(_tombstoneTable),
      DateTime.now().toUtc().toIso8601String(),
    );
  }

  // ---------------------------------------------------------------------------
  // Paging
  // ---------------------------------------------------------------------------

  Future<_TableResult> _pullTable(
      MirrorTable table, MirrorDeadline clock) async {
    var written = 0;
    var pages = 0;
    final startedAt = DateTime.now();

    while (true) {
      // Checked before every page, not only before the table: a table with
      // eleven pages left must be able to stop after the third and have the
      // next pass pick up at the fourth.
      if (!clock.hasRoomFor(kMirrorMinPageTime)) {
        return _TableResult(written: written, pages: pages, ranOutOfTime: true);
      }

      final cursor = _db.readMeta(MirrorMetaKeys.cursorValue(table.name));
      final key = _db.readMeta(MirrorMetaKeys.cursorKey(table.name));

      final _Page page;
      try {
        page = await _fetchPage(table, cursor, key, pages, clock);
      } catch (error) {
        // The table stops here and the pass carries on to the next one. What
        // has already landed stays: the cursor is written page by page, so the
        // next attempt resumes from the last page that made it rather than
        // starting the table again.
        await _probeAfterFailure(table, cursor, key, clock);
        return _TableResult(written: written, pages: pages, error: error);
      }
      pages++;
      final rows = page.rows;
      if (rows.isEmpty) {
        _finishTable(table, written, pages, startedAt);
        return _TableResult(written: written, pages: pages);
      }

      _applyPage(table, rows);
      written += rows.length;

      // Advance from the last row of the page, which the ordering guarantees is
      // the highest. Written after the rows are in, so an interruption re-reads
      // one page rather than skipping it — every insert is an INSERT OR REPLACE
      // and re-reading is free.
      final last = rows.last;
      final nextCursor = '${last[table.cursor]}';
      final nextKey =
          encodeCursorKey([for (final column in table.keys) '${last[column]}']);

      // A full page whose last row is the row we already resumed from means the
      // keyset filter is not advancing, and asking again would fetch the
      // identical page forever. That loop is unreachable while the cursor column
      // and the key columns behave — but "unreachable" here would cost a `pull()`
      // that never returns, which is a hang with no error, no retry and no way
      // out but restarting the app. Stopping leaves the mirror one page behind
      // and says so, which the next pass can still recover from.
      if (nextCursor == cursor && nextKey == key) {
        _log.log(
          'pull.stalled',
          'Stopped paging ${table.name}: the cursor did not move past '
              '$nextCursor. The rest of this table waits for the next sync.',
          level: SyncLogLevel.warn,
          fields: {
            'table': table.name,
            'cursor': nextCursor,
            'key': nextKey,
            'rows': rows.length,
            'pageSize': page.requested,
          },
        );
        return _TableResult(written: written, pages: pages);
      }

      _db.writeMeta(MirrorMetaKeys.cursorValue(table.name), nextCursor);
      _db.writeMeta(MirrorMetaKeys.cursorKey(table.name), nextKey);

      // A short page is the last page — measured against what this page
      // actually asked for, not against [pageSize], because a table that has
      // been shrunk asks for less and a full page of 125 is not a short page of
      // 500. Getting that wrong would end every table one page early and leave
      // the mirror permanently a page behind.
      if (rows.length < page.requested) {
        _finishTable(table, written, pages, startedAt);
        return _TableResult(written: written, pages: pages);
      }
    }
  }

  /// Fetches one page, at the size this table has learned it can land.
  ///
  /// The failure this answers, from the flight recorder, repeated every pass
  /// for hours across five restarts:
  ///
  ///     pull.page.failed  table=channels pageSize=500 elapsedMs=60003
  ///                       attempt=1 of=3 passLeftMs=59765
  ///                       loopLagMaxMs=4 loopSamples=300
  ///     pull.probe.reach  ok=true elapsedMs=511
  ///     pull.probe.query  ok=true rows=1 elapsedMs=302   <- same query, one row
  ///
  /// Three things in that, all of which shape this method:
  ///
  ///  * The server is up and answering. The same query for a single row comes
  ///    back in 300 ms, and every other table finishes in about 100 ms. Only
  ///    the 500-row page — around 700 kB of channels — never arrives.
  ///  * `loopLagMaxMs=4` over 300 samples says the event loop was idle, so the
  ///    isolate was not too busy to read the socket. That still does not clear
  ///    the client: the log's failing sessions are all `mode=debug`, and no
  ///    large page has ever completed in one. Running the release build is the
  ///    experiment that separates the last two candidates, and it is cheap.
  ///  * `attempt=1 of=3` with `passLeftMs=59765`. **The retry never happened.**
  ///    A 60-second page inside a 120-second pass leaves less than
  ///    [kMirrorProbeReserve] plus a page, so `again` is false on the first
  ///    failure. Every "of=3" in this log is one attempt.
  ///
  /// That last one is why shrinking has to be remembered rather than laddered.
  /// A pass gets one attempt, so the smaller ask has to be what the *next*
  /// pass starts with — and it has to survive the app closing, because the
  /// mirror was stuck on the same page across five launches. So a failed page
  /// writes `page_size.<table>` (500, then 125, then 31, floor
  /// [kMirrorMinPageSize]) and a page that lands grows it back, deleting the
  /// row once the table is reading full pages again.
  ///
  /// What made this unrecoverable was never the failed page: it was the cursor
  /// behind it. A table that cannot land its first page never advances, so the
  /// identical doomed request is what the next pass asks for, and the next,
  /// while everything queued behind it waits. Anything that lands moves the
  /// cursor, which is the difference between "stuck since Tuesday" and
  /// "behind, and catching up".
  ///
  /// This is a smaller thing than the ladder that used to live here — that one
  /// tried 500, 250, 125, 62 and 25 *inside a single pass*, turning one
  /// 45-second failure into four minutes per table and a pass into half an
  /// hour, which is what people actually reported: not an error, a spinner
  /// that would not end. One attempt per pass cannot do that. A retry is still
  /// worth having for a plain blip — a Wi-Fi roam, a pooler recycling a
  /// connection, a token refreshed on another future — so when there is room
  /// for one it happens, at a quarter of the size.
  Future<_Page> _fetchPage(
    MirrorTable table,
    String? cursor,
    String? key,
    int index,
    MirrorDeadline clock,
  ) async {
    var requested = pageSizeFor(table.name);

    for (var attempt = 1;; attempt++) {
      // Clamped, so the last request of a pass cannot overrun the budget that
      // is meant to bound it — and held back off the probe reserve, so that a
      // page which spends its whole budget cannot leave the pass with nothing
      // to diagnose itself with. See [kMirrorProbeReserve].
      final budget = clock.clampLeaving(
        mirrorTimeoutForRows(requested),
        kMirrorProbeReserve,
      );
      final started = DateTime.now();
      final lag = EventLoopLagSampler.start();
      try {
        final rows = await _pageQuery(table, cursor, key, requested)
            .withMirrorTimeout('download ${table.name}', budget);
        lag.stop();
        _notePage(
          table: table,
          index: index,
          attempt: attempt,
          requested: requested,
          rows: rows,
          elapsed: DateTime.now().difference(started),
          budget: budget,
          cursor: cursor,
          lag: lag,
        );
        if (requested < pageSize) notePageSuccess(table.name, requested);
        return _Page(rows: rows, requested: requested);
      } catch (error) {
        lag.stop();
        final elapsed = DateTime.now().difference(started);
        final transient = isTransientMirrorFailure(error);
        // The probe reserve is part of the price of a retry, not something the
        // retry may borrow from. Without it the arithmetic works out exactly
        // wrong: a 120-second pass fits two 60-second attempts to the
        // millisecond, so every failure reached [_probeAfterFailure] with
        // `passLeftMs=0` and skipped it. Three sessions of "the server did not
        // answer" and not one measurement of whether the server had, in fact,
        // been asked.
        final again = transient &&
            attempt < kMirrorAttempts &&
            clock.hasRoomFor(kMirrorMinPageTime +
                mirrorAttemptDelay(attempt) +
                kMirrorProbeReserve);

        _log.log(
          again ? 'pull.page.retry' : 'pull.page.failed',
          again
              ? 'Page ${index + 1} of ${table.name} failed; trying again.'
              : 'Gave up on page ${index + 1} of ${table.name}.',
          level: again ? SyncLogLevel.warn : SyncLogLevel.error,
          fields: {
            'table': table.name,
            'page': index + 1,
            'attempt': attempt,
            'of': kMirrorAttempts,
            'pageSize': requested,
            'elapsedMs': elapsed.inMilliseconds,
            'budgetMs': budget.inMilliseconds,
            'passLeftMs': clock.remaining.inMilliseconds,
            'transient': transient,
            'cursor': cursor,
            // What separates "the server never answered" from "this process was
            // too busy to listen". A request cannot outlast the wire it travels
            // on unless the isolate waiting for it is starved, and Dart reads
            // sockets on the same isolate that runs the UI and the synchronous
            // sqlite3 calls behind it.
            'loopLagMaxMs': lag.worst.inMilliseconds,
            'loopSamples': lag.samples,
          },
          error: error,
        );

        // Recorded on the way out as well as on the way round: a pass that has
        // no room for another attempt -- which, with a 60-second page and a
        // 50-second probe reserve inside a 120-second pass, is every pass that
        // fails on its first page -- would otherwise learn nothing at all from
        // the minute it just spent.
        if (transient) notePageFailure(table.name, requested);
        if (!again) rethrow;
        // A quarter of the last ask, with a floor: below about twenty-five rows
        // the round trip dominates and the pages needed to drain a real backlog
        // stop being worth their own latency.
        requested = mirrorRetryPageSize(requested);
        await Future<void>.delayed(mirrorAttemptDelay(attempt));
      }
    }
  }

  /// The page request itself, composed fresh for every attempt.
  ///
  /// Fresh rather than reused because a PostgREST builder is a single-use
  /// future: awaiting the same one twice returns the same already-completed
  /// (already-failed) result, which would make every retry above a no-op that
  /// reported the first attempt's error three times.
  Future<List<Map<String, dynamic>>> _pageQuery(
    MirrorTable table,
    String? cursor,
    String? key,
    int limit,
  ) {
    var filter = _client.from(table.name).select(table.remoteColumns.join(','));
    if (cursor != null) {
      filter = filter.or(_keysetFilter(table, cursor, key));
    }
    var ordered = filter.order(table.cursor, ascending: true);
    for (final column in table.keys) {
      ordered = ordered.order(column, ascending: true);
    }
    return ordered.limit(limit);
  }

  /// Writes down what a page cost, whether or not anything went wrong.
  ///
  /// The healthy lines are the point. A timeout on its own says nothing; a
  /// timeout underneath ten lines showing pages that took four, five, nine,
  /// fourteen and twenty-two seconds says the connection is degrading, and a
  /// timeout underneath ten lines of four seconds each says something changed
  /// abruptly. Same failure, opposite investigations.
  void _notePage({
    required MirrorTable table,
    required int index,
    required int attempt,
    required int requested,
    required List<Map<String, dynamic>> rows,
    required Duration elapsed,
    required Duration budget,
    required String? cursor,
    required EventLoopLagSampler lag,
  }) {
    final slow =
        elapsed.inMilliseconds > budget.inMilliseconds * _slowPageFraction;
    final bytes = _estimateBytes(rows);
    final seconds = elapsed.inMilliseconds / 1000;

    _log.log(
      slow ? 'pull.page.slow' : 'pull.page',
      slow
          ? 'Page ${index + 1} of ${table.name} used most of its time budget.'
          : 'Page ${index + 1} of ${table.name}.',
      level: slow ? SyncLogLevel.warn : SyncLogLevel.debug,
      fields: {
        'table': table.name,
        'page': index + 1,
        'attempt': attempt,
        'pageSize': requested,
        'rows': rows.length,
        'elapsedMs': elapsed.inMilliseconds,
        'budgetMs': budget.inMilliseconds,
        'approxBytes': bytes,
        // The two rates that separate "the server is slow" from "the link is
        // slow": a page moving 40 kB/s is a network problem no matter how few
        // rows it carried, and one moving 3 rows/s at 2 MB/s is a query problem.
        'kbPerSec': seconds <= 0 ? null : (bytes / 1024 / seconds).round(),
        'rowsPerSec': seconds <= 0 ? null : (rows.length / seconds).round(),
        // Logged on the healthy pages too, because a baseline is what makes the
        // number on a failed page mean anything. A page that succeeded with
        // `loopLagMaxMs=8` and one that failed with `loopLagMaxMs=41000` are the
        // same finding stated twice.
        'loopLagMaxMs': lag.worst.inMilliseconds,
        'cursor': cursor,
      },
    );
  }

  /// Roughly how much came down, without encoding the whole page to find out.
  ///
  /// Sampled rather than exact: twenty rows out of five hundred is inside a few
  /// percent for rows of this shape, and the number is only ever read as an
  /// order of magnitude. Exactness here would mean JSON-encoding a megabyte on
  /// every page purely to write one field in a log.
  static int _estimateBytes(List<Map<String, dynamic>> rows) {
    if (rows.isEmpty) return 0;
    try {
      const sampleSize = 20;
      final step = rows.length <= sampleSize ? 1 : rows.length ~/ sampleSize;
      var sampled = 0;
      var total = 0;
      for (var i = 0; i < rows.length && sampled < sampleSize; i += step) {
        total += jsonEncode(rows[i]).length;
        sampled++;
      }
      if (sampled == 0) return 0;
      return (total / sampled * rows.length).round();
    } catch (_) {
      return 0;
    }
  }

  /// Two questions asked the moment a table gives up, while the conditions that
  /// caused it are still there.
  ///
  /// This is the single most useful thing in the log, because it settles by
  /// itself the question that used to take a day of guessing:
  ///
  ///  * **Both probes fast** — the server is fine and the query is fine, so the
  ///    page was simply too much data for this connection. The shrink is the
  ///    right answer and the log shows it working.
  ///  * **Reach fast, one-row slow** — the server is up but *this query* is
  ///    expensive. That is an index, a policy or a planner problem on the
  ///    server, and no amount of client-side patience fixes it.
  ///  * **Both slow or both failing** — the machine is not really online, or
  ///    Supabase is not answering. Nothing here is wrong.
  ///
  /// Never throws and never counts as a failure: this runs *after* the table
  /// has already been given up on, purely to leave evidence.
  ///
  /// Once per pass, not once per table. Seven tables failing the same way is
  /// one fact, and asking it seven times spent up to five minutes of a pass
  /// re-establishing what the first pair of probes had already shown.
  bool _probed = false;

  Future<void> _probeAfterFailure(
    MirrorTable table,
    String? cursor,
    String? key,
    MirrorDeadline clock,
  ) async {
    if (_probed || !clock.hasRoomFor(const Duration(seconds: 5))) return;
    _probed = true;

    await _probe(
      event: 'pull.probe.reach',
      message: 'Is the server answering anything at all?',
      budget: clock.clamp(const Duration(seconds: 15)),
      call: () => _client
          .from('sync_control')
          .select('tombstones_purged_before')
          .limit(1),
    );
    await _probe(
      event: 'pull.probe.query',
      message: 'Can it answer the same query for a single row?',
      budget: clock.clamp(const Duration(seconds: 30)),
      fields: {'table': table.name},
      call: () => _pageQuery(table, cursor, key, 1),
    );
  }

  Future<void> _probe({
    required String event,
    required String message,
    required Duration budget,
    required Future<List<Map<String, dynamic>>> Function() call,
    Map<String, Object?> fields = const {},
  }) async {
    final started = DateTime.now();
    try {
      final rows = await call().withMirrorTimeout('probe the server', budget);
      _log.log(event, message, level: SyncLogLevel.warn, fields: {
        ...fields,
        'ok': true,
        'rows': rows.length,
        'elapsedMs': DateTime.now().difference(started).inMilliseconds,
      });
    } catch (error) {
      _log.log(
        event,
        message,
        level: SyncLogLevel.warn,
        fields: {
          ...fields,
          'ok': false,
          'elapsedMs': DateTime.now().difference(started).inMilliseconds,
        },
        error: error,
      );
    }
  }

  /// Records a table that finished.
  void _finishTable(
    MirrorTable table,
    int written,
    int pages,
    DateTime startedAt,
  ) {
    final elapsed = DateTime.now().difference(startedAt);
    _log.log('pull.table', 'Finished ${table.name}.', fields: {
      'table': table.name,
      'rows': written,
      'pages': pages,
      'elapsedMs': elapsed.inMilliseconds,
    });
  }

  /// The PostgREST equivalent of "everything after this row in the sort order".
  ///
  /// Written as a keyset rather than `updated_at > cursor` because Postgres
  /// `now()` is transaction time: a search run that upserts 5,000 channels in
  /// one transaction stamps every one of them with the same `updated_at`. A
  /// plain `>` would skip the remainder of that batch forever; a plain `>=`
  /// would fetch the same page forever.
  ///
  /// For a cursor `c` and key columns `k1..kn` it builds
  ///
  ///     c.gt.V, and(c.eq.V,k1.gt.K1), and(c.eq.V,k1.eq.K1,k2.gt.K2)
  ///
  /// which is the standard lexicographic "greater than this tuple".
  String _keysetFilter(MirrorTable table, String cursor, String? key) =>
      buildKeysetFilter(
        cursorColumn: table.cursor,
        keyColumns: table.keys,
        cursor: cursor,
        key: key,
      );

  void _applyPage(MirrorTable table, List<Map<String, dynamic>> rows) {
    final columns = table.localColumns;
    final sql = 'INSERT OR REPLACE INTO ${table.name} '
        '(${columns.join(', ')}) '
        'VALUES (${List.filled(columns.length, '?').join(', ')})';

    final statement = _db.prepare(sql);
    try {
      _db.transactionSync(() {
        for (final row in rows) {
          final local = table.toLocal(row);
          statement.execute([for (final column in columns) local[column]]);
        }
      });
    } finally {
      statement.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Deletions
  // ---------------------------------------------------------------------------

  static const _tombstoneTable = 'sync_tombstones';

  /// Applies whatever was deleted since the last pass.
  ///
  /// Runs after the data pull, not before, so a row deleted mid-pass is removed
  /// rather than left behind by a page that fetched it a moment earlier.
  ///
  /// The cascade is done here rather than recorded server-side: `videos` and
  /// `channel_keywords` are ON DELETE CASCADE from `channels`, so one channel
  /// tombstone stands for the ~13 video rows the archive sweep removes with it.
  /// Applying the same rule locally is both cheaper on the wire and impossible
  /// to get out of step with, because it is the database's own rule.
  Future<_TableResult> _pullTombstones(MirrorDeadline clock) async {
    var applied = 0;
    var pages = 0;
    final startedAt = DateTime.now();

    while (true) {
      if (!clock.hasRoomFor(kMirrorMinPageTime)) {
        return _TableResult(written: applied, pages: pages, ranOutOfTime: true);
      }

      final cursor = _db.readMeta(MirrorMetaKeys.cursorValue(_tombstoneTable));
      final key = _db.readMeta(MirrorMetaKeys.cursorKey(_tombstoneTable));

      final _Page page;
      try {
        page = await _fetchPage(_tombstones, cursor, key, pages, clock);
      } catch (error) {
        await _probeAfterFailure(_tombstones, cursor, key, clock);
        return _TableResult(written: applied, pages: pages, error: error);
      }
      pages++;
      final rows = page.rows;
      if (rows.isEmpty) {
        _finishTable(_tombstones, applied, pages, startedAt);
        return _TableResult(written: applied, pages: pages);
      }

      _db.transactionSync(() {
        for (final row in rows) {
          final id = row['row_id'] as String?;
          final table = row['table_name'] as String?;
          if (id == null || table == null) continue;
          applyTombstone(_db, table: table, rowId: id, log: _log);
          applied++;
        }
      });

      final last = rows.last;
      final nextCursor = '${last['deleted_at']}';
      final nextKey =
          encodeCursorKey(['${last['table_name']}', '${last['row_id']}']);

      // Same guard, and for the same reason, as the data pages above.
      if (nextCursor == cursor && nextKey == key) {
        _log.log(
          'pull.stalled',
          'Stopped paging the deletion log: the cursor did not move past '
              '$nextCursor. The rest waits for the next sync.',
          level: SyncLogLevel.warn,
          fields: {
            'table': _tombstoneTable,
            'cursor': nextCursor,
            'key': nextKey,
            'rows': rows.length,
          },
        );
        return _TableResult(written: applied, pages: pages);
      }

      _db.writeMeta(MirrorMetaKeys.cursorValue(_tombstoneTable), nextCursor);
      _db.writeMeta(MirrorMetaKeys.cursorKey(_tombstoneTable), nextKey);

      if (rows.length < page.requested) {
        _finishTable(_tombstones, applied, pages, startedAt);
        return _TableResult(written: applied, pages: pages);
      }
    }
  }

  static const _tombstones = MirrorTable(
    name: _tombstoneTable,
    cursor: 'deleted_at',
    keys: ['table_name', 'row_id'],
    remoteColumns: ['table_name', 'row_id', 'deleted_at'],
    localColumns: [],
    toLocal: identityRow,
  );
}

// -----------------------------------------------------------------------------
// What a pass came back with
// -----------------------------------------------------------------------------

/// One page, and how it had to be asked for.
///
/// [requested] rather than "the page size" because the two are no longer the
/// same thing: a table that has been shrunk asks for fewer rows, and every
/// "is this the last page?" test has to compare against what was actually
/// asked for.
class _Page {
  const _Page({required this.rows, required this.requested});

  final List<Map<String, dynamic>> rows;

  /// What this page actually asked for, which is what "was it a short page?"
  /// has to be measured against.
  final int requested;
}

class _TableResult {
  const _TableResult({
    required this.written,
    required this.pages,
    this.error,
    this.ranOutOfTime = false,
  });

  final int written;
  final int pages;

  /// Whether the table stopped because the pass ran out of budget rather than
  /// because anything went wrong. Its pages are banked; the next pass resumes.
  final bool ranOutOfTime;

  /// Null when the table finished. Set when it gave up, in which case whatever
  /// [written] says landed is still in the mirror and the cursor still points
  /// at the last page that made it.
  final Object? error;
}

/// One table that did not finish, and why.
class MirrorPullFailure {
  const MirrorPullFailure(this.table, this.error);

  final String table;
  final Object error;

  @override
  String toString() => '$table: ${MirrorPullException.readable(error)}';
}

/// What one download pass achieved.
class MirrorPullReport {
  const MirrorPullReport({
    required this.written,
    required this.failures,
    required this.elapsed,
    this.incomplete = false,
  });

  /// Rows written locally, which the status card uses only to tell "nothing had
  /// changed" apart from "nothing happened".
  final int written;

  final List<MirrorPullFailure> failures;
  final Duration elapsed;

  /// Whether the pass stopped on its own time budget with tables still to
  /// read. Deliberately separate from [failures]: nothing went wrong, there is
  /// simply more to fetch, and the difference decides both what Settings says
  /// and how soon the next pass runs.
  final bool incomplete;

  /// Nothing failed. The mirror is consistent as far as it went, so this is
  /// what "connected" and "no error to show" are read from.
  bool get ok => failures.isEmpty;

  /// Nothing failed AND there is nothing left to fetch. Only this may write
  /// [MirrorMetaKeys.hasSynced] — the flag that tells every screen the local
  /// file is authoritative, which a half-read mirror must never claim.
  bool get complete => failures.isEmpty && !incomplete;
}

/// The download error the Settings card shows, in a sentence somebody can act
/// on.
///
/// What it replaces is the screenshot this whole change came from:
///
///     Sync problem: TimeoutException after 0:00:45.000000: The server did not
///     answer while trying to download channels.
///
/// Every part of that a reader has to skip past — the class name, the padded
/// duration, the doubled colon — is noise from a `toString` written for a stack
/// trace, not for a person. And it left out the one fact that changes what they
/// do: whether *anything* synced. A pass where five tables came down and one
/// did not is a very different morning from one where nothing did.
class MirrorPullException implements Exception {
  const MirrorPullException(this.failures);

  final List<MirrorPullFailure> failures;

  @override
  String toString() {
    if (failures.isEmpty) return 'The download did not finish.';
    final names = [for (final failure in failures) failure.table].join(', ');
    final first = readable(failures.first.error);
    return failures.length == 1
        ? "Couldn't finish downloading $names. $first"
        : "Couldn't finish downloading $names. The first problem was: $first";
  }

  /// An exception as a sentence, without the type name in front of it.
  static String readable(Object error) {
    if (error is TimeoutException) {
      return error.message ?? 'The server did not answer.';
    }
    if (error is PostgrestException) {
      return isServerSchemaBehind(error)
          ? '${error.message}. $kServerSchemaBehindHint'
          : error.message;
    }
    return '$error';
  }
}
