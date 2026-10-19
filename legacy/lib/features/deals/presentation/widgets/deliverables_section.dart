import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/widgets/status_badge.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/features/deals/application/deal_deliverables_controller.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/thirty_day_report_dialog.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Per-item deliverable tracking for one deal: a row per [Deliverable], each
/// with its type, a pending → drafted → approved → published status, the
/// three optional dates, a published-link field once it's live, notes and
/// manual reorder — add/edit/delete all live here.
///
/// Deliberately separate from [Deal.deliverables] (the old freeform summary
/// line, still shown in its own card above) rather than replacing it: a deal
/// for "an integration plus two community posts" can keep the one-line
/// summary for a quick read *and* track those three pieces individually here.
///
/// Self-contained by design — its own controller
/// (`deal_deliverables_controller.dart`), its own repository read
/// (`deliverableRepositoryProvider`), nothing else in the app reads any of
/// it — so it drops into the deal detail screen as a single widget call with
/// no shared state to wire up.
class DeliverablesSection extends ConsumerWidget {
  const DeliverablesSection({super.key, required this.dealId});

  final String dealId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final deliverablesAsync = ref.watch(dealDeliverablesProvider(dealId));

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    l10n.deliverableSectionTitle,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                TextButton.icon(
                  onPressed: () => _addDeliverable(context, ref, l10n),
                  icon: const Icon(Icons.add),
                  label: Text(l10n.deliverableAddButton),
                ),
              ],
            ),
            Text(
              l10n.deliverableSectionSubtitle,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            deliverablesAsync.when(
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (error, stackTrace) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.deliverableLoadError),
                  TextButton(
                    onPressed: () =>
                        ref.invalidate(dealDeliverablesProvider(dealId)),
                    child: Text(l10n.commonRetry),
                  ),
                ],
              ),
              data: (deliverables) {
                if (deliverables.isEmpty) {
                  return Text(
                    l10n.deliverableEmptyState,
                    style: Theme.of(context).textTheme.bodyMedium,
                  );
                }
                return Column(
                  children: [
                    for (var i = 0; i < deliverables.length; i++) ...[
                      if (i > 0) const Divider(height: 24),
                      _DeliverableRow(
                        dealId: dealId,
                        deliverable: deliverables[i],
                        isFirst: i == 0,
                        isLast: i == deliverables.length - 1,
                      ),
                    ],
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _addDeliverable(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
  ) async {
    final type = await showDialog<DeliverableType>(
      context: context,
      builder: (dialogContext) => SimpleDialog(
        title: Text(l10n.deliverableAddDialogTitle),
        children: [
          for (final candidate in DeliverableType.values)
            SimpleDialogOption(
              onPressed: () => Navigator.of(dialogContext).pop(candidate),
              child: Text(candidate.label(l10n)),
            ),
        ],
      ),
    );
    if (type == null) return;
    await ref
        .read(dealDeliverablesProvider(dealId).notifier)
        .addDeliverable(type);
    if (context.mounted) {
      AppToast.success(context, l10n.deliverableAddedToast);
    }
  }
}

class _DeliverableRow extends ConsumerStatefulWidget {
  const _DeliverableRow({
    required this.dealId,
    required this.deliverable,
    required this.isFirst,
    required this.isLast,
  });

  final String dealId;
  final Deliverable deliverable;
  final bool isFirst;
  final bool isLast;

  @override
  ConsumerState<_DeliverableRow> createState() => _DeliverableRowState();
}

class _DeliverableRowState extends ConsumerState<_DeliverableRow> {
  late final TextEditingController _notesController =
      TextEditingController(text: widget.deliverable.notes ?? '');
  late final TextEditingController _urlController =
      TextEditingController(text: widget.deliverable.publishedUrl ?? '');

  @override
  void didUpdateWidget(covariant _DeliverableRow oldWidget) {
    super.didUpdateWidget(oldWidget);
    // A save (ours or another machine's, via sync) changes the row under us;
    // keep each field in step unless the person is mid-edit with a different
    // value already typed — the same rule `WorkingDaysEstimateCard` follows.
    final storedNotes = widget.deliverable.notes ?? '';
    if (oldWidget.deliverable.notes != widget.deliverable.notes &&
        _notesController.text == (oldWidget.deliverable.notes ?? '')) {
      _notesController.text = storedNotes;
    }
    final storedUrl = widget.deliverable.publishedUrl ?? '';
    if (oldWidget.deliverable.publishedUrl != widget.deliverable.publishedUrl &&
        _urlController.text == (oldWidget.deliverable.publishedUrl ?? '')) {
      _urlController.text = storedUrl;
    }
  }

  @override
  void dispose() {
    _notesController.dispose();
    _urlController.dispose();
    super.dispose();
  }

  DealDeliverablesController get _controller =>
      ref.read(dealDeliverablesProvider(widget.dealId).notifier);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final deliverable = widget.deliverable;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: DropdownButton<DeliverableType>(
                value: deliverable.type,
                isDense: true,
                isExpanded: true,
                underline: const SizedBox.shrink(),
                items: [
                  for (final type in DeliverableType.values)
                    DropdownMenuItem(
                      value: type,
                      child: Text(type.label(l10n)),
                    ),
                ],
                onChanged: (type) {
                  if (type == null || type == deliverable.type) return;
                  _controller.updateType(deliverable.id, type);
                },
              ),
            ),
            const SizedBox(width: 8),
            DropdownButton<DeliverableStatus>(
              value: deliverable.status,
              isDense: true,
              underline: const SizedBox.shrink(),
              items: [
                for (final status in DeliverableStatus.values)
                  DropdownMenuItem(
                    value: status,
                    child: StatusBadge(
                      label: status.label(l10n),
                      color: status.color(context),
                    ),
                  ),
              ],
              onChanged: (status) {
                if (status == null || status == deliverable.status) return;
                _controller.updateStatus(deliverable.id, status);
              },
            ),
            IconButton(
              tooltip: l10n.deliverableMoveUpTooltip,
              icon: const Icon(Icons.arrow_upward),
              onPressed: widget.isFirst
                  ? null
                  : () => _controller.moveUp(deliverable.id),
            ),
            IconButton(
              tooltip: l10n.deliverableMoveDownTooltip,
              icon: const Icon(Icons.arrow_downward),
              onPressed: widget.isLast
                  ? null
                  : () => _controller.moveDown(deliverable.id),
            ),
            IconButton(
              tooltip: l10n.deliverableDeleteTooltip,
              icon: const Icon(Icons.delete_outline),
              onPressed: () => _confirmDelete(context, l10n),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 20,
          runSpacing: 8,
          children: [
            _DateField(
              label: l10n.deliverableAgreedDateLabel,
              value: deliverable.agreedDate,
              formatted: deliverable.agreedDate != null
                  ? fmt.date(deliverable.agreedDate!)
                  : l10n.deliverableDateNotSet,
              onPick: (value) => _controller.setDate(
                deliverable.id,
                DeliverableDateField.agreed,
                value,
              ),
            ),
            _DateField(
              label: l10n.deliverableDraftReceivedDateLabel,
              value: deliverable.draftReceivedDate,
              formatted: deliverable.draftReceivedDate != null
                  ? fmt.date(deliverable.draftReceivedDate!)
                  : l10n.deliverableDateNotSet,
              onPick: (value) => _controller.setDate(
                deliverable.id,
                DeliverableDateField.draftReceived,
                value,
              ),
            ),
            _DateField(
              label: l10n.deliverableApprovedDateLabel,
              value: deliverable.approvedDate,
              formatted: deliverable.approvedDate != null
                  ? fmt.date(deliverable.approvedDate!)
                  : l10n.deliverableDateNotSet,
              onPick: (value) => _controller.setDate(
                deliverable.id,
                DeliverableDateField.approved,
                value,
              ),
            ),
          ],
        ),
        if (deliverable.status == DeliverableStatus.published) ...[
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: TextField(
                  controller: _urlController,
                  decoration: InputDecoration(
                    labelText: l10n.deliverablePublishedUrlLabel,
                    hintText: l10n.deliverablePublishedUrlHint,
                    isDense: true,
                    border: const OutlineInputBorder(),
                  ),
                  onSubmitted: (_) => _saveUrl(deliverable.id),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.check),
                onPressed: () => _saveUrl(deliverable.id),
              ),
            ],
          ),
          const SizedBox(height: 8),
          // The 30-day report (plan step 7): due 30 days after it went live.
          Wrap(
            spacing: 12,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              OutlinedButton.icon(
                onPressed: () => showThirtyDayReport(
                  context,
                  dealId: deliverable.dealId,
                  deliverableId: deliverable.id,
                ),
                icon: const Icon(Icons.insights_outlined),
                label: Text(l10n.reportTitle),
              ),
              if (!deliverable.hasReport && deliverable.reportDueAt != null)
                Text(
                  l10n.reportDueOn(fmt.date(deliverable.reportDueAt!)),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
            ],
          ),
        ],
        const SizedBox(height: 8),
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: TextField(
                controller: _notesController,
                decoration: InputDecoration(
                  hintText: l10n.deliverableNotesHint,
                  isDense: true,
                  border: const OutlineInputBorder(),
                ),
                onSubmitted: (_) => _saveNotes(deliverable.id),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.check),
              onPressed: () => _saveNotes(deliverable.id),
            ),
          ],
        ),
      ],
    );
  }

  void _saveUrl(String id) {
    _controller.updatePublishedUrl(id, _urlController.text.trim());
  }

  void _saveNotes(String id) {
    _controller.updateNotes(id, _notesController.text.trim());
  }

  Future<void> _confirmDelete(
    BuildContext context,
    AppLocalizations l10n,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.deliverableDeleteConfirmTitle),
        content: Text(l10n.deliverableDeleteConfirmBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.commonCancel),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(dialogContext).colorScheme.error,
              foregroundColor: Theme.of(dialogContext).colorScheme.onError,
            ),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.commonDelete),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _controller.delete(widget.deliverable.id);
    if (context.mounted) {
      AppToast.success(context, l10n.deliverableDeletedToast);
    }
  }
}

/// One of the three optional dates on a row: the label, the current value (or
/// [l10n.deliverableDateNotSet]), a tap to pick a new one and, once set, a
/// small clear button.
class _DateField extends StatelessWidget {
  const _DateField({
    required this.label,
    required this.value,
    required this.formatted,
    required this.onPick,
  });

  final String label;
  final DateTime? value;
  final String formatted;
  final ValueChanged<DateTime?> onPick;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label, style: Theme.of(context).textTheme.labelSmall),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            InkWell(
              onTap: () async {
                final now = DateTime.now();
                final picked = await showDatePicker(
                  context: context,
                  initialDate: value ?? now,
                  firstDate: DateTime(now.year - 2),
                  lastDate: DateTime(now.year + 3),
                );
                if (picked != null) onPick(picked);
              },
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(formatted),
                  const SizedBox(width: 4),
                  const Icon(Icons.edit_calendar_outlined, size: 16),
                ],
              ),
            ),
            if (value != null)
              IconButton(
                icon: const Icon(Icons.close, size: 14),
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
                onPressed: () => onPick(null),
              ),
          ],
        ),
      ],
    );
  }
}
