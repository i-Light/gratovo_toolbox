import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/data/models/scheduled_job.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/job_scheduler/application/scheduled_jobs_list_provider.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// What Settings shows for the generic job scheduler (Wave 2): every
/// `scheduled_jobs` row on this machine, with an enable/disable toggle and a
/// delete action. Always shown — an empty list is a useful "nothing scheduled
/// here" rather than a reason to hide the card, the same call `MergeStatusCard`
/// makes for a zero count.
///
/// Read-only otherwise: creating a job is each feature's own job (a feature
/// registers a runner via `jobKindRegistryProvider` and seeds its own row
/// through `ScheduledJobRepository.upsert`), not something this generic card
/// offers a form for.
class JobSchedulerStatusCard extends ConsumerWidget {
  const JobSchedulerStatusCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final jobsAsync = ref.watch(scheduledJobsListProvider);

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Tooltip(
                    message: l10n.jobSchedulerCardSubtitle,
                    child: GradientText(
                      l10n.jobSchedulerCardTitle,
                      style: theme.textTheme.titleMedium,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: l10n.jobSchedulerRefresh,
                  icon: const Icon(Icons.refresh),
                  onPressed: () => ref.invalidate(scheduledJobsListProvider),
                ),
              ],
            ),
            jobsAsync.when(
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: LinearProgressIndicator(),
              ),
              error: (_, __) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  l10n.jobSchedulerLoadError,
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ),
              data: (jobs) {
                if (jobs.isEmpty) {
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Text(
                      l10n.jobSchedulerEmptyState,
                      style: theme.textTheme.bodySmall,
                    ),
                  );
                }
                return Column(
                  children: [
                    for (final job in jobs) _ScheduledJobTile(job: job),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _ScheduledJobTile extends ConsumerWidget {
  const _ScheduledJobTile({required this.job});

  final ScheduledJob job;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final formatter = ref.watch(instantFormatterProvider);

    final lastRun = job.lastRunAt;
    final nextRun = job.nextRunAt;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // A job name and up to two chips: a Row runs them off the
                // card in a narrow window, and the name is the one of the
                // three that can usefully be shortened.
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      job.kind,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                        fontFamily: 'monospace',
                      ),
                    ),
                    Chip(
                      visualDensity: VisualDensity.compact,
                      label: Text(job.cadence),
                    ),
                    if (!job.enabled)
                      Chip(
                        visualDensity: VisualDensity.compact,
                        label: Text(l10n.jobSchedulerDisabledBadge),
                      ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  lastRun == null
                      ? l10n.jobSchedulerLastRunNever
                      : l10n.jobSchedulerLastRunLabel(
                          formatter.dateTime(lastRun)),
                  style: theme.textTheme.bodySmall,
                ),
                Text(
                  nextRun == null
                      ? l10n.jobSchedulerNextRunNone
                      : l10n.jobSchedulerNextRunLabel(
                          formatter.dateTime(nextRun)),
                  style: theme.textTheme.bodySmall,
                ),
              ],
            ),
          ),
          Switch(
            value: job.enabled,
            onChanged: (value) => _setEnabled(ref, value),
          ),
          IconButton(
            tooltip: l10n.jobSchedulerDeleteTooltip,
            icon: const Icon(Icons.delete_outline),
            onPressed: () => _confirmDelete(context, ref),
          ),
        ],
      ),
    );
  }

  Future<void> _setEnabled(WidgetRef ref, bool value) async {
    await ref
        .read(scheduledJobRepositoryProvider)
        .upsert(job.copyWith(enabled: value));
    ref.invalidate(scheduledJobsListProvider);
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.jobSchedulerDeleteConfirmTitle),
        content: Text(l10n.jobSchedulerDeleteConfirmBody(job.kind)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l10n.jobSchedulerDeleteConfirmCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(l10n.jobSchedulerDeleteConfirmDelete),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await ref.read(scheduledJobRepositoryProvider).delete(job.id);
    ref.invalidate(scheduledJobsListProvider);
  }
}
