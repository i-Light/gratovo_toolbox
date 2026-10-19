import 'package:gratovo_toolbox/data/models/scheduled_job.dart';
import 'package:gratovo_toolbox/data/repositories/scheduled_job_repository.dart';

/// In-memory [ScheduledJobRepository], seeded with the standing auto-clean
/// sweep (see `CHANGELOG.md`'s "standing auto-clean keeps running between
/// launches").
class MockScheduledJobRepository implements ScheduledJobRepository {
  final List<ScheduledJob> _jobs = [
    ScheduledJob(
      id: 'job_001',
      kind: 'auto_clean',
      cadence: 'daily',
      lastRunAt: DateTime.now().subtract(const Duration(days: 1)),
      nextRunAt: DateTime.now().add(const Duration(hours: 6)),
      createdAt: DateTime.now().subtract(const Duration(days: 60)),
      updatedAt: DateTime.now().subtract(const Duration(days: 1)),
    ),
  ];

  @override
  Future<List<ScheduledJob>> getAll() async => List.unmodifiable(_jobs);

  @override
  Future<ScheduledJob?> getById(String id) async {
    for (final job in _jobs) {
      if (job.id == id) return job;
    }
    return null;
  }

  @override
  Future<List<ScheduledJob>> getDue() async =>
      _jobs.where((j) => j.isDue).toList();

  @override
  Future<ScheduledJob> upsert(ScheduledJob job) async {
    final withId = job.id.isEmpty
        ? ScheduledJob(
            id: 'job_${_jobs.length + 1}',
            kind: job.kind,
            cadence: job.cadence,
            lastRunAt: job.lastRunAt,
            nextRunAt: job.nextRunAt,
            enabled: job.enabled,
            config: job.config,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
          )
        : job;
    final index = _jobs.indexWhere((j) => j.id == withId.id);
    if (index == -1) {
      _jobs.add(withId);
    } else {
      _jobs[index] = withId;
    }
    return withId;
  }

  @override
  Future<void> delete(String id) async {
    _jobs.removeWhere((j) => j.id == id);
  }

  @override
  Future<void> recordRun(
    String id, {
    required DateTime ranAt,
    DateTime? nextRunAt,
  }) async {
    final index = _jobs.indexWhere((j) => j.id == id);
    if (index == -1) return;
    final job = _jobs[index];
    // Built directly rather than through copyWith, whose `??` fallback
    // cannot clear nextRunAt to null for a job with no further run.
    _jobs[index] = ScheduledJob(
      id: job.id,
      kind: job.kind,
      cadence: job.cadence,
      lastRunAt: ranAt,
      nextRunAt: nextRunAt,
      enabled: job.enabled,
      config: job.config,
      createdAt: job.createdAt,
      updatedAt: DateTime.now(),
    );
  }
}
