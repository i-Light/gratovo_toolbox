import 'package:gratovo_toolbox/core/native/local_pipeline_db_types.dart';

export 'package:gratovo_toolbox/core/native/local_pipeline_db_types.dart';

/// The web build of [LocalPipelineDb] -- `package:sqlite3` is FFI-based and
/// doesn't exist on web at all. Returns null/empty rather than throwing
/// (unlike scraper_process_stub.dart's methods): reading local run
/// progress is something [LocalSearchRepository] calls unconditionally as
/// part of its normal, cross-platform `getCurrentRun()` flow (falling back to
/// nothing when there's no local DB to read), not something gated behind
/// `DesktopOnly` the way actually *launching* the pipeline is.
class LocalPipelineDb {
  const LocalPipelineDb._();

  static LocalRunProgress? readLatestSearchRun(String dbPath) => null;

  static List<String> readAllKeywords(String dbPath) => const [];
}
