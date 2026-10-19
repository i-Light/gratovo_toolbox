/// Pure, platform-independent pieces of the local `gratovo.db` reader (see
/// local_pipeline_db.dart) -- no native dependency in this file, so it
/// compiles everywhere including web, unlike the actual SQLite-reading code
/// it supports.
library;

/// One row from store.py's `runs` table -- the *local* run-progress record
/// that (unlike `keywords`/`channels`/`channel_keywords`/`videos`) never
/// reaches the shared database at all (see sync.py -- there's no `_push_runs`
/// step), so this is the only way any process other than search.py itself
/// can see it, and only on the same machine search.py is running on.
class LocalRunProgress {
  const LocalRunProgress({
    required this.runId,
    required this.startedAt,
    this.finishedAt,
    required this.status,
    required this.keywordsTotal,
    required this.keywordsDone,
    required this.channelsUpserted,
    required this.videosUpserted,
    this.kind = 'search',
  });

  final int runId;
  final String startedAt;
  final String? finishedAt;

  /// running | done | interrupted -- see store.py's `runs.status`.
  final String status;
  final int keywordsTotal;
  final int keywordsDone;
  final int channelsUpserted;
  final int videosUpserted;

  /// Which job wrote this row -- `search`, `catch-up` or `re-enrich`; see
  /// store.py's `runs.kind`.
  ///
  /// Defaults to `search` for a database written before that column existed,
  /// which is the safe way round: an old file only ever held real search runs
  /// anyway, because the jobs that need naming are the ones added since.
  final String kind;

  /// Whether this row is a keyword search — the only kind the Search page's
  /// progress panel should present as one. A background catch-up sweep is a
  /// run in `store.py`'s sense and emphatically not one in the app's.
  bool get isSearch => kind == 'search';
}
