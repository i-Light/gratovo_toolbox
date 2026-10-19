import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/data/models/bulk_archive_due.dart';
import 'package:gratovo_toolbox/data/models/bulk_rejection.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/features/archive/application/archive_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The bulk clean tool's two populations.
///
/// [live] is the original tool: tag NEW channels in a size range as rejected,
/// starting their countdown. [scheduled] acts on channels ALREADY tagged and
/// already counting down -- see [BulkArchiveDueRequest] for what it can and
/// cannot do to them. One dialog, one set of range fields, because the two
/// modes are the same shape of question ("which channels, in this range")
/// asked of two different tables of channels.
enum _BulkMode { live, scheduled }

/// Tags every channel inside a subscriber range and an average-views range as
/// rejected -- or, in [_BulkMode.scheduled], acts on channels already tagged
/// and already counting down.
///
/// Two steps, and the first one is not optional: **check the ranges, then act on
/// the number that came back.** The confirm button does not exist until the
/// database has said how many rows are in scope, and it disappears again the
/// moment any bound is edited. That is the entire safety design — a bulk
/// operation whose blast radius is a text field can lose thousands of channels
/// to a missing zero, and the only defence that works is making the person read
/// the count first.
///
/// The two ranges narrow together: a channel has to be inside every bound that
/// was actually filled in. That is what makes the tool usable on real data —
/// "under 1,000 subscribers" alone also catches the small channel whose videos
/// do 40,000 views, and "under 500 average views" alone is the only sweep that
/// reaches the 80,000-subscriber channel nobody watches any more.
///
/// Shown from the Archive page and from the Search page, which is where the
/// mess is actually made: a broad keyword run ends with several thousand new
/// channels, and this is the tool for the ones that were never worth having.
///
/// Returns the finished summary sentence when something was actually done, and
/// null when the dialog was dismissed — so the caller knows whether to refresh
/// the list behind it and what to put in the snackbar. A sentence rather than
/// an outcome object because the two modes finish with two different outcome
/// types, and the caller does not need to know either shape.
Future<String?> showBulkCleanDialog(BuildContext context) {
  return showDialog<String>(
    context: context,
    builder: (_) => const _BulkCleanDialog(),
  );
}

class _BulkCleanDialog extends ConsumerStatefulWidget {
  const _BulkCleanDialog();

  @override
  ConsumerState<_BulkCleanDialog> createState() => _BulkCleanDialogState();
}

class _BulkCleanDialogState extends ConsumerState<_BulkCleanDialog> {
  final _min = TextEditingController();
  final _max = TextEditingController();
  final _avgMin = TextEditingController();
  final _avgMax = TextEditingController();
  ChannelTag _label = ChannelTag.irrelevant;
  bool _immediate = false;
  _BulkMode _mode = _BulkMode.live;

  /// The scheduled tab's tag filter. Null reaches every due channel
  /// regardless of which rejecting tag started its countdown -- the tool's
  /// original behaviour, kept as the default because narrowing by tag is an
  /// opt-in refinement, not something every run needs.
  ChannelTag? _dueLabel;

  @override
  void initState() {
    super.initState();
    // The previous dialog's answer must not be visible under this one's inputs.
    // Scheduled rather than called inline: the providers are being read during
    // the first build of a widget that watches them.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(bulkCleanProvider.notifier).reset();
      ref.read(archiveDueCleanProvider.notifier).reset();
    });
  }

  @override
  void dispose() {
    _min.dispose();
    _max.dispose();
    _avgMin.dispose();
    _avgMax.dispose();
    super.dispose();
  }

  BulkRejectionRequest get _request => BulkRejectionRequest(
        minSubscribers: _parse(_min.text),
        maxSubscribers: _parse(_max.text),
        minMedianViews: _parse(_avgMin.text),
        maxMedianViews: _parse(_avgMax.text),
        label: _label,
        immediate: _immediate,
      );

  /// The same ranges, asked of the already-due population instead. [action]
  /// only matters for the apply call -- the preview's matched/skipped counts
  /// do not depend on it, so the "Check" button always previews with
  /// [ArchiveDueAction.archiveNow] and either confirm button re-asks with the
  /// action it actually means.
  BulkArchiveDueRequest _dueRequest(ArchiveDueAction action) =>
      BulkArchiveDueRequest(
        action: action,
        minSubscribers: _parse(_min.text),
        maxSubscribers: _parse(_max.text),
        minMedianViews: _parse(_avgMin.text),
        maxMedianViews: _parse(_avgMax.text),
        label: _dueLabel,
      );

  /// Blank means "no bound", which is a different request from zero — so an
  /// unparseable value has to come back null rather than 0, or "from 1o000"
  /// would silently become "from everything".
  static int? _parse(String raw) {
    final cleaned = raw.replaceAll(RegExp('[^0-9]'), '');
    return cleaned.isEmpty ? null : int.tryParse(cleaned);
  }

  /// Any edit to the inputs invalidates the count under the confirm button, so
  /// the button goes with it. Re-checking is one tap; acting on a count that
  /// described a different range is not recoverable. Both providers are reset
  /// regardless of which mode is showing -- cheap, and it means a mode switch
  /// can never leave the other one's stale count reachable.
  void _invalidate() {
    if (ref.read(bulkCleanProvider) != null) {
      ref.read(bulkCleanProvider.notifier).reset();
    }
    if (ref.read(archiveDueCleanProvider) != null) {
      ref.read(archiveDueCleanProvider.notifier).reset();
    }
    setState(() {});
  }

  void _setMode(_BulkMode mode) {
    if (mode == _mode) return;
    _mode = mode;
    _invalidate();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final result = ref.watch(bulkCleanProvider);
    final dueResult = ref.watch(archiveDueCleanProvider);
    final scheduled = _mode == _BulkMode.scheduled;
    final busy = scheduled ? dueResult is AsyncLoading : result is AsyncLoading;
    final preview = result?.value;
    final duePreview = dueResult?.value;
    // Read, not watched: progress changes on its own schedule and is repainted
    // by the callback [_apply]/[_applyDue] installs, not by a state change.
    final progress = scheduled
        ? ref.read(archiveDueCleanProvider.notifier).progress
        : ref.read(bulkCleanProvider.notifier).progress;

    return AlertDialog(
      title: Text(
        scheduled ? l10n.archiveBulkCleanDueTitle : l10n.archiveBulkCleanTitle,
      ),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              SegmentedButton<_BulkMode>(
                segments: [
                  ButtonSegment(
                    value: _BulkMode.live,
                    label: Text(l10n.archiveBulkCleanModeLive),
                  ),
                  ButtonSegment(
                    value: _BulkMode.scheduled,
                    label: Text(l10n.archiveBulkCleanModeScheduled),
                  ),
                ],
                selected: {_mode},
                onSelectionChanged: busy
                    ? null
                    : (selected) => setState(() => _setMode(selected.first)),
              ),
              const SizedBox(height: 16),
              Text(
                scheduled
                    ? l10n.archiveBulkCleanDueBody
                    : l10n.archiveBulkCleanBody,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 16),
              _RangeHeader(
                text: l10n.archiveBulkCleanSubsSection,
                tooltip: l10n.archiveBulkCleanRangeTip,
                theme: theme,
              ),
              const SizedBox(height: 8),
              _BoundRow(
                minController: _min,
                maxController: _max,
                minLabel: l10n.archiveBulkCleanMinLabel,
                maxLabel: l10n.archiveBulkCleanMaxLabel,
                onChanged: _invalidate,
              ),
              const SizedBox(height: 12),
              // The second range, on equal footing with the first rather than
              // behind a disclosure. A sweep run on subscribers alone is the
              // one this dialog most needs to stop being the default.
              _RangeHeader(
                text: l10n.archiveBulkCleanAvgSection,
                tooltip: l10n.archiveBulkCleanRangeTip,
                theme: theme,
              ),
              const SizedBox(height: 8),
              _BoundRow(
                minController: _avgMin,
                maxController: _avgMax,
                minLabel: l10n.archiveBulkCleanAvgMinLabel,
                maxLabel: l10n.archiveBulkCleanAvgMaxLabel,
                onChanged: _invalidate,
              ),
              // Live mode only: an unbounded live sweep is "reject everything",
              // which the RPC refuses -- so the hint (and the button gate below)
              // exist to say so before the person finds out from an error.
              // Scheduled mode has no such trap: the base population is already
              // bounded to channels somebody already decided to reject.
              if (!scheduled) ...[
                const SizedBox(height: 6),
                Text(
                  _request.isValid
                      ? l10n.archiveBulkCleanBoundsHint
                      : l10n.archiveBulkCleanNeedsBound,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: _request.isValid
                        ? theme.colorScheme.onSurfaceVariant
                        : theme.colorScheme.error,
                  ),
                ),
              ],
              if (!scheduled) ...[
                const SizedBox(height: 16),
                DropdownButtonFormField<ChannelTag>(
                  initialValue: _label,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: l10n.archiveBulkCleanLabelLabel,
                    isDense: true,
                    border: const OutlineInputBorder(),
                  ),
                  // Only the rejecting tags — the archive's own check constraint
                  // allows nothing else. Offering `qualified` or `undecided` here
                  // would build a request the database refuses.
                  items: [
                    for (final tag in ChannelTag.rejecting)
                      DropdownMenuItem(
                        value: tag,
                        child: Text(tag.label(l10n),
                            overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: (tag) {
                    if (tag != null) {
                      _label = tag;
                      _invalidate();
                    }
                  },
                ),
                const SizedBox(height: 8),
                CheckboxListTile(
                  value: _immediate,
                  onChanged: (value) {
                    _immediate = value ?? false;
                    _invalidate();
                  },
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  dense: true,
                  title: Text(l10n.archiveBulkCleanImmediate),
                  subtitle: Text(
                    l10n.archiveBulkCleanImmediateHint,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: _immediate
                          ? theme.colorScheme.error
                          : theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
              // Scheduled mode only: which reason's countdown this run
              // touches. "All reasons" (the default) is the tool's original,
              // all-in-one-sweep behaviour -- a channel due because it was
              // tagged `irrelevant` is not always one a person means to act on
              // in the same breath as one due because it was tagged
              // `haramStuff`.
              if (scheduled) ...[
                const SizedBox(height: 16),
                DropdownButtonFormField<ChannelTag?>(
                  initialValue: _dueLabel,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: l10n.archiveFilterLabel,
                    isDense: true,
                    border: const OutlineInputBorder(),
                  ),
                  items: [
                    DropdownMenuItem(
                      value: null,
                      child: Text(
                        l10n.archiveFilterAllLabels,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    for (final tag in ChannelTag.rejecting)
                      DropdownMenuItem(
                        value: tag,
                        child: Text(tag.label(l10n),
                            overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: (tag) {
                    _dueLabel = tag;
                    _invalidate();
                  },
                ),
              ],
              const SizedBox(height: 8),
              if (progress != null)
                // A clean of a few thousand channels is a minute of work, and a
                // dialog that shows nothing for a minute is one people
                // force-quit halfway through -- which is the one way this
                // operation can genuinely leave a mess.
                _RunningNote(
                  progress: progress,
                  matched: scheduled
                      ? duePreview?.matched ?? 0
                      : preview?.matched ?? 0,
                  workingLabel: scheduled
                      ? 'Working through the channels currently due…'
                      : null,
                  l10n: l10n,
                )
              else if ((scheduled ? dueResult : result)?.hasError ?? false)
                _FailureNote(
                    error: (scheduled ? dueResult : result)!.error!, l10n: l10n)
              else if (scheduled && duePreview != null)
                _PreviewSummaryDue(outcome: duePreview, l10n: l10n)
              else if (!scheduled && preview != null)
                _PreviewSummary(outcome: preview, l10n: l10n),
            ],
          ),
        ),
      ),
      actions: [
        // Never disabled. A modal whose only working key is Escape is a bug
        // whatever it is waiting for, and closing this one is safe: the run
        // belongs to the provider, not to the dialog, so it carries on and the
        // Archive page refreshes itself when it lands.
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(busy ? l10n.commonClose : l10n.commonCancel),
        ),
        if (busy && progress?.phase == BulkCleanPhase.deleting)
          TextButton(
            onPressed: progress!.stopping
                ? null
                : () {
                    if (scheduled) {
                      ref.read(archiveDueCleanProvider.notifier).stop();
                    } else {
                      ref.read(bulkCleanProvider.notifier).stop();
                    }
                  },
            child: Text(l10n.archiveBulkCleanStop),
          ),
        // "Check", not "Check again", until there is something to re-check —
        // the label is how the two-step flow explains itself without a
        // paragraph about it.
        if (!busy)
          OutlinedButton(
            onPressed: busy || (!scheduled && !_request.isValid)
                ? null
                : () => scheduled
                    ? ref
                        .read(archiveDueCleanProvider.notifier)
                        .preview(_dueRequest(ArchiveDueAction.archiveNow))
                    : ref.read(bulkCleanProvider.notifier).preview(_request),
            child: Text((scheduled ? duePreview : preview) == null
                ? l10n.archiveBulkCleanPreview
                : l10n.archiveBulkCleanRecheck),
          ),
        if (!busy && !scheduled && preview != null && preview.matched > 0)
          FilledButton(
            onPressed: busy ? null : _applyLive,
            style: _immediate
                ? FilledButton.styleFrom(
                    backgroundColor: theme.colorScheme.error,
                    foregroundColor: theme.colorScheme.onError,
                  )
                : null,
            child: Text(_immediate
                ? l10n.archiveBulkCleanConfirmDelete(preview.matched)
                : l10n.archiveBulkCleanConfirmTag(preview.matched)),
          ),
        if (!busy &&
            scheduled &&
            duePreview != null &&
            duePreview.matched > 0) ...[
          OutlinedButton(
            onPressed: () => _applyDue(ArchiveDueAction.undo),
            child: Text(l10n.archiveBulkCleanConfirmUndo(duePreview.matched)),
          ),
          FilledButton(
            onPressed: () => _applyDue(ArchiveDueAction.archiveNow),
            style: FilledButton.styleFrom(
              backgroundColor: theme.colorScheme.error,
              foregroundColor: theme.colorScheme.onError,
            ),
            child: Text(
                l10n.archiveBulkCleanConfirmArchiveNow(duePreview.matched)),
          ),
        ],
      ],
    );
  }

  Future<void> _applyLive() async {
    final notifier = ref.read(bulkCleanProvider.notifier);
    notifier.onProgress = () {
      if (mounted) setState(() {});
    };
    try {
      final outcome = await notifier.apply(_request);
      // `mounted` false means the dialog was closed while this ran, which is
      // allowed: the controller has already announced the change, so the page
      // behind is correct without this pop.
      if (!mounted || outcome == null) return;
      Navigator.of(context)
          .pop(bulkCleanSummary(outcome, AppLocalizations.of(context)));
    } finally {
      notifier.onProgress = null;
    }
  }

  Future<void> _applyDue(ArchiveDueAction action) async {
    final notifier = ref.read(archiveDueCleanProvider.notifier);
    notifier.onProgress = () {
      if (mounted) setState(() {});
    };
    try {
      final outcome = await notifier.apply(_dueRequest(action));
      if (!mounted || outcome == null) return;
      Navigator.of(context).pop(
        archiveDueCleanSummary(outcome, action, AppLocalizations.of(context)),
      );
    } finally {
      notifier.onProgress = null;
    }
  }
}

/// A range's heading, with the "what does this range do" tip on an info icon.
class _RangeHeader extends StatelessWidget {
  const _RangeHeader({
    required this.text,
    required this.tooltip,
    required this.theme,
  });

  final String text;
  final String tooltip;
  final ThemeData theme;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Flexible(
          child: Text(
            text,
            style: theme.textTheme.labelLarge?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        const SizedBox(width: 6),
        Tooltip(
          message: tooltip,
          triggerMode: TooltipTriggerMode.tap,
          showDuration: const Duration(seconds: 8),
          child: Icon(Icons.info_outline,
              size: 15, color: theme.colorScheme.onSurfaceVariant),
        ),
      ],
    );
  }
}

/// One range: two bounds side by side.
class _BoundRow extends StatelessWidget {
  const _BoundRow({
    required this.minController,
    required this.maxController,
    required this.minLabel,
    required this.maxLabel,
    required this.onChanged,
  });

  final TextEditingController minController;
  final TextEditingController maxController;
  final String minLabel;
  final String maxLabel;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _BoundField(
            controller: minController,
            label: minLabel,
            onChanged: onChanged,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _BoundField(
            controller: maxController,
            label: maxLabel,
            onChanged: onChanged,
          ),
        ),
      ],
    );
  }
}

class _BoundField extends StatelessWidget {
  const _BoundField({
    required this.controller,
    required this.label,
    required this.onChanged,
  });

  final TextEditingController controller;
  final String label;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      keyboardType: TextInputType.number,
      // Digits only at the keystroke, not validated afterwards: a subscriber
      // bound with a stray character in it is the exact input whose silent
      // reinterpretation this dialog cannot afford.
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      decoration: InputDecoration(
        labelText: label,
        isDense: true,
        border: const OutlineInputBorder(),
      ),
      onChanged: (_) => onChanged(),
    );
  }
}

/// What the run is doing, while it does it.
///
/// Three things, because a person watching a destructive operation needs all
/// three: which half is running, how far it has got if that can be counted, and
/// that closing the dialog will not undo or interrupt it.
class _RunningNote extends StatelessWidget {
  const _RunningNote({
    required this.progress,
    required this.matched,
    required this.l10n,
    this.workingLabel,
  });

  final BulkCleanProgress progress;
  final int matched;
  final AppLocalizations l10n;

  /// Overrides the "Tagging…" wording for [BulkCleanPhase.tagging] -- the
  /// scheduled-for-archive mode is not tagging anything, it is either clearing
  /// tags or moving a due date, and "Tagging" would describe neither.
  final String? workingLabel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final deleting = progress.phase == BulkCleanPhase.deleting;
    final label = switch (progress.phase) {
      BulkCleanPhase.checking => 'Counting what this range covers…',
      BulkCleanPhase.tagging => workingLabel ??
          (matched > 0
              ? 'Tagging $matched channels…'
              : 'Tagging the channels in this range…'),
      BulkCleanPhase.deleting =>
        l10n.archiveBulkCleanDeleting(progress.done, progress.total),
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(width: 10),
              Expanded(child: Text(label, style: theme.textTheme.bodyMedium)),
            ],
          ),
          // Determinate only while deleting: the tagging is a single statement
          // and a bar that crawls to 90% and waits is a worse lie than a
          // spinner.
          if (deleting && progress.total > 0) ...[
            const SizedBox(height: 10),
            LinearProgressIndicator(value: progress.done / progress.total),
          ],
          const SizedBox(height: 8),
          Text(
            progress.stopping
                ? 'Stopping after this batch. What is already tagged stays '
                    'tagged, and the nightly sweep finishes the rest.'
                : 'This keeps running if you close it. The Archive page '
                    'updates when it finishes.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

/// Why it failed, and not only that it did.
///
/// The localized line alone ("Couldn't run the bulk clean.") is the same
/// sentence for a permission the server refused, a range the RPC rejected and a
/// statement Postgres cancelled for running too long -- three problems with
/// three different answers, and none of them guessable from the wording. The
/// raw exception is shown underneath, selectable so it can be pasted somewhere
/// useful: `PostgrestException(message: ..., code: 57014, ...)` names the cause
/// exactly, and this dialog is the only place it is ever seen.
class _FailureNote extends StatelessWidget {
  const _FailureNote({required this.error, required this.l10n});

  final Object error;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.archiveBulkCleanFailed,
          style: theme.textTheme.bodySmall
              ?.copyWith(color: theme.colorScheme.error),
        ),
        const SizedBox(height: 6),
        // Bounded: a Postgrest error carries `details` and `hint` as well, and
        // an unbounded one would push the buttons off a short window.
        ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 120),
          child: SingleChildScrollView(
            child: SelectableText(
              error.toString(),
              style: theme.textTheme.bodySmall?.copyWith(
                fontFamily: 'monospace',
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// What the dry run found: the number in scope, and the three reasons other
/// channels in the same ranges are being left alone.
///
/// The skipped counts are shown rather than summarised away, because they are
/// the difference between "this did less than I expected" and "this quietly
/// skipped rows I meant to catch" — and the third one, channels missing a
/// number the ranges need, is the one that would otherwise be invisible.
class _PreviewSummary extends StatelessWidget {
  const _PreviewSummary({required this.outcome, required this.l10n});

  final BulkRejectionOutcome outcome;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final notes = [
      l10n.archiveBulkCleanSkippedTagged(outcome.skippedAlreadyTagged),
      l10n.archiveBulkCleanSkippedProtected(outcome.skippedProtected),
      l10n.archiveBulkCleanSkippedUnknown(outcome.skippedUnknownSize),
    ].where((note) => note.isNotEmpty);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.archiveBulkCleanMatched(outcome.matched),
            style: theme.textTheme.titleSmall,
          ),
          for (final note in notes) ...[
            const SizedBox(height: 4),
            Text(
              note,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// [_PreviewSummary]'s counterpart for the "scheduled for archive" side: the
/// number currently due in range, and the two reasons a due channel in that
/// same range is left out of it.
class _PreviewSummaryDue extends StatelessWidget {
  const _PreviewSummaryDue({required this.outcome, required this.l10n});

  final BulkArchiveDueOutcome outcome;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final notes = [
      l10n.archiveBulkCleanSkippedProtected(outcome.skippedProtected),
      l10n.archiveBulkCleanSkippedUnknown(outcome.skippedUnknown),
    ].where((note) => note.isNotEmpty);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.archiveBulkCleanDueMatched(outcome.matched),
            style: theme.textTheme.titleSmall,
          ),
          for (final note in notes) ...[
            const SizedBox(height: 4),
            Text(
              note,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
          const SizedBox(height: 8),
          Text(
            l10n.archiveBulkCleanArchiveNowHint,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.error,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            l10n.archiveBulkCleanUndoHint,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

/// The snackbar shown after a live-mode bulk clean lands.
///
/// Reports [BulkRejectionOutcome.tagged] and, separately,
/// [BulkRejectionOutcome.archived] — two different things happened and rolling
/// them into one number would hide which. The archived figure counts only the
/// channels this request tagged; the sweep it triggers is table-wide.
String bulkCleanSummary(BulkRejectionOutcome outcome, AppLocalizations l10n) {
  if (outcome.archived > 0) {
    return l10n.archiveBulkCleanArchived(outcome.archived);
  }
  return l10n.archiveBulkCleanTagged(outcome.tagged);
}

/// [bulkCleanSummary]'s counterpart for the "scheduled for archive" side.
///
/// [action] picks the sentence rather than the outcome's own numbers, because
/// an [ArchiveDueAction.archiveNow] run that is still sweeping in batches
/// reports [BulkArchiveDueOutcome.archived] as zero until a batch actually
/// lands -- the same reason [bulkCleanSummary] cannot infer which action ran
/// from its outcome alone.
String archiveDueCleanSummary(
  BulkArchiveDueOutcome outcome,
  ArchiveDueAction action,
  AppLocalizations l10n,
) {
  if (action == ArchiveDueAction.undo) {
    return l10n.archiveBulkCleanUndone(outcome.updated);
  }
  return l10n.archiveBulkCleanArchived(outcome.archived);
}
