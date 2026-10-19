import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/sync/manual_sync_report.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/core/sync/sync_providers.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Whether this machine keeps its own copy of the channel database, and what
/// that copy is doing.
///
/// Worth a permanent row rather than a transient banner, because the answer
/// changes what the app IS: on a machine with no copy every screen waits on the
/// network, and on a machine with one every screen reads a local file and the
/// edits queue. Somebody debugging "why is this slow" or "why has my colleague
/// not seen my change" needs to be able to find out which of those they are
/// looking at.
class SyncStatusRow extends ConsumerWidget {
  const SyncStatusRow({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final status = ref.watch(syncSnapshotProvider);

    // The order below is the order these matter in. An error is worth saying
    // first even while connected, because a queue that cannot upload keeps
    // looking healthy from the outside — the local copy is fine, the edits are
    // saved, and nobody else is seeing any of them.
    final (icon, text, tone) = switch (status) {
      null => (
          Icons.cloud_off_outlined,
          l10n.settingsSyncDisabled,
          theme.colorScheme.onSurfaceVariant,
        ),
      // The local copy failing is said before, and differently from, a server
      // that cannot be reached — the two sound alike and mean opposite things.
      // A sync problem means this machine is ahead of the team and will catch
      // up. This one means the file on the disk stopped answering, every screen
      // has quietly moved back to reading the server, and the machine itself
      // may be the thing that needs attention (a full disk, a failing drive).
      // The app keeps working either way, which is exactly why it has to be
      // written down somewhere a person looks.
      final s when !s.localUsable => (
          Icons.storage_outlined,
          l10n.settingsSyncLocalFault('${s.localError}'),
          theme.colorScheme.error,
        ),
      final s when s.hasError => (
          Icons.sync_problem_outlined,
          l10n.settingsSyncError(
            '${s.uploadError ?? s.downloadError}',
          ),
          theme.colorScheme.error,
        ),
      // Before "downloading the first copy" and before "syncing", because a
      // pass that is being held back is doing neither, and both of those read
      // as progress that is not happening. This is the state the timeouts used
      // to be reported as, and it is not a problem: it is the sync standing
      // aside for the search the person is waiting on.
      final s when s.deferred => (
          Icons.pause_circle_outline,
          l10n.settingsSyncDeferred,
          theme.colorScheme.onSurfaceVariant,
        ),
      final s when !s.hasSynced => (
          Icons.cloud_download_outlined,
          l10n.settingsSyncPreparing,
          theme.colorScheme.onSurfaceVariant,
        ),
      // Before "not connected", because a sync that is under way is the
      // reason this machine has not connected YET, and reading "Offline"
      // during it is simply wrong — `connected` does not turn true until a
      // download has finished, so every pass began by contradicting itself
      // here for as long as it ran. Split by phase rather than one "Syncing…"
      // for all three: the phases are sequential and exclusive (see `_pass` in
      // mirror_engine_io.dart), and "sending" vs "downloading" is the first
      // thing somebody watching it wants to know.
      final s when s.connecting => (
          Icons.sync,
          l10n.settingsSyncConnecting,
          theme.colorScheme.onSurfaceVariant,
        ),
      final s when s.uploading => (
          Icons.sync,
          l10n.settingsSyncUploading,
          theme.colorScheme.onSurfaceVariant,
        ),
      final s when s.downloading => (
          Icons.sync,
          l10n.settingsSyncDownloading,
          theme.colorScheme.onSurfaceVariant,
        ),
      final s when !s.connected => (
          Icons.cloud_off_outlined,
          l10n.settingsSyncOffline,
          theme.colorScheme.onSurfaceVariant,
        ),
      _ => (
          Icons.cloud_done_outlined,
          l10n.settingsSyncActive,
          theme.colorScheme.onSurfaceVariant,
        ),
    };

    final engine = ref.watch(syncEngineProvider);

    // A pass is on the wire right now. `deferred` and `hasError` are handled
    // above and are not it; the first-copy download is (it is a pass too, just
    // a longer one).
    final busy = status != null &&
        !status.hasError &&
        !status.deferred &&
        (status.connecting || status.downloading || status.uploading);

    final lastSyncedAt = status?.lastSyncedAt;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 5),
          child: Icon(icon, size: 20, color: tone),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(spacing: 16, children: [
                Text(l10n.settingsSyncTitle, style: theme.textTheme.labelLarge),
                if (engine != null)
                  TextButton.icon(
                    onPressed: () => showDialog<void>(
                      context: context,
                      builder: (_) => _SyncLogDialog(engine.diagnostics),
                    ),
                    icon: const Icon(Icons.receipt_long_outlined, size: 16),
                    label: Text(l10n.settingsSyncLogButton),
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                    ),
                  ),
                if (lastSyncedAt != null && !busy)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      l10n.settingsSyncLastSynced(
                        MaterialLocalizations.of(context).formatTimeOfDay(
                          TimeOfDay.fromDateTime(lastSyncedAt.toLocal()),
                        ),
                      ),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                const _LastManualSyncLine(),
              ]),
              const SizedBox(height: 2),
              Text(
                text,
                style: theme.textTheme.bodySmall?.copyWith(color: tone),
              ),
              // While a pass runs: what it is doing this second, read from the
              // mirror's own flight recorder. Otherwise: when it last finished
              // one. Neither costs a request.
              if (busy) const _SyncActivityLine()
              // What the last press of the global sync button actually did —
              // kept here because its own snackbar is long gone by the time
              // someone comes to Settings asking "did that sync go through?".
              // In-memory only, so nothing shows until the button is used.
            ],
          ),
        ),
      ],
    );
  }
}

/// The live "what is the sync doing right now" line, mounted only while a pass
/// is on the wire.
///
/// Reads the mirror's own flight recorder ([SyncDiagnostics]) — the same log
/// behind the "Sync details" dialog — and shows its latest milestone as one
/// plain sentence: which table is downloading and how many rows it carried,
/// how many local edits are going up, or the warning if a page went slow.
///
/// Cheap by construction. It rebuilds off [SyncDiagnostics.changes], which
/// fires on milestone entries only (never the several-per-second healthy page
/// lines), so this is a handful of `setState`s per pass and nothing at all
/// between passes. No request, no timer, no polling.
class _SyncActivityLine extends ConsumerStatefulWidget {
  const _SyncActivityLine();

  @override
  ConsumerState<_SyncActivityLine> createState() => _SyncActivityLineState();
}

class _SyncActivityLineState extends ConsumerState<_SyncActivityLine> {
  SyncDiagnostics? _diagnostics;
  StreamSubscription<void>? _sub;

  @override
  void initState() {
    super.initState();
    _diagnostics = ref.read(syncEngineProvider)?.diagnostics;
    _sub = _diagnostics?.changes.listen((_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final entry = _diagnostics?.latest;
    if (entry == null) return const SizedBox.shrink();

    // A milestone from a previous pass, still sitting in the log while this one
    // has not reported anything yet. Showing "Updating channels — 2,532 rows"
    // for a pass that has not touched channels yet is worse than a blank line.
    if (DateTime.now().difference(entry.at) > const Duration(seconds: 30)) {
      return const SizedBox.shrink();
    }

    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final text = _describe(l10n, entry);

    // How far the current download pass has got, in whole tables. There is no
    // row total to count against — the pull is cursor-paged — so "tables done /
    // tables to do" is the honest unit: `pull.start` says how many, and each
    // `pull.table` that follows it is one finished.
    final (done, total) = _tableProgress();

    final warn = entry.level.index >= SyncLogLevel.warn.index;
    if (text == null && total == 0) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (text != null)
            Text(
              text,
              style: theme.textTheme.bodySmall?.copyWith(
                color: warn
                    ? theme.colorScheme.error
                    : theme.colorScheme.onSurfaceVariant,
              ),
            ),
          if (total > 0) ...[
            const SizedBox(height: 4),
            ClipRRect(
              borderRadius: BorderRadius.circular(2),
              child: LinearProgressIndicator(
                value: done / total,
                minHeight: 4,
                backgroundColor: theme.colorScheme.surfaceContainerHighest,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              l10n.settingsSyncProgress(done, total),
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// Walks the flight recorder back to the last `pull.start` and counts the
  /// `pull.table` lines since — `(finished, expected)`. `(0, 0)` when no pass
  /// is on the wire, which the caller reads as "draw nothing".
  (int, int) _tableProgress() {
    final entries = _diagnostics?.entries;
    if (entries == null) return (0, 0);
    var done = 0;
    for (final entry in entries.toList().reversed) {
      if (entry.event == 'pull.table') {
        done++;
      } else if (entry.event == 'pull.start') {
        final total = entry.fields['tables'];
        return total is int && total > 0
            ? (done.clamp(0, total), total)
            : (0, 0);
      }
    }
    return (0, 0);
  }

  /// The entries worth a line of their own. Everything else — `pull.start`,
  /// `pass.start`, `upload.end`, `pass.end` — is already said by the phase
  /// text above, so it returns null and the line stays blank.
  String? _describe(AppLocalizations l10n, SyncLogEntry entry) {
    switch (entry.event) {
      case 'pull.table':
        final table = entry.fields['table'];
        final rows = entry.fields['rows'];
        return table is String && rows != null
            ? l10n.settingsSyncDetailTable(table, '$rows')
            : null;
      case 'upload.start':
        final queued = entry.fields['queued'];
        return queued is int ? l10n.settingsSyncDetailUpload(queued) : null;
      case 'pull.page.slow':
      case 'pull.page.retry':
      case 'pull.page.failed':
        // Already a finished English sentence, and the same one the log shows.
        return entry.message;
      default:
        return null;
    }
  }
}

/// One muted line recording the outcome of the last manual "Sync data with
/// server" press, or nothing at all until there has been one this session.
///
/// Deliberately the whole of the "progress detail in Settings" ask: it reads a
/// value the button already computed for its snackbar, so it costs no request,
/// no poll and no new failure path — it just keeps the answer on screen after
/// the snackbar has gone.
class _LastManualSyncLine extends ConsumerWidget {
  const _LastManualSyncLine();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final report = ref.watch(lastManualSyncProvider);
    if (report == null) return const SizedBox.shrink();

    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final when = MaterialLocalizations.of(context)
        .formatTimeOfDay(TimeOfDay.fromDateTime(report.at));
    final tone = report.ok
        ? theme.colorScheme.onSurfaceVariant
        : theme.colorScheme.error;

    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Text(
        l10n.settingsSyncLastManual(when, report.detail),
        style: theme.textTheme.bodySmall?.copyWith(color: tone),
      ),
    );
  }
}

/// The sync's own log, on screen.
///
/// It exists because the alternative was asking somebody to reproduce a
/// three-hourly background failure while a developer watched a console. The
/// interesting lines are almost never the ones on screen when the problem is
/// noticed — they are the twenty before it — so this shows the whole buffer,
/// bottom-anchored, in a monospaced font that keeps the `key=value` columns
/// lined up, with one button that puts the lot on the clipboard.
class _SyncLogDialog extends StatelessWidget {
  const _SyncLogDialog(this.diagnostics);

  final SyncDiagnostics diagnostics;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final entries = diagnostics.entries;
    final path = diagnostics.filePath;

    return AlertDialog(
      title: Text(l10n.settingsSyncLogTitle),
      content: SizedBox(
        width: 720,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.settingsSyncLogIntro, style: theme.textTheme.bodySmall),
            const SizedBox(height: 4),
            Text(
              l10n.settingsSyncLogCounts(
                diagnostics.failedPassCount,
                diagnostics.passCount,
              ),
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 12),
            Flexible(
              child: Container(
                width: double.infinity,
                constraints: const BoxConstraints(maxHeight: 360),
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: entries.isEmpty
                    ? Text(
                        l10n.settingsSyncLogEmpty,
                        style: theme.textTheme.bodySmall,
                      )
                    : Scrollbar(
                        child: SingleChildScrollView(
                          // Newest last and scrolled to the bottom, because the
                          // last thing that happened is what somebody opened
                          // this to see.
                          reverse: true,
                          child: SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: SelectableText(
                              [for (final entry in entries) entry.format()]
                                  .join('\n'),
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 11,
                                height: 1.45,
                              ),
                            ),
                          ),
                        ),
                      ),
              ),
            ),
            if (path != null) ...[
              const SizedBox(height: 8),
              SelectableText(
                l10n.settingsSyncLogFile(path),
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () async {
            await Clipboard.setData(
              ClipboardData(text: diagnostics.render()),
            );
            if (!context.mounted) return;
            AppToast.success(context, l10n.settingsSyncLogCopied);
          },
          child: Text(l10n.settingsSyncLogCopy),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(MaterialLocalizations.of(context).closeButtonLabel),
        ),
      ],
    );
  }
}
