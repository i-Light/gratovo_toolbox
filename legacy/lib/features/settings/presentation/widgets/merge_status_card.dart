import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/core/native/url_launcher_provider.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/features/settings/application/merge_status_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Which local databases a shipped `reset_manifest.json` action moved aside on
/// this machine for manual merge, plus the same board for the rest of the team
/// (`teamMergeStatusProvider`). Always shown — a count of zero is a useful
/// "nothing to do here" rather than a reason to hide.
class MergeStatusCard extends ConsumerWidget {
  const MergeStatusCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        child: Column(
          spacing: 0,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  //       Text(
                  //   l10n.settingsMergeSubtitle,
                  //   style: theme.textTheme.bodySmall,
                  // ),
                  child: Tooltip(
                    message: l10n.settingsMergeSubtitle,
                    child: GradientText(
                      l10n.settingsMergeTitle,
                      style: theme.textTheme.titleMedium,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: l10n.settingsMergeRefresh,
                  icon: const Icon(Icons.refresh),
                  onPressed: () {
                    ref.read(localMergeQuarantineProvider.notifier).refresh();
                    ref.invalidate(teamMergeStatusProvider);
                  },
                ),
              ],
            ),

            // const SizedBox(
            //   height: 16,
            // ),
            Row(
              // mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                Expanded(
                  child: Column(
                    spacing: 8,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(l10n.settingsMergeThisDevice,
                          style: theme.textTheme.labelLarge),
                      const _ThisDeviceSection(),
                    ],
                  ),
                ),
                const Divider(height: 32),
                Expanded(
                  child: Column(
                    spacing: 8,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(l10n.settingsMergeAcrossTeam,
                          style: theme.textTheme.labelLarge),
                      const _TeamSection(),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ThisDeviceSection extends ConsumerWidget {
  const _ThisDeviceSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final indexAsync = ref.watch(localMergeQuarantineProvider);

    return indexAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 8),
        child: LinearProgressIndicator(),
      ),
      error: (_, __) => Text(l10n.settingsMergeLoadFailed,
          style: TextStyle(color: Theme.of(context).colorScheme.error)),
      data: (index) {
        final pending = index.pending;
        if (pending.isEmpty) {
          return Text(l10n.settingsMergeNoneThisDevice,
              style: Theme.of(context).textTheme.bodySmall);
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.settingsMergePendingCount(pending.length),
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            for (final file in pending) _QuarantinedFileTile(file: file),
          ],
        );
      },
    );
  }
}

class _QuarantinedFileTile extends ConsumerWidget {
  const _QuarantinedFileTile({required this.file});

  final QuarantinedFile file;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final formatter = ref.watch(instantFormatterProvider);

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(file.originalRelPath,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(fontFamily: 'monospace')),
          Text(
            l10n.settingsMergeSetAside(formatter.dateTime(file.quarantinedAt)),
            style: theme.textTheme.bodySmall,
          ),
          if (file.note != null)
            Text(l10n.settingsMergeFromRelease(file.note!),
                style: theme.textTheme.bodySmall),
          const SizedBox(height: 4),
          Wrap(
            spacing: 8,
            children: [
              TextButton.icon(
                icon: const Icon(Icons.folder_open, size: 18),
                label: Text(l10n.settingsMergeOpenFolder),
                onPressed: () => _openFolder(ref),
              ),
              TextButton.icon(
                icon: const Icon(Icons.check_circle_outline, size: 18),
                label: Text(l10n.settingsMergeMarkResolved),
                onPressed: () => _confirmResolve(context, ref),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _openFolder(WidgetRef ref) async {
    final paths = ScraperProcess.resolvePaths();
    if (paths == null) return;
    final dir = PipelineDataDir.needsMergeDirPath(paths);
    if (dir.isEmpty) return;
    await ref.read(urlLauncherProvider)(Uri.file(dir));
  }

  Future<void> _confirmResolve(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    final choice = await showDialog<_ResolveChoice>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.settingsMergeResolveTitle),
        content: Text(l10n
            .settingsMergeResolveBody(file.originalRelPath.split('/').last)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(l10n.settingsMergeCancel),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, _ResolveChoice.keep),
            child: Text(l10n.settingsMergeResolveKeepFile),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, _ResolveChoice.delete),
            child: Text(l10n.settingsMergeResolveDeleteFile),
          ),
        ],
      ),
    );
    if (choice == null) return;
    await ref.read(localMergeQuarantineProvider.notifier).markResolved(
          file.storedName,
          deleteFile: choice == _ResolveChoice.delete,
        );
  }
}

enum _ResolveChoice { keep, delete }

class _TeamSection extends ConsumerWidget {
  const _TeamSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final formatter = ref.watch(instantFormatterProvider);
    final rowsAsync = ref.watch(teamMergeStatusProvider);

    return rowsAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 8),
        child: LinearProgressIndicator(),
      ),
      error: (_, __) => Text(l10n.settingsMergeLoadFailed,
          style: TextStyle(color: theme.colorScheme.error)),
      data: (rows) {
        final withPending = rows.where((r) => r.status.hasPending).toList();
        if (withPending.isEmpty) {
          return Text(l10n.settingsMergeTeamNobody,
              style: theme.textTheme.bodySmall);
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final row in withPending)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            row.isMe
                                ? '${row.name} (${l10n.settingsMergeYou})'
                                : row.name,
                            style: theme.textTheme.bodyMedium
                                ?.copyWith(fontWeight: FontWeight.w600),
                          ),
                        ),
                        Chip(
                          visualDensity: VisualDensity.compact,
                          label: Text(l10n.settingsMergePendingCount(
                              row.status.pendingCount)),
                        ),
                      ],
                    ),
                    Text(
                      l10n.settingsMergeTeamUpdated(
                          formatter.dateTime(row.status.updatedAt)),
                      style: theme.textTheme.bodySmall,
                    ),
                    for (final entry in row.status.entries)
                      Padding(
                        padding: const EdgeInsets.only(top: 2, left: 8),
                        child: Text('• ${entry.path}',
                            style: theme.textTheme.bodySmall
                                ?.copyWith(fontFamily: 'monospace')),
                      ),
                  ],
                ),
              ),
          ],
        );
      },
    );
  }
}
