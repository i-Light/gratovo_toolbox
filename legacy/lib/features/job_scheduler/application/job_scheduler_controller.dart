import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/sync/operation_log.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine_types.dart';
import 'package:gratovo_toolbox/data/models/scheduled_job.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/data/repositories/scheduled_job_repository.dart';
import 'package:gratovo_toolbox/features/job_scheduler/application/job_cadence.dart';
import 'package:gratovo_toolbox/features/job_scheduler/application/job_kind_registry.dart';

/// How often the app checks the `scheduled_jobs` table for due work.
///
/// The same tradeoff `OutreachInboxController._sweepInterval` makes: short
/// enough that an hourly job actually runs within a few minutes of its due
/// time, long enough that idling on this table costs nothing worth noticing.
/// A minute is well under the shortest supported cadence (`hourly`), so no
/// job ever waits close to a full extra cadence for the engine to notice it.
const _tickInterval = Duration(minutes: 1);

/// How long after launch the first tick runs. Not zero, for the same reason
/// `OutreachInboxController._firstSweepDelay` isn't: the first seconds after
/// launch are spent signing in and restoring the shell, and a job that has
/// been waiting all night can wait another few seconds for that to settle.
const _firstTickDelay = Duration(seconds: 15);

/// What one tick did, for the status card and the log line.
class JobTickReport {
  const JobTickReport({
    this.executed = 0,
    this.skippedNoRunner = 0,
    this.failed = 0,
  });

  /// Jobs whose kind had a registered runner that ran without throwing.
  final int executed;

  /// Jobs that were due but whose kind has no runner registered on this
  /// build — see [JobSchedulerController.tick] for what happens to them.
  final int skippedNoRunner;

  /// Jobs whose runner threw.
  final int failed;

  int get total => executed + skippedNoRunner + failed;

  JobTickReport operator +(JobTickReport other) => JobTickReport(
        executed: executed + other.executed,
        skippedNoRunner: skippedNoRunner + other.skippedNoRunner,
        failed: failed + other.failed,
      );
}

/// The scheduler loop's visible state, for the Settings status card.
class JobSchedulerState {
  const JobSchedulerState({
    this.isTicking = false,
    this.lastTickAt,
    this.lastReport,
    this.error,
  });

  final bool isTicking;
  final DateTime? lastTickAt;
  final JobTickReport? lastReport;

  /// Set only when a tick failed outright — reading the table itself threw.
  /// A single job's runner throwing does not set this; that is counted in
  /// [JobTickReport.failed] instead and the tick still completes.
  final Object? error;

  JobSchedulerState copyWith({
    bool? isTicking,
    DateTime? lastTickAt,
    JobTickReport? lastReport,
    Object? error = _unset,
  }) {
    return JobSchedulerState(
      isTicking: isTicking ?? this.isTicking,
      lastTickAt: lastTickAt ?? this.lastTickAt,
      lastReport: lastReport ?? this.lastReport,
      error: error == _unset ? this.error : error,
    );
  }
}

const _unset = Object();

/// The generic job scheduler's execution engine.
///
/// Mirrors `OutreachInboxController`'s shape on purpose — a `Notifier` with
/// an idempotent [start], a `Timer.periodic` cancelled in `build`'s
/// `ref.onDispose`, and a manual [tick] that does the real work so a test or
/// a "run now" action can call it directly without waiting on the clock.
///
/// **What a tick does.** Reads every due job
/// ([ScheduledJobRepository.getDue]), and for each one looks its `kind` up in
/// [jobKindRegistryProvider]:
///
///   * a registered runner runs, and [recordRun] always follows — on success
///     *or* on a thrown error. Recorded either way for the same reason
///     `AutoCleanRunner.runFor` does: a failure that is retried every tick
///     forever is a busy loop pretending to be resilience, not a retry
///     policy. The failure is logged and counted in the report; a person
///     reads it from the status card, same as an auto-clean failure.
///   * no runner at all — a job scheduled for a feature this build does not
///     have, or one whose feature has not registered yet — also gets
///     [recordRun], so a permanently-unrecognised kind advances quietly on
///     its own cadence instead of coming back due on every single tick. It is
///     counted separately ([JobTickReport.skippedNoRunner]) so that case
///     reads differently from an actual failure.
///
/// Jobs run one after another, not concurrently — this table holds a handful
/// of per-machine background chores, not a work queue with throughput to
/// protect, and running them one at a time is what keeps two jobs from racing
/// over whatever local resource they happen to share.
class JobSchedulerController extends Notifier<JobSchedulerState> {
  Timer? _timer;

  /// Guards against overlapping ticks the same way
  /// `OutreachInboxController._inFlight` does: the periodic timer and a
  /// manual "run now" can land at once, and a job that is slow enough to
  /// still be running at the next minute's tick must not be started twice.
  bool _inFlight = false;

  @override
  JobSchedulerState build() {
    // No timer under test unless something calls start() — see
    // OutreachInboxController.build for why this matters for test hygiene.
    ref.onDispose(() => _timer?.cancel());
    return const JobSchedulerState();
  }

  /// Starts the background loop. Idempotent, so the app shell can call this
  /// on every build and only the first call arms anything.
  void start() {
    if (_timer != null) return;
    _timer = Timer.periodic(_tickInterval, (_) => unawaited(tick()));
    Timer(_firstTickDelay, () => unawaited(tick()));
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  /// One pass over the due jobs. Safe to call directly — from a test, or a
  /// future "run now" action — without waiting on [start]'s clock.
  Future<JobTickReport> tick() async {
    if (_inFlight) return const JobTickReport();
    _inFlight = true;
    state = state.copyWith(isTicking: true);
    try {
      final repo = ref.read(scheduledJobRepositoryProvider);
      final registry = ref.read(jobKindRegistryProvider);

      final List<ScheduledJob> due;
      try {
        due = await repo.getDue();
      } catch (error, stackTrace) {
        ref.logOperation(
          'jobScheduler.tick.failed',
          'Could not read the scheduled jobs table.',
          level: SyncLogLevel.error,
          error: error,
          stackTrace: stackTrace,
        );
        state = state.copyWith(isTicking: false, error: error);
        return const JobTickReport();
      }

      var report = const JobTickReport();
      for (final job in due) {
        report = report + await _run(job, repo: repo, registry: registry);
      }

      state = state.copyWith(
        isTicking: false,
        lastTickAt: DateTime.now(),
        lastReport: report,
        error: null,
      );
      return report;
    } finally {
      _inFlight = false;
    }
  }

  Future<JobTickReport> _run(
    ScheduledJob job, {
    required ScheduledJobRepository repo,
    required JobKindRegistry registry,
  }) async {
    final runner = registry.runnerFor(job.kind);
    final ranAt = DateTime.now();
    final next = nextRunAfter(ranAt, job.cadence);

    if (runner == null) {
      developer.log(
        'No runner registered for scheduled job kind "${job.kind}" '
        '(job ${job.id}); rescheduling without running it.',
        name: 'gratovo.jobScheduler',
        level: 900,
      );
      await repo.recordRun(job.id, ranAt: ranAt, nextRunAt: next);
      return const JobTickReport(skippedNoRunner: 1);
    }

    ref.logOperation(
      'jobScheduler.run',
      'Running scheduled job "${job.kind}".',
      fields: {'jobId': job.id, 'kind': job.kind, 'cadence': job.cadence},
    );
    JobTickReport result;
    try {
      await runner(job);
      ref.logOperation(
        'jobScheduler.run.done',
        'Scheduled job "${job.kind}" finished.',
        fields: {'jobId': job.id},
      );
      result = const JobTickReport(executed: 1);
    } catch (error, stackTrace) {
      // Never rethrown — see the class doc comment. One job's failure must
      // not stop the rest of this tick's due jobs from running, and must not
      // leave the job stuck retrying every minute forever.
      ref.logOperation(
        'jobScheduler.run.failed',
        'Scheduled job "${job.kind}" failed.',
        level: SyncLogLevel.error,
        fields: {'jobId': job.id},
        error: error,
        stackTrace: stackTrace,
      );
      result = const JobTickReport(failed: 1);
    }
    // Recorded whether it succeeded or not — see the class doc comment.
    await repo.recordRun(job.id, ranAt: ranAt, nextRunAt: next);
    return result;
  }
}

final jobSchedulerControllerProvider =
    NotifierProvider<JobSchedulerController, JobSchedulerState>(
  JobSchedulerController.new,
);
