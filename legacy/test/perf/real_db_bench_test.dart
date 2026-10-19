import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/sync/event_loop_lag.dart';
import 'package:gratovo_toolbox/core/sync/mirror_database.dart';
import 'package:gratovo_toolbox/data/models/activity_log_query.dart';
import 'package:gratovo_toolbox/data/models/channel_stats.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/local_archive.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_activity_log_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_archive_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_brand_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_channel_stats_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_deal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_news_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_reminder_repository.dart';

import 'bench_support.dart';

/// Opt-in benchmark of the local database layer over a real, large database.
///
/// Skipped unless `GRATOVO_BENCH_DB` names a `gratovo.db` — always a COPY: the
/// open below runs the app's migrations and rewrites the `influencer_channels`
/// view in place. Prints one `BENCH` line per measurement. Run it from a
/// worktree with
///
///     $env:GRATOVO_BENCH_DB = 'C:\scratch\gratovo.db'
///     flutter test test/perf/real_db_bench_test.dart
///
/// Numbers come from `flutter test` (Dart JIT with asserts on), so the Dart
/// side of each figure is pessimistic against a release build; the SQLite side
/// is the same native code either way.
final _path = Platform.environment['GRATOVO_BENCH_DB'];

void main() {
  test(
    'real-database benchmark',
    () async {
      final path = _path!;
      final lines = <String>[];
      void report(String name, ({double first, double median, double min}) t) {
        final line = 'BENCH ${name.padRight(46)} first ${_f(t.first)}  '
            'median ${_f(t.median)}  min ${_f(t.min)}  ms';
        lines.add(line);
        // ignore: avoid_print
        print(line);
      }

      // ---- open + migrate -------------------------------------------------
      final openWatch = Stopwatch()..start();
      var mirror = MirrorDatabase.open(path);
      openWatch.stop();
      final firstOpen = openWatch.elapsedMicroseconds / 1000;
      mirror.close();

      final reopen = await timeIt(() async {
        final again = MirrorDatabase.open(path);
        again.close();
      }, runs: 4);
      report('MirrorDatabase.open (first, then reopen)',
          (first: firstOpen, median: reopen.median, min: reopen.min));

      mirror = MirrorDatabase.open(path);
      final db = RecordingDb(mirror);
      const actor = SyncActor(id: 'bench', name: 'Bench');

      final influencers = MirrorInfluencerRepository(db, actor: actor);
      final archive = MirrorArchiveRepository(db);
      final stats = MirrorChannelStatsRepository(db);
      final deals = MirrorDealRepository(db);
      final reminders = MirrorReminderRepository(db);
      final outreach = MirrorOutreachRepository(db);
      final news = MirrorNewsRepository(db);
      final activity = MirrorActivityLogRepository(db);
      final brands = MirrorBrandRepository(db);

      final startOfToday = DateTime.now().copyWith(
          hour: 0, minute: 0, second: 0, millisecond: 0, microsecond: 0);

      // ---- dashboard: the tiles ------------------------------------------
      report(
        'tiles: newFinds count',
        await timeIt(() => influencers
            .countByVettingStatus(VettingStatus.newlyFound)
            .then((_) {})),
      );
      report('tiles: archiveDue count',
          await timeIt(() => influencers.countArchiveDue().then((_) {})));
      report(
          'tiles: allDeals', await timeIt(() => deals.getAll().then((_) {})));
      report(
        'tiles: emails sent today',
        await timeIt(
            () => outreach.countOutboundSince(startOfToday).then((_) {})),
      );
      report(
        'tiles: drafted today',
        await timeIt(
            () => reminders.countCreatedSince(startOfToday).then((_) {})),
      );
      report('reminders: upcoming',
          await timeIt(() => reminders.getUpcoming().then((_) {})));
      report(
        'news: peek (100 items)',
        await timeIt(() => news.getItems(limit: 100).then((_) {})),
      );
      report(
        'logs: first page (40)',
        await timeIt(() => activity
            .getPage(offset: 0, limit: 40, query: const ActivityLogQuery())
            .then((_) {})),
      );

      // ---- dashboard: analytics ------------------------------------------
      db.reset();
      final analytics = await timeIt(
          () => stats.load(const ChannelStatsQuery()).then((_) {}));
      report('analytics: stats.load (unfiltered)', analytics);
      // One run's worth of statements, for the breakdown below.
      db.reset();
      await stats.load(const ChannelStatsQuery());
      final breakdown = [...db.log]
        ..sort((a, b) => b.micros.compareTo(a.micros));
      for (final record in breakdown.take(6)) {
        final line =
            'BENCH   . ${(record.micros / 1000).toStringAsFixed(1)} ms '
            '${record.shortSql}';
        lines.add(line);
        // ignore: avoid_print
        print(line);
      }
      report('analytics: stats.facets',
          await timeIt(() => stats.facets().then((_) {})));

      // ---- dashboard: keyword distribution -------------------------------
      report(
        'keywords: influencer.keywordViewSamples',
        await timeIt(() => influencers.keywordViewSamples().then((_) {})),
      );
      report(
        'keywords: archive.keywordViewSamples',
        await timeIt(() => archive.keywordViewSamples().then((_) {})),
      );

      // ---- lists ----------------------------------------------------------
      report(
        'list: influencers first page (50, default sort)',
        await timeIt(
            () => influencers.getPage(offset: 0, limit: 50).then((_) {})),
      );
      report(
        'list: archive first page (50)',
        await timeIt(() => archive.getPage(offset: 0, limit: 50).then((_) {})),
      );
      report('list: brands', await timeIt(() => brands.getAll().then((_) {})));
      report('list: archive.count',
          await timeIt(() => archive.count().then((_) {})));

      // ---- what the sync pass does on this isolate before it downloads ----
      report(
        'sync: sweepDueArchives (empty sweep)',
        await timeIt(() => sweepDueArchives(db).then((_) {})),
      );

      // ---- what the UI isolate feels ------------------------------------
      // The two slow reads, on the real mirror (not the recorder, which has
      // no isolate of its own), with the event loop sampled while they run:
      // the longest the UI isolate went without a turn is what reads as a
      // frozen window.
      Future<void> stall(String name, Future<void> Function() read) async {
        final sampler = EventLoopLagSampler.start(
            interval: const Duration(milliseconds: 4));
        await read();
        await Future<void>.delayed(const Duration(milliseconds: 20));
        sampler.stop();
        final line = 'BENCH ${name.padRight(46)} UI stall '
            '${_f(sampler.worst.inMicroseconds / 1000)} ms';
        lines.add(line);
        // ignore: avoid_print
        print(line);
      }

      const archiveSamplesSql =
          "SELECT json_extract(j.value, '\$.keyword') AS keyword, "
          '  COALESCE(a.median_views_last_30, 0) AS views '
          'FROM channel_archive a, '
          '  json_each(CASE WHEN json_valid(a.found_via) THEN a.found_via '
          "            ELSE '[]' END) AS j";
      await stall('stall: archive samples on the UI isolate',
          () => mirror.getAll(archiveSamplesSql).then((_) {}));
      await stall(
          'stall: archive samples off-thread',
          () => MirrorArchiveRepository(mirror)
              .keywordViewSamples()
              .then((_) {}));
      await stall(
          'stall: stats.load off-thread',
          () => MirrorChannelStatsRepository(mirror)
              .load(const ChannelStatsQuery())
              .then((_) {}));

      mirror.close();
      final out = Platform.environment['GRATOVO_BENCH_OUT'];
      if (out != null) File(out).writeAsStringSync(lines.join('\n'));
    },
    skip: _path == null
        ? 'set GRATOVO_BENCH_DB to a COPY of gratovo.db to run this'
        : false,
    timeout: const Timeout(Duration(minutes: 20)),
  );
}

String _f(double ms) => ms.toStringAsFixed(1).padLeft(8);
