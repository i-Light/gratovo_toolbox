import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/scheduled_job.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_scheduled_job_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/job_scheduler/application/job_kind_registry.dart';
import 'package:gratovo_toolbox/features/job_scheduler/application/job_scheduler_controller.dart';

/// The engine's job: read what's due, run it by kind, and always reschedule —
/// whether the kind has a runner, whether that runner throws, or not.
/// `tick()` is called directly rather than through `start()`'s
/// `Timer.periodic`, the same way `OutreachInboxController`'s tests call
/// `sweep()` directly: what's under test is the tick logic, not the clock.
void main() {
  late MockScheduledJobRepository repo;
  late ProviderContainer container;

  ScheduledJob makeJob({
    required String kind,
    String cadence = 'daily',
    bool enabled = true,
    DateTime? nextRunAt,
  }) {
    final now = DateTime.now();
    return ScheduledJob(
      id: '',
      kind: kind,
      cadence: cadence,
      enabled: enabled,
      nextRunAt: nextRunAt ?? now.subtract(const Duration(minutes: 1)),
      createdAt: now,
      updatedAt: now,
    );
  }

  setUp(() async {
    repo = MockScheduledJobRepository();
    // The seeded auto_clean job in the mock is irrelevant to these tests and
    // has no runner registered, which would otherwise show up in every
    // report as an extra skippedNoRunner.
    for (final job in await repo.getAll()) {
      await repo.delete(job.id);
    }
    container = ProviderContainer(
      overrides: [
        supabaseBootProvider.overrideWithValue(
          const SupabaseBoot(
            config: SupabaseConfig(url: '', anonKey: ''),
            error: 'no server configured in this test',
          ),
        ),
        scheduledJobRepositoryProvider.overrideWithValue(repo),
      ],
    );
    addTearDown(container.dispose);
  });

  JobSchedulerController controller() =>
      container.read(jobSchedulerControllerProvider.notifier);

  group('tick', () {
    test(
        'runs a due job whose kind has a registered runner and reschedules '
        'it by cadence', () async {
      final ranWith = <ScheduledJob>[];
      container.read(jobKindRegistryProvider).register('widget', (job) async {
        ranWith.add(job);
      });
      final created = await repo.upsert(makeJob(kind: 'widget'));

      final report = await controller().tick();

      expect(report.executed, 1);
      expect(report.skippedNoRunner, 0);
      expect(report.failed, 0);
      expect(ranWith, hasLength(1));
      expect(ranWith.single.id, created.id);

      final after = await repo.getById(created.id);
      expect(after!.lastRunAt, isNotNull);
      expect(after.nextRunAt!.isAfter(DateTime.now()), isTrue,
          reason: 'daily cadence should push the next run about a day out');
    });

    test(
        'skips and reschedules a job whose kind has no runner registered, '
        'without throwing', () async {
      final created = await repo.upsert(makeJob(kind: 'nobody_home'));

      final report = await controller().tick();

      expect(report.executed, 0);
      expect(report.skippedNoRunner, 1);
      final after = await repo.getById(created.id);
      expect(after!.nextRunAt!.isAfter(DateTime.now()), isTrue,
          reason: 'an unrecognised kind must not stay due on every tick');
    });

    test('records the run and reschedules even when the runner throws',
        () async {
      container
          .read(jobKindRegistryProvider)
          .register('flaky', (job) async => throw StateError('boom'));
      final created = await repo.upsert(makeJob(kind: 'flaky'));

      final report = await controller().tick();

      expect(report.failed, 1);
      expect(report.executed, 0);
      final after = await repo.getById(created.id);
      expect(after!.lastRunAt, isNotNull,
          reason:
              'a failure must reschedule, or it retries every tick forever');
    });

    test('leaves a not-yet-due job alone', () async {
      container.read(jobKindRegistryProvider).register('widget', (job) async {
        fail('should not run a job that is not due yet');
      });
      final created = await repo.upsert(makeJob(
        kind: 'widget',
        nextRunAt: DateTime.now().add(const Duration(days: 1)),
      ));

      final report = await controller().tick();

      expect(report.total, 0);
      final after = await repo.getById(created.id);
      expect(after!.lastRunAt, isNull);
    });

    test('leaves a disabled job alone even if its next run is in the past',
        () async {
      container.read(jobKindRegistryProvider).register('widget', (job) async {
        fail('should not run a disabled job');
      });
      await repo.upsert(makeJob(kind: 'widget', enabled: false));

      final report = await controller().tick();

      expect(report.total, 0);
    });

    test('runs several due jobs in one tick', () async {
      var runs = 0;
      container
          .read(jobKindRegistryProvider)
          .register('widget', (job) async => runs++);
      await repo.upsert(makeJob(kind: 'widget'));
      await repo.upsert(makeJob(kind: 'widget'));

      final report = await controller().tick();

      expect(report.executed, 2);
      expect(runs, 2);
    });
  });
}
