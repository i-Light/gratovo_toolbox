import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/scheduled_job.dart';

/// What runs when [JobSchedulerController] finds a due job of this kind.
///
/// Takes the whole [ScheduledJob], not just its `config`, because a runner
/// often wants more than its own parameters — [ScheduledJob.lastRunAt] to
/// scope an incremental sweep, for instance. Must not throw for anything the
/// caller should retry on the next tick; the engine records the run (and
/// advances `nextRunAt`) whether this future completes or throws, the same
/// "recorded either way" rule `AutoCleanRunner.runFor` uses for the same
/// reason — a failure that reschedules itself every tick is a busy loop, not
/// a retry.
typedef JobRunner = Future<void> Function(ScheduledJob job);

/// Where a job `kind` becomes code to run.
///
/// This is the whole extension point Wave 2 asks for: a later feature that
/// wants a standing job registers its runner here, in its own provider setup
/// — `ref.read(jobKindRegistryProvider).register('my_kind', myRunner)` —
/// without this package or [JobSchedulerController]'s tick loop ever knowing
/// that kind exists. Nothing is pre-registered; an unrecognised kind is not
/// this registry's problem to solve, see [JobSchedulerController]'s doc
/// comment for what the engine does with one.
class JobKindRegistry {
  final Map<String, JobRunner> _runners = {};

  /// Registers [runner] for [kind], replacing whatever was registered before.
  /// A later registration for the same kind is intentional (e.g. a feature
  /// re-registering after a config change) and never merged or refused.
  void register(String kind, JobRunner runner) {
    _runners[kind] = runner;
  }

  void unregister(String kind) {
    _runners.remove(kind);
  }

  /// The runner for [kind], or null if nothing has registered one.
  JobRunner? runnerFor(String kind) => _runners[kind];

  bool isRegistered(String kind) => _runners.containsKey(kind);

  /// Every kind with a runner right now, for the status card to say which
  /// jobs on the list actually do anything on this build.
  Set<String> get registeredKinds => Set.unmodifiable(_runners.keys);
}

/// One registry for the life of the app. A [Provider] rather than
/// `autoDispose` on purpose — a feature registers its runner once, from its
/// own provider's `build()`, and that registration has to outlive whichever
/// screen happened to be open when the provider first built.
final jobKindRegistryProvider = Provider<JobKindRegistry>((ref) {
  return JobKindRegistry();
});
