import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/logging/activity_logger.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_activity_log_repository.dart';
import 'package:gratovo_toolbox/features/archive/application/archive_controller.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_autochain_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_keywords_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Records what `startSearch` was asked to run instead of launching a
/// process, and lets the test drive the run through a running -> completed
/// transition directly via `state =` (public on a Riverpod `Notifier`).
class _RecordingActiveSearchRun extends ActiveSearchRunNotifier {
  List<String>? startedWith;
  int calls = 0;

  @override
  Future<void> startSearch({
    required List<String> keywords,
    required Map<String, Object?> runConfigJson,
    required String startedByLabel,
    int? keywordTotal,
    List<String> alreadyCompleted = const [],
  }) async {
    calls++;
    startedWith = keywords;
    state = SearchRun(
      id: 'fake-$calls',
      keywords: keywords,
      startedBy: startedByLabel,
      startedAt: DateTime.now(),
      status: SearchRunStatus.running,
    );
  }
}

SearchRun _run(String id, SearchRunStatus status) => SearchRun(
      id: id,
      keywords: const ['a', 'b'],
      startedBy: 'This device',
      startedAt: DateTime.now(),
      status: status,
    );

ProviderContainer _container({
  required _RecordingActiveSearchRun activeRun,
  bool canEditSearchInputs = true,
}) {
  final container = ProviderContainer(
    overrides: [
      activeSearchRunControllerProvider.overrideWith(() => activeRun),
      capabilitiesProvider.overrideWithValue(AppCapabilities(
        isDesktopDevice: true,
        isNative: true,
        canRunSearch: true,
        canEditSearchInputs: canEditSearchInputs,
        canTuneScrapingSettings: true,
      )),
      // Sidesteps the Supabase-backed access-level chain `launchPendingSearch`
      // touches via `canBulkCleanProvider` -- irrelevant to what this
      // controller is responsible for.
      canBulkCleanProvider.overrideWithValue(false),
      activityLoggerProvider.overrideWithValue(
        ActivityLogger(
          repository: MockActivityLogRepository(),
          actorId: null,
          actorName: 'test',
          actorRole: AccessLevel.unauthorized,
        ),
      ),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

Future<void> _awaitKeywordsLoaded(ProviderContainer container) async {
  for (var i = 0; i < 50; i++) {
    if (container.read(searchKeywordsProvider).loaded) return;
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
  fail('searchKeywordsProvider never loaded');
}

void main() {
  test('chains the next run when keywords are still pending', () async {
    SharedPreferences.setMockInitialValues({
      'gratovo.search.keywordsText': 'a\nb\nc',
      'gratovo.search.completedKeywords': ['a', 'b'],
    });
    final activeRun = _RecordingActiveSearchRun();
    final container = _container(activeRun: activeRun);
    await _awaitKeywordsLoaded(container);

    // Starts listening.
    container.read(searchAutoChainControllerProvider);

    activeRun.state = _run('r1', SearchRunStatus.running);
    activeRun.state = _run('r1', SearchRunStatus.completed);
    await Future<void>.delayed(Duration.zero);

    expect(activeRun.calls, 1);
    expect(activeRun.startedWith, ['c']);
  });

  test('clears progress instead of chaining when nothing is pending', () async {
    SharedPreferences.setMockInitialValues({
      'gratovo.search.keywordsText': 'a\nb',
      'gratovo.search.completedKeywords': ['a', 'b'],
    });
    final activeRun = _RecordingActiveSearchRun();
    final container = _container(activeRun: activeRun);
    await _awaitKeywordsLoaded(container);

    container.read(searchAutoChainControllerProvider);

    activeRun.state = _run('r1', SearchRunStatus.running);
    activeRun.state = _run('r1', SearchRunStatus.completed);
    await Future<void>.delayed(Duration.zero);

    expect(activeRun.calls, 0);
    expect(container.read(searchKeywordsProvider).completed, isEmpty);
  });

  test('does not chain on a device that cannot edit search inputs', () async {
    SharedPreferences.setMockInitialValues({
      'gratovo.search.keywordsText': 'a\nb\nc',
      'gratovo.search.completedKeywords': ['a', 'b'],
    });
    final activeRun = _RecordingActiveSearchRun();
    final container =
        _container(activeRun: activeRun, canEditSearchInputs: false);
    await _awaitKeywordsLoaded(container);

    container.read(searchAutoChainControllerProvider);

    activeRun.state = _run('r1', SearchRunStatus.running);
    activeRun.state = _run('r1', SearchRunStatus.completed);
    await Future<void>.delayed(Duration.zero);

    expect(activeRun.calls, 0);
  });

  test('a stop is not a completion and does not chain', () async {
    SharedPreferences.setMockInitialValues({
      'gratovo.search.keywordsText': 'a\nb\nc',
      'gratovo.search.completedKeywords': ['a'],
    });
    final activeRun = _RecordingActiveSearchRun();
    final container = _container(activeRun: activeRun);
    await _awaitKeywordsLoaded(container);

    container.read(searchAutoChainControllerProvider);

    activeRun.state = _run('r1', SearchRunStatus.running);
    activeRun.state = _run('r1', SearchRunStatus.stopped);
    await Future<void>.delayed(Duration.zero);

    expect(activeRun.calls, 0);
  });
}
