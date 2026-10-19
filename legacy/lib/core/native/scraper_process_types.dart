/// Pure, platform-independent pieces of [ScraperProcess] (see
/// scraper_process.dart) -- no `dart:io` in this file, so it compiles (and
/// is unit-testable) on every platform including web, unlike the actual
/// process-launching code it supports.
library;

/// Where the Python pipeline and its data files live, resolved once by
/// whichever caller needs to launch it.
class ScraperProcessPaths {
  const ScraperProcessPaths({
    required this.pipelineDir,
    required this.dataDir,
  });

  /// `pipeline/` -- where `search.py` and the `gratovo/` package live.
  final String pipelineDir;

  /// `data/` -- where `.env`, `settings.json`, `keywords.json` and
  /// `run_config.json` live. The databases are one level in, in [databaseDir].
  final String dataDir;

  /// `data/database/` -- every SQLite file this machine keeps.
  ///
  /// A folder of its own because these three files have nothing in common with
  /// the rest of `data/` except a parent. `settings.json`, `keywords.json` and
  /// `.env` are small, human-edited and committed; `gratovo.db`,
  /// `mailbox.db` and `email_library.db` are large, machine-written and now
  /// gitignored as a folder. Mixed together, the one gitignore rule that gets
  /// the second group right cannot help matching parts of the first -- which
  /// is how a 100 MB database ended up in the history of a repository whose
  /// source is a few megabytes.
  ///
  /// `config.py` resolves the same folder from `GRATOVO_DATA_DIR`, so both
  /// sides agree on where the databases are without either one being told.
  String get databaseDir => '$dataDir/database';

  /// Plain string concatenation, not a platform-aware join -- deliberately,
  /// so this getter (used by the always-cross-platform-safe
  /// `LocalSearchRepository`, not just the desktop-only `ScraperProcess`
  /// launch methods) never needs `dart:io`'s `Platform.pathSeparator`.
  /// Windows' own file APIs accept a forward slash interchangeably with a
  /// backslash, so a `dataDir` built with `Platform.pathSeparator` (see
  /// scraper_process_io.dart) plus a forward-slash-joined suffix here still
  /// resolves correctly.
  String get dbPath => '$databaseDir/gratovo.db';
}

/// A launched, still-running pipeline invocation -- `search.py` or
/// `tools/enrich.py`. [stdoutLines] is stdout+stderr merged in arrival order,
/// line by line -- both scripts' own `print()` calls are the only progress
/// protocol they have (reading that, rather than inventing a structured
/// one, keeps the pipeline runnable by hand), so this is genuinely the whole of
/// what's knowable about a run while it's in flight, short of polling
/// `gratovo.db` separately (which `local_pipeline_db.dart` does, for the
/// *keyword-claim* state that search.py itself never prints). Defined here
/// (not in scraper_process_io/_stub.dart) since both the real and stub
/// implementations of `ScraperProcess.startSearch`/`backfillChannelVideos`
/// need the exact same return type.
class PipelineLaunchResult {
  const PipelineLaunchResult({
    required this.stdoutLines,
    required this.exitCode,
    required this.stop,
  });

  final Stream<String> stdoutLines;
  final Future<int> exitCode;

  /// Asks the run to stop. Returns false if the process had already exited.
  ///
  /// Exists because a discovery run is long and the only previous ways out of
  /// one were to let it finish or to kill the whole app -- and the second one
  /// loses the app's own record of how far the run got, which is exactly what
  /// the resume behaviour now depends on. Stopping is not a failure: whatever
  /// the run had already committed is already in the database (search.py
  /// pushes after every keyword), so a stopped run resumes from the keyword it
  /// was on.
  final Future<bool> Function() stop;
}

/// A completed `--refetch` run (or any other short-lived invocation) --
/// unlike [SearchLaunchResult], this one already finished by the time the
/// caller sees it.
class ProcessResultLite {
  const ProcessResultLite({required this.exitCode, required this.output});

  final int exitCode;

  /// Combined stdout+stderr.
  final String output;

  bool get succeeded => exitCode == 0;
}

/// The keyword list exactly as a run should work it: trimmed, blanks
/// dropped, duplicates removed keeping the first occurrence, order otherwise
/// preserved.
///
/// This replaced `mergeKeywords`, which unioned the newly typed keywords into
/// whatever `data/keywords.json` already held. That made the file an
/// ever-growing pile nobody ever emptied, and -- since `search.py` then ran
/// every keyword still pending in the database rather than the list it was
/// handed -- typing three keywords could start a run of two hundred, with no
/// honest progress count possible for it. The file is now the manifest for one
/// run, rewritten on every Start; the database still remembers every keyword
/// ever queued, which is where that history belongs.
///
/// A pure function on purpose: the only part of writing `keywords.json` worth
/// unit testing without touching a real file.
List<String> normalizeKeywords(List<String> keywords) {
  final seen = <String>{};
  final normalized = <String>[];
  for (final raw in keywords) {
    final trimmed = raw.trim();
    if (trimmed.isEmpty) continue;
    if (seen.add(trimmed)) normalized.add(trimmed);
  }
  return normalized;
}
