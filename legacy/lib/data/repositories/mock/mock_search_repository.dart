import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/data/repositories/search_repository.dart';

/// In-memory [SearchRepository]. Seeded with one *completed* run, so the
/// Search page's progress panel isn't empty on first load — nothing here is
/// ever actually "running"; a real run goes through
/// `ActiveSearchRunNotifier` instead.
class MockSearchRepository implements SearchRepository {
  final SearchRun _lastRun = SearchRun(
    id: 'run_001',
    keywords: const ['tech review', 'budget travel'],
    startedBy: 'Mostafa',
    startedAt: DateTime.now().subtract(const Duration(days: 1, minutes: 22)),
    finishedAt: DateTime.now().subtract(const Duration(days: 1)),
    status: SearchRunStatus.completed,
    channelsFound: 14,
    keywordTotal: 2,
    completedKeywords: const ['tech review', 'budget travel'],
    logLines: const [
      'Starting search for 2 keywords...',
      '[tech review] found 9 channels, filtering by subscriber threshold',
      '[budget travel] found 7 channels, filtering by subscriber threshold',
      'Deduped against existing database: 14 new channels',
      'Search run finished in 21m 40s',
    ],
  );

  @override
  Future<SearchRun?> getCurrentRun() async => _lastRun;
}
