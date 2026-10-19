import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/core/sync/manual_sync_report.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/core/sync/sync_providers.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/backfill_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/pipeline_warmup_controller.dart';
import 'package:gratovo_toolbox/features/search/application/video_catchup_controller.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The global "sync with server" button, docked over every screen.
///
/// Exists because of the trade `mirror_engine_io.dart`'s `_interval` makes:
/// a connected machine only asks Supabase what changed every few hours, not
/// every few seconds, so somebody who wants this instant — they just heard
/// about a teammate's edit, or they are about to rely on a number being
/// current — needs a way to ask right now instead of waiting out the clock.
/// [SyncEngine.syncNow] is that ask; this widget is the one place in the app
/// that calls it, so it does not have to be wired into nine separate screens.
///
/// It sends in both directions, because this machine holds outgoing work in
/// **two** places and pulls incoming work into **two**:
///
///  1. the mirror's outbox — edits made in the app, drained by `syncNow`'s
///     own pass before it pulls (see `_pass` in mirror_engine_io.dart);
///  2. the pipeline's `gratovo.db` — the channels and videos a search found on
///     this machine, which live entirely outside the mirror. Nothing but a
///     search run ever moved those, so a run that finished while the network
///     was down left its finds in a local file that no button in the app could
///     send, and a teammate's finds never reached this machine's own store
///     between the occasional background pull. [ScraperProcess.pushLocalStore]
///     (`search.py --push-only`) sends them; [ScraperProcess.pullSharedState]
///     with `force: true` (`search.py --pull-only --force-pull`) brings the
///     team's back — forced, so an explicit press is never skipped by the
///     freshness window a background prewarm may have just stamped.
///
/// Order matters: the local store goes up first, then down, so the mirror pass
/// that follows brings the same rows into the mirror and every list in the app
/// shows them without a second press.
///
/// Neither pipeline leg runs while a search (or a catch-up, or a backfill) is
/// going: those share their own results as they go, and a second interpreter
/// writing `gratovo.db` under a running one is where "database is locked"
/// comes from. The mirror pass still runs -- it is the person's own edits --
/// and the snackbar says which half happened. The pull leg goes through
/// [PipelineWarmupNotifier] rather than launching its own process, so a press
/// during the background pull joins it instead of racing it; on a machine's
/// first launch that pull is the pipeline's one-time bootstrap, and this is
/// what kept the button spinning for minutes on a fresh install.
///
/// Renders nothing when there is nothing for it to do — no mirror to refresh
/// (switched off in Settings, or the web build, which never has one) *and* no
/// local pipeline to push. A button with nothing to do is worse than no
/// button: it invites a tap that silently does nothing, or has to explain
/// itself with a disabled state nobody reads.
class SyncNowButton extends ConsumerStatefulWidget {
  const SyncNowButton({super.key});

  @override
  ConsumerState<SyncNowButton> createState() => _SyncNowButtonState();
}

class _SyncNowButtonState extends ConsumerState<SyncNowButton> {
  /// True while the pipeline push/pull is running.
  ///
  /// Local state rather than something on [SyncSnapshot], because that
  /// snapshot is the *mirror's* account of itself and the pipeline store is
  /// not the mirror's business. What both halves share is the spinner, which
  /// is this widget's business.
  bool _pushingLocalStore = false;

  /// The output of whichever pipeline leg failed on the last press, or null if
  /// both succeeded (or there was nothing to run). Drives the error color and
  /// feeds the message. Cleared at the start of every press.
  Object? _pipelineError;

  /// Which leg it was: false means the push failed, true means the push landed
  /// but the pull did not. Only meaningful while [_pipelineError] is set.
  bool _pipelinePullFailed = false;

  /// The pipeline legs were skipped on the last press because a search was
  /// running. Cleared at the start of every press.
  bool _pipelineBusy = false;

  @override
  Widget build(BuildContext context) {
    final engine = ref.watch(syncEngineProvider);
    final canPushLocalStore = ref.watch(capabilitiesProvider).canRunSearch;
    if (engine == null && !canPushLocalStore) return const SizedBox.shrink();

    final status = ref.watch(syncSnapshotProvider);
    final busy = _pushingLocalStore ||
        ref.watch(pipelineWarmupProvider).isRunning ||
        (status?.downloading ?? false) ||
        (status?.uploading ?? false);
    final failed = (status?.hasError ?? false) || _pipelineError != null;
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return FloatingActionButton.small(
      heroTag: 'syncNowButton',
      tooltip: busy ? l10n.syncNowInProgress : l10n.syncNowTooltip,
      backgroundColor: theme.colorScheme.surfaceContainerHighest,
      foregroundColor:
          failed ? theme.colorScheme.error : theme.colorScheme.onSurfaceVariant,
      onPressed: busy ? null : () => _syncNow(l10n),
      child: busy
          ? const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Icon(failed ? Icons.sync_problem_outlined : Icons.sync),
    );
  }

  Future<void> _syncNow(AppLocalizations l10n) async {
    final engine = ref.read(syncEngineProvider);
    final canPushLocalStore = ref.read(capabilitiesProvider).canRunSearch;
    if (engine == null && !canPushLocalStore) return;

    Object? mirrorError;
    setState(() {
      _pipelineError = null;
      _pipelinePullFailed = false;
      _pipelineBusy = false;
      _pushingLocalStore = canPushLocalStore;
    });

    try {
      // The pipeline store, both directions. A failure here does not stop the
      // mirror pass: the two halves fail for unrelated reasons — a missing
      // service key or no Python is a pipeline problem — and it should not
      // cost this person the teammate edits they pressed the button for.
      if (canPushLocalStore) {
        final result = await _syncPipelineStore();
        if (!mounted) return;
        setState(() {
          _pushingLocalStore = false;
          _pipelineError = result.error;
          _pipelinePullFailed = result.pullFailed;
          _pipelineBusy = result.busy;
        });
      } else {
        setState(() => _pushingLocalStore = false);
      }

      // Guarded. A pass reports its own failures through the status snapshot
      // and is built not to throw — but "built not to" is not the same as
      // "cannot", and an exception escaping here would skip the snackbar, skip
      // the record in Settings, and leave the button's own spinner state to the
      // `finally` alone. The person pressing a sync button is owed an answer,
      // including when the answer is that it went wrong.
      try {
        await engine?.syncNow();
      } catch (error) {
        mirrorError = error;
      }
      if (!mounted) return;
    } finally {
      if (mounted && _pushingLocalStore) {
        setState(() => _pushingLocalStore = false);
      }
    }

    final status = ref.read(syncSnapshotProvider);
    final message = _message(l10n, status, mirrorError);
    final ok = status?.hasError != true &&
        _pipelineError == null &&
        mirrorError == null;
    ref.read(lastManualSyncProvider.notifier).record(
          ManualSyncReport(at: DateTime.now(), detail: message, ok: ok),
        );
    if (!mounted) return;
    if (!ok) {
      AppToast.error(context, message);
    } else if (_pipelineBusy) {
      AppToast.warning(context, message);
    } else {
      AppToast.success(context, message);
    }
  }

  String _message(
    AppLocalizations l10n,
    SyncSnapshot? status,
    Object? mirrorError,
  ) {
    // The mirror's failure is reported first: it is the half that carries the
    // team's edits, and "could not reach the server" is the more actionable
    // sentence when both halves failed for the same reason.
    if (status?.hasError ?? false) {
      return l10n.syncNowError(
        '${status?.uploadError ?? status?.downloadError ?? status?.localError}',
      );
    }
    // A pass that threw rather than reporting itself. Rare enough to have no
    // status behind it, and still the person's answer.
    if (mirrorError != null) return l10n.syncNowError('$mirrorError');
    if (_pipelineError != null) {
      // The push is the half that shares this machine's work, so a push
      // failure is the louder one to name; a pull-only failure still means
      // the person's own edits went out.
      return _pipelinePullFailed
          ? l10n.syncNowLocalPullFailed
          : l10n.syncNowLocalPushFailed;
    }
    if (_pipelineBusy) return l10n.syncNowPipelineBusy;
    return l10n.syncNowDone;
  }

  /// Whether a pipeline process that writes `gratovo.db` is going right now.
  bool get _pipelineIsBusy {
    try {
      return ref.read(activeSearchRunControllerProvider.notifier).isRunning ||
          ref.read(videoCatchUpControllerProvider.notifier).isRunning ||
          ref.read(backfillRunControllerProvider.notifier).isRunning;
    } catch (_) {
      // A container without those controllers (tests). Not a reason to
      // refuse a sync.
      return false;
    }
  }

  /// Pushes this machine's pipeline store to the server, then force-pulls the
  /// team's rows back into it.
  ///
  /// Every failure is caught rather than thrown: no pipeline folder, no
  /// interpreter, Supabase not configured for the pipeline on this machine
  /// (the script exits non-zero and says so) — none of them are worth a red
  /// screen, and all of them mean the same thing to the person at the button.
  /// The pull is forced so an explicit press is never skipped by the freshness
  /// window a background prewarm may have just stamped.
  Future<_PipelineSyncResult> _syncPipelineStore() async {
    try {
      final pythonEnv = ref.read(pythonEnvironmentProvider);
      final override = pythonEnv.projectRootOverride.trim();
      final paths = ScraperProcess.resolvePaths(
        projectRootOverride: override.isEmpty ? null : override,
      );
      if (paths == null) return const _PipelineSyncResult();
      if (_pipelineIsBusy) return const _PipelineSyncResult(busy: true);

      // A background pull already in flight is the same work this press
      // wants; let it land rather than pushing underneath it.
      final warmup = ref.read(pipelineWarmupProvider.notifier);
      await warmup.waitForInFlight();
      if (!mounted) return const _PipelineSyncResult();
      if (_pipelineIsBusy) return const _PipelineSyncResult(busy: true);

      final push = await ScraperProcess.pushLocalStore(
        pythonExecutable: pythonEnv.pythonExecutable,
        paths: paths,
      );
      if (!mounted) return const _PipelineSyncResult();
      await warmup.refresh(force: true);
      final pulled = ref.read(pipelineWarmupProvider);
      final pullFailed = pulled.status == PipelineWarmupStatus.failed;
      if (push.succeeded && !pullFailed) return const _PipelineSyncResult();
      return _PipelineSyncResult(
        error: push.succeeded ? (pulled.error ?? 'pull failed') : push.output,
        pullFailed: push.succeeded && pullFailed,
      );
    } catch (error) {
      return _PipelineSyncResult(error: error);
    }
  }
}

/// Which half of [_SyncNowButtonState._syncPipelineStore], if either, failed.
class _PipelineSyncResult {
  const _PipelineSyncResult({
    this.error,
    this.pullFailed = false,
    this.busy = false,
  });

  /// Null when both legs succeeded (or there was no pipeline to run).
  final Object? error;

  /// True only when the push landed and the pull did not.
  final bool pullFailed;

  /// Neither leg ran: a search was going, and it shares for itself.
  final bool busy;
}
