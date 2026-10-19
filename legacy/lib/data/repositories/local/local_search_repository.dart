import 'package:gratovo_toolbox/core/native/local_pipeline_db.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/data/repositories/search_repository.dart';

/// The real [SearchRepository] -- replaces `MockSearchRepository` (Phase 6).
///
/// Deliberately reads a *different* source from every other repository in
/// this app -- not "the mock, or Supabase", but the local pipeline's own
/// SQLite file:
///
///  - [getCurrentRun] is *always* a local `gratovo.db` read -- store.py's
///    `runs` table is written by the scraper on whichever machine is running
///    it, and only that machine has the process' own progress. This only
///    ever reflects a run on *this* machine. `search_progress_panel.dart`'s live view of a run
///    *this session* just started goes through
///    `activeSearchRunControllerProvider` instead (fed directly from the
///    launched process' own stdout), not through this method at all --
///    this one is what still shows something after that live state is
///    gone (app restarted, or a teammate ran `python search.py` by hand on
///    this same machine).
class LocalSearchRepository implements SearchRepository {
  const LocalSearchRepository();

  @override
  Future<SearchRun?> getCurrentRun() async {
    final paths = ScraperProcess.resolvePaths();
    if (paths == null) return null;
    // Searches only — `runs` holds the unattended jobs too, and the newest row
    // is very often the background video catch-up rather than anything anybody
    // started. See [LocalPipelineDb.readLatestSearchRun], and
    // `VideoCatchUpPanel`, which is where that job now speaks for itself.
    final run = LocalPipelineDb.readLatestSearchRun(paths.dbPath);
    if (run == null) return null;
    return SearchRun(
      id: 'run_${run.runId}',
      // store.py's `runs` table doesn't record which keywords or which
      // team member -- only `keywords`/its own `search_settings` snapshot
      // does, per-keyword, not per-run. Left empty/generic here rather than
      // guessed; a run driven by *this session* has the real values via
      // activeSearchRunControllerProvider instead (see class doc comment).
      keywords: const [],
      startedBy: '',
      startedAt: DateTime.tryParse(run.startedAt) ?? DateTime.now(),
      finishedAt:
          run.finishedAt == null ? null : DateTime.tryParse(run.finishedAt!),
      status: _statusFrom(run.status),
      channelsFound: run.channelsUpserted,
      videosFound: run.videosUpserted,
      // The `runs` table counts keywords but does not name them, so this is
      // the count on its own -- see `SearchRun.keywordsDone`.
      keywordTotal: run.keywordsTotal,
      keywordsDone: run.keywordsDone,
      logLines: const [],
    );
  }

  SearchRunStatus _statusFrom(String status) {
    return switch (status) {
      'running' => SearchRunStatus.running,
      'done' => SearchRunStatus.completed,
      // store.py writes 'interrupted' when the run took a KeyboardInterrupt --
      // which is exactly what the Stop button sends. Not a failure: everything
      // committed before the interrupt is saved.
      'interrupted' => SearchRunStatus.stopped,
      _ => SearchRunStatus.idle,
    };
  }
}
