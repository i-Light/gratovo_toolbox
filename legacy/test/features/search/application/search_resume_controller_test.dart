import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/logging/activity_logger.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_activity_log_repository.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_keywords_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_resume_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Records what `startSearch` was asked to run instead of launching a process.
class _RecordingActiveSearchRun extends ActiveSearchRunNotifier {
  List<String>? startedWith;
  int? keywordTotal;
  List<String>? alreadyCompleted;
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
    this.keywordTotal = keywordTotal;
    this.alreadyCompleted = alreadyCompleted;
    state = SearchRun(
      id: 'fake',
      keywords: keywords,
      startedBy: startedByLabel,
      startedAt: DateTime.now(),
      status: SearchRunStatus.running,
    );
  }
}

AppCapabilities _caps({required bool canRunSearch}) => AppCapabilities(
      isDesktopDevice: true,
      isNative: canRunSearch,
      canRunSearch: canRunSearch,
      canEditSearchInputs: true,
      canTuneScrapingSettings: canRunSearch,
    );

ProviderContainer _container({
  required bool canRunSearch,
  required _RecordingActiveSearchRun activeRun,
}) {
  final container = ProviderContainer(
    overrides: [
      capabilitiesProvider.overrideWithValue(_caps(canRunSearch: canRunSearch)),
      activeSearchRunControllerProvider.overrideWith(() => activeRun),
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

/// Waits for [searchKeywordsProvider]'s one-time async load off
/// `SharedPreferences` to land.
Future<void> _awaitKeywordsLoaded(ProviderContainer container) async {
  for (var i = 0; i < 50; i++) {
    if (container.read(searchKeywordsProvider).loaded) return;
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
  fail('searchKeywordsProvider never loaded');
}

void main() {
  test('resumes the pending keywords when the last run was interrupted',
      () async {
    SharedPreferences.setMockInitialValues({
      'gratovo.search.keywordsText': 'a\nb\nc\nd',
      'gratovo.search.completedKeywords': ['a', 'b'],
      'gratovo.search.runInFlight': true,
    });
    final activeRun = _RecordingActiveSearchRun();
    final container = _container(canRunSearch: true, activeRun: activeRun);
    await _awaitKeywordsLoaded(container);

    await container
        .read(searchResumeControllerProvider.notifier)
        .resumeIfInterrupted(startedByLabel: 'This device');

    expect(container.read(searchResumeControllerProvider),
        SearchResumeStatus.resumed);
    expect(activeRun.startedWith, ['c', 'd']);
    // Counts towards the whole list, picking up from what was done.
    expect(activeRun.keywordTotal, 4);
    expect(activeRun.alreadyCompleted, ['a', 'b']);
  });

  test('does nothing when the marker is not set', () async {
    SharedPreferences.setMockInitialValues({
      'gratovo.search.keywordsText': 'a\nb\nc',
      'gratovo.search.completedKeywords': ['a'],
      // no runInFlight key -> the last run ended cleanly
    });
    final activeRun = _RecordingActiveSearchRun();
    final container = _container(canRunSearch: true, activeRun: activeRun);
    await _awaitKeywordsLoaded(container);

    await container
        .read(searchResumeControllerProvider.notifier)
        .resumeIfInterrupted(startedByLabel: 'This device');

    expect(activeRun.calls, 0);
    expect(container.read(searchResumeControllerProvider),
        SearchResumeStatus.idle);
  });

  test('does nothing on a build that cannot launch the search', () async {
    SharedPreferences.setMockInitialValues({
      'gratovo.search.keywordsText': 'a\nb\nc',
      'gratovo.search.completedKeywords': ['a'],
      'gratovo.search.runInFlight': true,
    });
    final activeRun = _RecordingActiveSearchRun();
    final container = _container(canRunSearch: false, activeRun: activeRun);
    await _awaitKeywordsLoaded(container);

    await container
        .read(searchResumeControllerProvider.notifier)
        .resumeIfInterrupted(startedByLabel: 'This device');

    expect(activeRun.calls, 0);
  });

  test('clears the marker without resuming when every keyword is already done',
      () async {
    SharedPreferences.setMockInitialValues({
      'gratovo.search.keywordsText': 'a\nb',
      'gratovo.search.completedKeywords': ['a', 'b'],
      'gratovo.search.runInFlight': true,
    });
    final activeRun = _RecordingActiveSearchRun();
    final container = _container(canRunSearch: true, activeRun: activeRun);
    await _awaitKeywordsLoaded(container);

    await container
        .read(searchResumeControllerProvider.notifier)
        .resumeIfInterrupted(startedByLabel: 'This device');

    expect(activeRun.calls, 0);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool('gratovo.search.runInFlight'), isFalse);
  });

  test('acts at most once per launch', () async {
    SharedPreferences.setMockInitialValues({
      'gratovo.search.keywordsText': 'a\nb\nc',
      'gratovo.search.completedKeywords': ['a'],
      'gratovo.search.runInFlight': true,
    });
    final activeRun = _RecordingActiveSearchRun();
    final container = _container(canRunSearch: true, activeRun: activeRun);
    await _awaitKeywordsLoaded(container);

    final notifier = container.read(searchResumeControllerProvider.notifier);
    await notifier.resumeIfInterrupted(startedByLabel: 'This device');
    await notifier.resumeIfInterrupted(startedByLabel: 'This device');

    expect(activeRun.calls, 1);
  });
}
