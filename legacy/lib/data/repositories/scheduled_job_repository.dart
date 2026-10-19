import 'package:gratovo_toolbox/data/models/scheduled_job.dart';

/// How the generic job scheduler reads and edits its jobs. See
/// `influencer_repository.dart`'s doc comment for the mock/Supabase swap
/// pattern every other repository in this folder follows — this one is the
/// exception: `scheduled_jobs` is per-machine state (see `ScheduledJob`'s
/// doc comment), so the mirror implementation writes straight to the local
/// table with no outbox entry at all.
abstract class ScheduledJobRepository {
  Future<List<ScheduledJob>> getAll();

  Future<ScheduledJob?> getById(String id);

  /// Every enabled job whose [ScheduledJob.nextRunAt] is due.
  Future<List<ScheduledJob>> getDue();

  /// Creates or updates a job and returns the stored record with its id.
  /// The repository owns id generation; pass [ScheduledJob.id] as `''` to
  /// create.
  Future<ScheduledJob> upsert(ScheduledJob job);

  Future<void> delete(String id);

  /// Stamps a run: [ranAt] becomes [ScheduledJob.lastRunAt] and [nextRunAt]
  /// (computed by the caller from [ScheduledJob.cadence]) becomes the new
  /// [ScheduledJob.nextRunAt].
  Future<void> recordRun(String id,
      {required DateTime ranAt, DateTime? nextRunAt});
}
