import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/channel_run.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/backfill_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/reenrich_run_controller.dart';
import 'package:gratovo_toolbox/features/shell/application/pipeline_badge_controller.dart';

/// The three run controllers with nothing behind them: the test moves their
/// `state` by hand to play out the transitions the badge listens for.
class _FakeSearch extends ActiveSearchRunNotifier {
  @override
  SearchRun? build() => null;
}

class _FakeBackfill extends BackfillRunNotifier {
  @override
  ChannelRun? build() => null;
}

class _FakeReenrich extends ReenrichRunNotifier {
  @override
  ChannelRun? build() => null;
}

SearchRun _search(SearchRunStatus status) => SearchRun(
      id: 's',
      keywords: const ['k'],
      startedBy: 'me',
      startedAt: DateTime(2026, 9, 18),
      status: status,
    );

ChannelRun _channel(ChannelRunKind kind, ChannelRunStatus status) => ChannelRun(
      id: 'c',
      kind: kind,
      handle: '@h',
      startedAt: DateTime(2026, 9, 18),
      status: status,
    );

class _Rig {
  _Rig() {
    container = ProviderContainer(overrides: [
      activeSearchRunControllerProvider.overrideWith(_FakeSearch.new),
      backfillRunControllerProvider.overrideWith(_FakeBackfill.new),
      reenrichRunControllerProvider.overrideWith(_FakeReenrich.new),
    ]);
    addTearDown(container.dispose);
    // Somebody has to be watching, as AppShell is in the app, or the
    // notifier — and its listeners — never come to life.
    container.listen(pipelineBadgeProvider, (_, __) {});
  }

  late final ProviderContainer container;

  PipelineBadgeStatus get badge => container.read(pipelineBadgeProvider);

  void search(SearchRunStatus? status) =>
      container.read(activeSearchRunControllerProvider.notifier).state =
          status == null ? null : _search(status);

  void backfill(ChannelRunStatus? status) =>
      container.read(backfillRunControllerProvider.notifier).state =
          status == null ? null : _channel(ChannelRunKind.backfill, status);

  void reenrich(ChannelRunStatus? status) =>
      container.read(reenrichRunControllerProvider.notifier).state =
          status == null ? null : _channel(ChannelRunKind.reenrich, status);

  void acknowledge() =>
      container.read(pipelineBadgeProvider.notifier).acknowledge();
}

void main() {
  test('starts with nothing to say', () {
    expect(_Rig().badge, PipelineBadgeStatus.none);
  });

  test('a search run: running, then success, until seen', () {
    final rig = _Rig();
    rig.search(SearchRunStatus.running);
    expect(rig.badge, PipelineBadgeStatus.running);
    rig.search(SearchRunStatus.completed);
    expect(rig.badge, PipelineBadgeStatus.success);
    rig.acknowledge();
    expect(rig.badge, PipelineBadgeStatus.none);
  });

  test('a failed search is an error; a stopped one is a success', () {
    final rig = _Rig();
    rig.search(SearchRunStatus.running);
    rig.search(SearchRunStatus.failed);
    expect(rig.badge, PipelineBadgeStatus.error);

    rig.acknowledge();
    rig.search(SearchRunStatus.running);
    rig.search(SearchRunStatus.stopped);
    // Pressing Stop is the normal way to end a run early, not a breakage.
    expect(rig.badge, PipelineBadgeStatus.success);
  });

  test('a backfill and a re-enrich report the same way', () {
    final rig = _Rig();
    rig.backfill(ChannelRunStatus.running);
    expect(rig.badge, PipelineBadgeStatus.running);
    rig.backfill(ChannelRunStatus.failed);
    expect(rig.badge, PipelineBadgeStatus.error);

    rig.acknowledge();
    rig.reenrich(ChannelRunStatus.running);
    expect(rig.badge, PipelineBadgeStatus.running);
    rig.reenrich(ChannelRunStatus.completed);
    expect(rig.badge, PipelineBadgeStatus.success);
  });

  test('acknowledging mid-run changes nothing', () {
    final rig = _Rig();
    rig.search(SearchRunStatus.running);
    rig.acknowledge();
    expect(rig.badge, PipelineBadgeStatus.running);
  });

  test('one job finishing while another is going keeps "running"', () {
    final rig = _Rig();
    rig.search(SearchRunStatus.running);
    rig.backfill(ChannelRunStatus.running);
    expect(rig.badge, PipelineBadgeStatus.running);

    // The backfill fails while the search is still going: the icon must not
    // read "error" — or "success" — until everything is done.
    rig.backfill(ChannelRunStatus.failed);
    expect(rig.badge, PipelineBadgeStatus.running);

    rig.search(SearchRunStatus.completed);
    // The last one to finish decides the outcome shown.
    expect(rig.badge, PipelineBadgeStatus.success);
  });

  test('a run first seen already finished is not an outcome', () {
    final rig = _Rig();
    // Restored from disk, say: it never went through "running" here.
    rig.search(SearchRunStatus.completed);
    expect(rig.badge, PipelineBadgeStatus.none);
  });

  test('a running job that disappears counts as ended cleanly', () {
    final rig = _Rig();
    rig.backfill(ChannelRunStatus.running);
    rig.backfill(null);
    // running -> not running is the edge the badge watches; with no failed
    // status to read, it is the good outcome.
    expect(rig.badge, PipelineBadgeStatus.success);
  });
}
