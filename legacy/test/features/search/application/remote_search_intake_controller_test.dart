import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/logging/activity_logger.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_activity_log_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_remote_search_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/archive/application/archive_controller.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/remote_search_intake_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_keywords_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Records what `startSearch` was asked to run instead of launching a
/// process, and reports whatever `isRunning` the test needs.
class _RecordingActiveSearchRun extends ActiveSearchRunNotifier {
  List<String>? startedWith;
  int calls = 0;
  bool fakeRunning = false;

  @override
  bool get isRunning => fakeRunning;

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
  }
}

ProviderContainer _container({
  required _RecordingActiveSearchRun activeRun,
  required MockRemoteSearchRepository repo,
  bool canRunSearch = true,
}) {
  final container = ProviderContainer(
    overrides: [
      activeSearchRunControllerProvider.overrideWith(() => activeRun),
      remoteSearchRepositoryProvider.overrideWithValue(repo),
      capabilitiesProvider.overrideWithValue(AppCapabilities(
        isDesktopDevice: true,
        isNative: true,
        canRunSearch: canRunSearch,
        canEditSearchInputs: true,
        canTuneScrapingSettings: true,
      )),
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

/// Lets the controller's internal polling loops (keyword load, the intake
/// check itself) settle.
Future<void> _settle() async {
  for (var i = 0; i < 10; i++) {
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
}

void main() {
  test('an idle device merges incoming keywords into an empty box and starts',
      () async {
    SharedPreferences.setMockInitialValues({});
    final activeRun = _RecordingActiveSearchRun();
    final repo = MockRemoteSearchRepository(myUserId: 'me');
    await repo.send(toUserId: 'me', keywords: 'budget travel\nai tools');
    final container = _container(activeRun: activeRun, repo: repo);
    await _awaitKeywordsLoaded(container);

    container.read(remoteSearchIntakeControllerProvider);
    await _settle();

    expect(
        container.read(searchKeywordsProvider).text, 'budget travel\nai tools');
    expect(activeRun.calls, 1);
    expect(activeRun.startedWith, ['budget travel', 'ai tools']);
    expect(await repo.incomingPending(), isEmpty);
  });

  test('merges without duplicating a keyword already in the box', () async {
    SharedPreferences.setMockInitialValues({
      'gratovo.search.keywordsText': 'budget travel',
    });
    final activeRun = _RecordingActiveSearchRun();
    final repo = MockRemoteSearchRepository(myUserId: 'me');
    await repo.send(toUserId: 'me', keywords: 'budget travel\nai tools');
    final container = _container(activeRun: activeRun, repo: repo);
    await _awaitKeywordsLoaded(container);

    container.read(remoteSearchIntakeControllerProvider);
    await _settle();

    expect(
        container.read(searchKeywordsProvider).text, 'budget travel\nai tools');
  });

  test('a run already going: merges the box but does not start a second run',
      () async {
    SharedPreferences.setMockInitialValues({
      'gratovo.search.keywordsText': 'budget travel',
    });
    final activeRun = _RecordingActiveSearchRun()..fakeRunning = true;
    final repo = MockRemoteSearchRepository(myUserId: 'me');
    await repo.send(toUserId: 'me', keywords: 'ai tools');
    final container = _container(activeRun: activeRun, repo: repo);
    await _awaitKeywordsLoaded(container);

    container.read(remoteSearchIntakeControllerProvider);
    await _settle();

    expect(
        container.read(searchKeywordsProvider).text, 'budget travel\nai tools');
    expect(activeRun.calls, 0);
    // Still marked applied -- the keywords are safely in the box, which is
    // the point of no return; the actual launch is left to
    // searchAutoChainControllerProvider once the in-flight run ends.
    expect(await repo.incomingPending(), isEmpty);
  });

  test('a device that cannot run search leaves the request untouched',
      () async {
    SharedPreferences.setMockInitialValues({});
    final activeRun = _RecordingActiveSearchRun();
    final repo = MockRemoteSearchRepository(myUserId: 'me');
    await repo.send(toUserId: 'me', keywords: 'budget travel');
    final container =
        _container(activeRun: activeRun, repo: repo, canRunSearch: false);
    await _awaitKeywordsLoaded(container);

    container.read(remoteSearchIntakeControllerProvider);
    await _settle();

    expect(container.read(searchKeywordsProvider).text, isEmpty);
    expect(activeRun.calls, 0);
    expect(await repo.incomingPending(), hasLength(1));
  });
}
