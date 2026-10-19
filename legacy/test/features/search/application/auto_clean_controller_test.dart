import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/archived_channel.dart';
import 'package:gratovo_toolbox/data/models/bulk_archive_due.dart';
import 'package:gratovo_toolbox/data/models/bulk_rejection.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/keyword_view_sample.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/data/repositories/archive_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/data/repositories/search_repository.dart';
import 'package:gratovo_toolbox/features/search/application/auto_clean_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The auto-clean rule, and the sweep it runs without anybody watching.
///
/// The manual dialog's safety is a person reading a count before confirming it.
/// Nothing here has that, so what has to be pinned instead is every condition
/// under which this refuses to act, and the exact narrowness of what it does
/// when it acts: this run's own finds, a tag rather than a delete.
void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('AutoCleanRule', () {
    test('a rule with no bounds is not active, however enabled it is', () {
      // The difference between "clean nothing" and "clean everything", and it
      // has to fall on the safe side without anybody being asked.
      const rule = AutoCleanRule(enabled: true);

      expect(rule.hasBounds, isFalse);
      expect(rule.isActive, isFalse);
    });

    test('bounds without being enabled are not active either', () {
      const rule = AutoCleanRule(maxSubscribers: 1000);

      expect(rule.hasBounds, isTrue);
      expect(rule.isActive, isFalse);
    });

    test('a bound on either range alone is enough', () {
      expect(const AutoCleanRule(enabled: true, minSubscribers: 5).isActive,
          isTrue);
      expect(const AutoCleanRule(enabled: true, maxMedianViews: 5).isActive,
          isTrue);
      // The videos floor counts as a bound on its own too.
      expect(const AutoCleanRule(enabled: true, minVideosLast30: 2).isActive,
          isTrue);
    });

    test('the subscriber field is a keep band — it rejects what is outside it',
        () {
      const rule = AutoCleanRule(
        enabled: true,
        minSubscribers: 50000,
        maxSubscribers: 5000000,
        belowMinAction: AutoCleanBandAction.sweep,
        aboveMaxAction: AutoCleanBandAction.sweep,
        label: ChannelTag.haramStuff,
      );
      final startedAt = DateTime.utc(2026, 3, 1, 9);

      final requests = rule.requestsFor(startedAt);

      expect(requests, hasLength(2));
      // Below the band: reject <= min - 1.
      expect(requests[0].maxSubscribers, 49999);
      expect(requests[0].minSubscribers, isNull);
      // Above the band: reject >= max + 1.
      expect(requests[1].minSubscribers, 5000001);
      expect(requests[1].maxSubscribers, isNull);
      for (final request in requests) {
        expect(request.label, ChannelTag.haramStuff);
        // Scoped to this run's finds, and a countdown rather than a delete.
        expect(request.firstSeenAfter, startedAt);
        expect(request.immediate, isFalse);
        expect(request.isValid, isTrue);
      }
    });

    test('a band set to delay or off produces no post-run request', () {
      const rule = AutoCleanRule(
        enabled: true,
        minSubscribers: 50000,
        maxSubscribers: 5000000,
        belowMinAction: AutoCleanBandAction.delay,
        aboveMaxAction: AutoCleanBandAction.off,
      );

      expect(rule.requestsFor(DateTime.utc(2026)), isEmpty);
    });

    test('average views is a keep band too — rejected outside, after the run',
        () {
      const rule = AutoCleanRule(
        enabled: true,
        minSubscribers: 50000,
        belowMinAction: AutoCleanBandAction.delay, // no subscriber request
        minMedianViews: 20,
        maxMedianViews: 500,
        minVideosLast30: 3,
      );

      final requests = rule.requestsFor(DateTime.utc(2026, 3, 1, 9));

      // below the avg band, above the avg band, and the videos floor.
      expect(requests, hasLength(3));
      expect(requests[0].maxMedianViews, 19); // reject <= min - 1
      expect(requests[1].minMedianViews, 501); // reject >= max + 1
      expect(requests[2].minVideosLast30, 3);
      for (final request in requests) {
        expect(request.minSubscribers, isNull);
        expect(request.maxSubscribers, isNull);
      }
    });

    test('the standing requests are the same rule with no window', () {
      const rule = AutoCleanRule(
        enabled: true,
        minSubscribers: 50000,
        maxSubscribers: 2000000,
        minMedianViews: 20000,
      );

      final standing = rule.standingRequests();
      final windowed = rule.requestsFor(DateTime.utc(2026, 3, 1, 9));

      // One request per band, the same bounds either way.
      expect(standing, hasLength(windowed.length));
      for (final (i, request) in standing.indexed) {
        expect(request.maxSubscribers, windowed[i].maxSubscribers);
        expect(request.minSubscribers, windowed[i].minSubscribers);
        expect(request.maxMedianViews, windowed[i].maxMedianViews);
        expect(request.minMedianViews, windowed[i].minMedianViews);
        // No window; the untouched-only narrowing is the safety instead.
        expect(request.firstSeenAfter, isNull);
        expect(request.untouchedOnly, isTrue);
        expect(request.immediate, isFalse);
      }
      for (final request in windowed) {
        expect(request.untouchedOnly, isFalse);
      }
    });

    test('nothing to reject is an empty list, not an invalid request', () {
      // "Everything that run found", with no bound, is every new channel — the
      // one mistake an automatic caller must not make in silence.
      const rule = AutoCleanRule(enabled: true);

      expect(rule.requestsFor(DateTime.utc(2026)), isEmpty);
    });

    test('run_config carries the keep band and the per-band actions', () {
      const rule = AutoCleanRule(
        enabled: true,
        minSubscribers: 50000,
        maxSubscribers: 5000000,
      );

      expect(rule.toRunConfigJson(), {
        'enabled': true,
        'min_subscribers': 50000,
        'max_subscribers': 5000000,
        'below_min_action': 'sweep',
        'above_max_action': 'delay',
        'label': 'irrelevant',
      });
    });

    test('run_config is null when there is nothing for the pipeline to do', () {
      expect(const AutoCleanRule(minSubscribers: 50000).toRunConfigJson(),
          isNull); // not enabled
      expect(const AutoCleanRule(enabled: true).toRunConfigJson(),
          isNull); // no subscriber range
    });
  });

  group('AutoCleanRule serialisation', () {
    test('round-trips through JSON', () {
      const rule = AutoCleanRule(
        enabled: true,
        minSubscribers: 10,
        maxSubscribers: 1000,
        minMedianViews: 20,
        maxMedianViews: 500,
        minVideosLast30: 3,
        belowMinAction: AutoCleanBandAction.delay,
        aboveMaxAction: AutoCleanBandAction.sweep,
        label: ChannelTag.haramStuff,
      );

      final restored = AutoCleanRule.fromJson(rule.toJson());

      expect(restored.enabled, isTrue);
      expect(restored.minSubscribers, 10);
      expect(restored.maxSubscribers, 1000);
      expect(restored.minMedianViews, 20);
      expect(restored.maxMedianViews, 500);
      expect(restored.minVideosLast30, 3);
      expect(restored.belowMinAction, AutoCleanBandAction.delay);
      expect(restored.aboveMaxAction, AutoCleanBandAction.sweep);
      expect(restored.label, ChannelTag.haramStuff);
    });

    test('an older payload with no band actions restores the defaults', () {
      final restored = AutoCleanRule.fromJson(const {
        'enabled': true,
        'min_subscribers': 50000,
        'max_subscribers': 5000000,
      });

      expect(restored.belowMinAction, AutoCleanBandAction.sweep);
      expect(restored.aboveMaxAction, AutoCleanBandAction.delay);
    });

    test('an unreadable payload comes back off, not half-applied', () {
      // A rule restored from a partial or older payload must never come back on
      // carrying bounds it did not have.
      final restored = AutoCleanRule.fromJson(const {
        'enabled': 'yes',
        'max_subscribers': 'lots',
        'label': 'qualified',
      });

      expect(restored.enabled, isFalse);
      expect(restored.maxSubscribers, isNull);
      // `qualified` is not a label the archive can store, so it is not honoured.
      expect(restored.label, ChannelTag.irrelevant);
    });
  });

  group('AutoCleanRunner', () {
    late _RecordingArchiveRepository repo;
    late _StubSearchRepository searches;
    late ProviderContainer container;

    // The search repository is overridden in every one of these, not only the
    // catch-up tests. `AutoCleanRunner.build` asks it what the last run was,
    // and the real one reads this machine's own `gratovo.db` — which would
    // make the whole group pass or fail depending on whether the developer
    // running it happens to have a finished search on disk.
    setUp(() {
      repo = _RecordingArchiveRepository();
      searches = _StubSearchRepository();
      container = ProviderContainer(
        overrides: [
          archiveRepositoryProvider.overrideWithValue(repo),
          searchRepositoryProvider.overrideWithValue(searches),
          // Otherwise AutoCleanRuleNotifier.build()'s background load hits
          // this machine's real data/settings.local.json (and settings.json)
          // — resolvePaths() finds the real checkout root just fine under
          // `flutter test` — and could race the `.state = rule` writes below.
          autoCleanRuleStoreProvider
              .overrideWithValue(const NoopAutoCleanRuleStore()),
        ],
      );
      addTearDown(container.dispose);
    });

    SearchRun run({
      SearchRunStatus status = SearchRunStatus.completed,
      int channelsFound = 40,
      DateTime? startedAt,
    }) {
      return SearchRun(
        id: 'r1',
        keywords: const ['tractor restoration'],
        startedBy: 'this device',
        startedAt: startedAt ?? DateTime.utc(2026, 3, 1, 9),
        status: status,
        channelsFound: channelsFound,
      );
    }

    Future<AutoCleanReport?> runWith(AutoCleanRule rule, SearchRun forRun) {
      container.read(autoCleanRuleProvider.notifier).state = rule;
      return container.read(autoCleanRunnerProvider.notifier).runFor(forRun);
    }

    test('the house preset: about 50k views, no size cap (HC-18)', () async {
      final notifier = container.read(autoCleanRuleProvider.notifier);
      await notifier.ready;
      notifier.state = const AutoCleanRule(
        enabled: true,
        minSubscribers: 20000,
        maxSubscribers: 2000000,
        minMedianViews: 10000,
        maxMedianViews: 900000,
        minVideosLast30: 1,
      );

      await notifier.applyHouseViewBar();

      final rule = container.read(autoCleanRuleProvider);
      expect(rule.minMedianViews, 45000);
      expect(rule.maxMedianViews, isNull, reason: 'no cap');
      expect(rule.maxSubscribers, isNull, reason: 'no cap');
      // Left as they were: a scraping-cost floor and an activity floor are
      // not size caps, and turning the rule on stays a person's choice.
      expect(rule.minSubscribers, 20000);
      expect(rule.minVideosLast30, 1);
      expect(rule.enabled, isTrue);
    });

    test('an active rule sweeps the run it was given', () async {
      final report = await runWith(
        const AutoCleanRule(enabled: true, minSubscribers: 1000),
        run(startedAt: DateTime.utc(2026, 3, 1, 9)),
      );

      expect(report?.failed, isFalse);
      expect(report?.outcome?.tagged, 7);

      final call = repo.calls.single;
      // Applied directly, with no dry run first. The check-then-confirm pair
      // exists so a person reads a count; there is no person here, and two
      // calls would only mean the count and the rows could describe different
      // sets.
      expect(call.dryRun, isFalse);
      expect(call.request.firstSeenAfter, DateTime.utc(2026, 3, 1, 9));
      expect(call.request.maxSubscribers, 999); // reject <= keep-from - 1
    });

    test('a rule that is off never reaches the database', () async {
      final report = await runWith(
        const AutoCleanRule(maxSubscribers: 1000),
        run(),
      );

      expect(report, isNull);
      expect(repo.calls, isEmpty);
    });

    test('an enabled rule with no bounds never reaches the database', () async {
      final report = await runWith(const AutoCleanRule(enabled: true), run());

      expect(report, isNull);
      expect(repo.calls, isEmpty);
    });

    // Stopping a long run early is the ORDINARY way one ends, and a run that
    // was stopped found real channels. Requiring `completed` meant the rule
    // almost never fired — the bug this widening fixes. The safety was never in
    // the status: `firstSeenAfter` still pins the sweep to this run's own
    // window, so a run that fell over having found nothing matches nothing.
    test('a stopped run is swept, like any other ended run', () async {
      final report = await runWith(
        const AutoCleanRule(enabled: true, minSubscribers: 1000),
        run(status: SearchRunStatus.stopped),
      );

      expect(report?.outcome?.tagged, 7);
      expect(repo.calls.single.request.firstSeenAfter,
          DateTime.utc(2026, 3, 1, 9));
    });

    test('a failed run is swept too, within its own window', () async {
      final report = await runWith(
        const AutoCleanRule(enabled: true, minSubscribers: 1000),
        run(status: SearchRunStatus.failed),
      );

      expect(report?.outcome?.tagged, 7);
      expect(repo.calls, hasLength(1));
    });

    test('a run still going is never swept', () async {
      // The one status that must not sweep: the window is still filling, and
      // the channels it would reach are the ones the run is in the middle of
      // finding.
      final report = await runWith(
        const AutoCleanRule(enabled: true, minSubscribers: 1000),
        run(status: SearchRunStatus.running),
      );

      expect(report, isNull);
      expect(repo.calls, isEmpty);
    });

    test('a run that found nothing is not swept', () async {
      // Provably nothing in the window, so the call could only be a destructive
      // statement made for no reason.
      final report = await runWith(
        const AutoCleanRule(enabled: true, minSubscribers: 1000),
        run(channelsFound: 0),
      );

      expect(report, isNull);
      expect(repo.calls, isEmpty);
    });

    test('a refusal is reported, not thrown at the search', () async {
      // This is a side effect of a search finishing. A failure here must not
      // reach the user as the search itself having failed.
      repo.throws = true;

      final report = await runWith(
        const AutoCleanRule(enabled: true, minSubscribers: 1000),
        run(),
      );

      expect(report?.failed, isTrue);
      expect(report?.outcome, isNull);
      expect(container.read(autoCleanRunnerProvider)?.failed, isTrue);
    });
  });

  // The case no live listener can ever catch: a run whose process is killed
  // WITH the app. There is no `running` -> finished transition in the session
  // that died, and the next session starts with no live run at all — so before
  // this existed, those channels were never swept by anything.
  group('AutoCleanRunner catching up on launch', () {
    late _RecordingArchiveRepository repo;
    late _StubSearchRepository searches;

    ProviderContainer containerWith(AutoCleanRule rule) {
      final container = ProviderContainer(
        overrides: [
          archiveRepositoryProvider.overrideWithValue(repo),
          searchRepositoryProvider.overrideWithValue(searches),
          autoCleanRuleStoreProvider
              .overrideWithValue(const NoopAutoCleanRuleStore()),
        ],
      );
      addTearDown(container.dispose);
      container.read(autoCleanRuleProvider.notifier).state = rule;
      return container;
    }

    /// Builds the runner and lets its fire-and-forget catch-up — and the
    /// standing sweep that follows it — settle. Both wait on the rule
    /// notifier's `ready` first, which is a few event-loop turns of its own.
    Future<void> launch(AutoCleanRule rule) async {
      final container = containerWith(rule);
      container.read(autoCleanRunnerProvider);
      await container.read(autoCleanRuleProvider.notifier).ready;
      for (var i = 0; i < 8; i++) {
        await Future<void>.delayed(Duration.zero);
      }
    }

    /// The catch-up's own calls: the ones pinned to a run's window. The
    /// standing sweep's are the rest, and are asserted on separately.
    List<_Call> windowed() =>
        repo.calls.where((c) => c.request.firstSeenAfter != null).toList();
    List<_Call> standing() =>
        repo.calls.where((c) => c.request.firstSeenAfter == null).toList();

    setUp(() {
      repo = _RecordingArchiveRepository();
      searches = _StubSearchRepository()
        ..current = SearchRun(
          id: 'run_53',
          keywords: const [],
          startedBy: '',
          // What `store.reconcile_stale_runs` leaves behind for a run whose
          // process was killed: ended, with the channels it did find.
          startedAt: DateTime.utc(2026, 3, 1, 9),
          status: SearchRunStatus.stopped,
          channelsFound: 208,
        );
    });

    test('sweeps the last run when nothing has swept it yet', () async {
      await launch(const AutoCleanRule(enabled: true, minSubscribers: 1000));

      expect(windowed(), hasLength(1));
      expect(windowed().single.request.firstSeenAfter,
          DateTime.utc(2026, 3, 1, 9));
      expect(windowed().single.dryRun, isFalse);
    });

    test('then sweeps the whole roster, untouched channels only', () async {
      await launch(const AutoCleanRule(enabled: true, minSubscribers: 1000));

      // The catch-up reaches the last run's window; everything that arrived
      // outside any run on this machine — a teammate's finds, a run that was
      // restarted — is the standing sweep's, and it must not touch a channel
      // somebody has looked at.
      expect(standing(), hasLength(1));
      final call = standing().single;
      expect(call.request.untouchedOnly, isTrue);
      expect(call.request.maxSubscribers, 999);
      expect(call.dryRun, isFalse);
    });

    test('a standing sweep that tags nothing leaves the report alone',
        () async {
      final container = containerWith(
          const AutoCleanRule(enabled: true, minSubscribers: 1000));
      final runner = container.read(autoCleanRunnerProvider.notifier);
      await container.read(autoCleanRuleProvider.notifier).ready;
      for (var i = 0; i < 8; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      // The launch sweeps tagged something; that is what the panel shows.
      expect(container.read(autoCleanRunnerProvider)?.outcome?.tagged, 7);

      // A later standing sweep — after a pull, say — finds nothing to do.
      // That is the normal case, and it must not bury the sweep that did
      // something under a "0 matched" of its own.
      repo.tagged = 0;
      final report = await runner.sweepStanding();
      expect(report?.outcome?.tagged, 0);
      expect(container.read(autoCleanRunnerProvider)?.outcome?.tagged, 7);
    });

    test('does not sweep the same run twice across launches', () async {
      const rule = AutoCleanRule(enabled: true, minSubscribers: 1000);
      await launch(rule);
      expect(windowed(), hasLength(1));

      // A second launch, same last run on disk. An unattended destructive call
      // that repeats itself every time the app opens is not a catch-up.
      await launch(rule);
      expect(windowed(), hasLength(1));
    });

    test('sweeps again once a newer run has ended', () async {
      const rule = AutoCleanRule(enabled: true, minSubscribers: 1000);
      await launch(rule);

      searches.current = SearchRun(
        id: 'run_54',
        keywords: const [],
        startedBy: '',
        startedAt: DateTime.utc(2026, 3, 2, 9),
        status: SearchRunStatus.completed,
        channelsFound: 13,
      );
      await launch(rule);

      expect(windowed(), hasLength(2));
      expect(
          windowed().last.request.firstSeenAfter, DateTime.utc(2026, 3, 2, 9));
    });

    test('a rule that is off catches up on nothing', () async {
      await launch(const AutoCleanRule(maxSubscribers: 1000));
      expect(repo.calls, isEmpty);
    });

    test('a run still going is left to the live listener', () async {
      searches.current = SearchRun(
        id: 'run_55',
        keywords: const [],
        startedBy: '',
        startedAt: DateTime.utc(2026, 3, 3, 9),
        status: SearchRunStatus.running,
        channelsFound: 40,
      );

      await launch(const AutoCleanRule(enabled: true, minSubscribers: 1000));
      expect(windowed(), isEmpty);
      // The roster is a different question from the run, and is still asked.
      expect(standing(), hasLength(1));
    });

    test('no local run at all is not an error', () async {
      searches.current = null;
      await launch(const AutoCleanRule(enabled: true, minSubscribers: 1000));
      expect(windowed(), isEmpty);
      expect(standing(), hasLength(1));
    });

    test('the launch sweeps wait for the rule on disk, not the default',
        () async {
      // The built-in default is ON with a 50K floor. This machine's own file
      // says off. Nothing may act on the default in the gap before the file
      // is read — which is what `ready` is for.
      final store = _FakeAutoCleanRuleStore()
        ..local = const AutoCleanRule(maxSubscribers: 1000).toJson();
      final container = ProviderContainer(
        overrides: [
          archiveRepositoryProvider.overrideWithValue(repo),
          searchRepositoryProvider.overrideWithValue(searches),
          autoCleanRuleStoreProvider.overrideWithValue(store),
        ],
      );
      addTearDown(container.dispose);

      container.read(autoCleanRunnerProvider);
      await container.read(autoCleanRuleProvider.notifier).ready;
      for (var i = 0; i < 8; i++) {
        await Future<void>.delayed(Duration.zero);
      }

      expect(container.read(autoCleanRuleProvider).enabled, isFalse);
      expect(repo.calls, isEmpty);
    });
  });

  group('AutoCleanRuleNotifier persistence', () {
    late _FakeAutoCleanRuleStore store;
    late ProviderContainer container;

    setUp(() {
      store = _FakeAutoCleanRuleStore();
      container = ProviderContainer(
        overrides: [autoCleanRuleStoreProvider.overrideWithValue(store)],
      );
      addTearDown(container.dispose);
    });

    /// Reads the provider (starting `build()`'s background load) and lets it
    /// settle, the same two-tick pattern [launch] above uses.
    Future<AutoCleanRule> loaded() async {
      container.read(autoCleanRuleProvider);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      return container.read(autoCleanRuleProvider);
    }

    test('starts from the built-in default before the load settles', () {
      expect(container.read(autoCleanRuleProvider), defaultAutoCleanRule);
    });

    test('adopts the shared default when there is no local override', () async {
      store.shared =
          const AutoCleanRule(enabled: true, minSubscribers: 999).toJson();

      final rule = await loaded();

      expect(rule.minSubscribers, 999);
    });

    test('a local override wins over the shared default', () async {
      store.local =
          const AutoCleanRule(enabled: true, minSubscribers: 1).toJson();
      store.shared =
          const AutoCleanRule(enabled: true, minSubscribers: 999).toJson();

      final rule = await loaded();

      expect(rule.minSubscribers, 1);
    });

    test('neither file having an entry leaves the built-in default', () async {
      final rule = await loaded();
      expect(rule, defaultAutoCleanRule);
    });

    test('changing a field writes the whole rule to the local store', () async {
      await loaded();
      await container
          .read(autoCleanRuleProvider.notifier)
          .setMinSubscribers(12345);

      expect(store.local?['min_subscribers'], 12345);
      expect(store.writeCount, 1);
    });

    test('a rule already in SharedPreferences migrates onto the local store',
        () async {
      SharedPreferences.setMockInitialValues({
        'search.autoCleanRule': jsonEncode(
          const AutoCleanRule(enabled: true, minSubscribers: 42).toJson(),
        ),
      });

      final rule = await loaded();

      expect(rule.minSubscribers, 42);
      expect(store.local?['min_subscribers'], 42);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('search.autoCleanRule'), isNull);
    });

    test('migration never overwrites a local override that already exists',
        () async {
      SharedPreferences.setMockInitialValues({
        'search.autoCleanRule': jsonEncode(
          const AutoCleanRule(enabled: true, minSubscribers: 42).toJson(),
        ),
      });
      store.local =
          const AutoCleanRule(enabled: true, minSubscribers: 1).toJson();

      final rule = await loaded();

      expect(rule.minSubscribers, 1);
    });
  });
}

class _FakeAutoCleanRuleStore implements AutoCleanRuleStore {
  Map<String, Object?>? local;
  Map<String, Object?>? shared;
  int writeCount = 0;

  @override
  Future<Map<String, Object?>?> readLocal() async => local;

  @override
  Future<Map<String, Object?>?> readShared() async => shared;

  @override
  Future<void> writeLocal(Map<String, Object?> autoCleanJson) async {
    local = autoCleanJson;
    writeCount++;
  }
}

/// Stands in for the local `runs` table the launch catch-up reads.
class _StubSearchRepository implements SearchRepository {
  SearchRun? current;

  @override
  Future<SearchRun?> getCurrentRun() async => current;
}

class _Call {
  const _Call(this.request, this.dryRun);
  final BulkRejectionRequest request;
  final bool dryRun;
}

class _RecordingArchiveRepository implements ArchiveRepository {
  final List<_Call> calls = [];
  bool throws = false;

  /// What every call reports as tagged. 7 by default; a test that wants a
  /// sweep that found nothing sets 0.
  int tagged = 7;

  @override
  Future<BulkRejectionOutcome> bulkReject(
    BulkRejectionRequest request, {
    bool dryRun = true,
    void Function(int swept, int total)? onSweepProgress,
    bool Function()? shouldStop,
  }) async {
    calls.add(_Call(request, dryRun));
    if (throws) throw StateError('only full authority may bulk-reject');
    return BulkRejectionOutcome(
      matched: tagged,
      tagged: tagged,
      archived: 0,
      skippedAlreadyTagged: 1,
      skippedProtected: 0,
      skippedUnknownSize: 2,
    );
  }

  @override
  Future<int> count() async => 0;

  @override
  Future<Set<String>> archivedIdsAmong(List<String> channelIds) async =>
      const {};

  @override
  Future<List<ArchivedChannel>> getPage({
    required int offset,
    required int limit,
    ArchiveQuery query = const ArchiveQuery(),
  }) async =>
      const [];

  @override
  Future<List<ArchivedChannel>> getAll() async => const [];

  @override
  Future<List<KeywordViewSample>> keywordViewSamples() async => const [];

  @override
  Future<void> unarchive(String channelId) async {}

  @override
  Future<void> updateLabel(String channelId, ChannelTag label) async {}

  @override
  Future<BulkArchiveDueOutcome> bulkManageArchiveDue(
    BulkArchiveDueRequest request, {
    bool dryRun = true,
    void Function(int swept, int total)? onSweepProgress,
    bool Function()? shouldStop,
  }) async =>
      BulkArchiveDueOutcome.empty;
}
