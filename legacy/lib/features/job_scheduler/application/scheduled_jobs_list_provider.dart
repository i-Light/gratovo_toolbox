import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/scheduled_job.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';

/// Every scheduled job on this machine, for the Settings status card.
///
/// A plain [FutureProvider] rather than a `Notifier` — the card only reads
/// and, on a toggle or delete, tells the repository directly and
/// `ref.invalidate`s this provider to re-read, the same refresh pattern
/// `MergeStatusCard`'s refresh button uses on `teamMergeStatusProvider`.
/// `scheduled_jobs` is per-machine (see `ScheduledJob`'s doc comment), so
/// there is no sync pull to react to and nothing else that would ever change
/// this out from under the card.
final scheduledJobsListProvider = FutureProvider<List<ScheduledJob>>((ref) {
  return ref.watch(scheduledJobRepositoryProvider).getAll();
});
