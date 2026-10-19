import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/presence/editing_target.dart';
import 'package:gratovo_toolbox/core/presence/presence_widgets.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/models/activity_log_query.dart';
import 'package:gratovo_toolbox/data/models/edit_conflict.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_mutation_guard.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:intl/intl.dart';

/// A person's own read on this channel's engagement, typed in by hand.
///
/// Deliberately, permanently manual — see [Influencer.manualEngagementRate].
/// There is no "refresh" button here and there never should be one: nothing
/// on this card ever calls out to YouTube or any other API. The only way any
/// of these three fields changes is a person opening the edit dialog and
/// typing.
///
/// Sits beside the channel's *measured* numbers (subscribers, median views,
/// on [ChannelHeaderCard]) rather than inside that card, so the "we measured
/// this" and "someone told us this" numbers are never in the same visual
/// group — the same separation [ProvidedDataCard] draws for the influencer's
/// own self-reported stats, and for the same reason.
class ManualEngagementCard extends ConsumerWidget {
  const ManualEngagementCard({
    super.key,
    required this.influencer,
    required this.l10n,
  });

  final Influencer influencer;
  final AppLocalizations l10n;

  Future<void> _edit(BuildContext context, WidgetRef ref) async {
    final result = await showDialog<_ManualEngagementEdit>(
      context: context,
      builder: (context) => _ManualEngagementEditDialog(
        l10n: l10n,
        initialRate: influencer.manualEngagementRate,
        initialNote: influencer.manualEngagementNote,
      ),
    );
    if (result == null || !context.mounted) return;

    final beforeRate = influencer.manualEngagementRate;
    await guardInfluencerMutation(
      context,
      ref,
      influencer,
      action: () async {
        await ref.read(influencerRepositoryProvider).updateManualEngagement(
              influencer.id,
              rate: result.rate,
              note: result.note,
            );
        // Not compare-and-set — see [InfluencerRepository.updateManualEngagement]
        // — so there is no conflict outcome to report; the write either lands
        // or throws.
        return EditOutcome.applied;
      },
      // Only whether a rate ended up set, never the number itself or the
      // note's contents — this is a channel's engagement figure, not
      // something that needs redacting, but the activity log is read by more
      // people than this card, and "cleared the engagement rate" already says
      // everything anyone reading the log needs.
      log: (logger) => logger.record(
        ActivityDraft(
          action: ActivityAction.updated,
          entityType: 'channel',
          entityId: influencer.id,
          entityLabel: influencer.handle,
          field: 'manual_engagement',
          oldValue: beforeRate == null ? null : '$beforeRate',
          newValue: result.rate == null ? null : '${result.rate}',
        ),
      ),
      successMessage: result.rate == null && result.note == null
          ? l10n.manualEngagementCleared
          : l10n.manualEngagementSaved,
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final rate = influencer.manualEngagementRate;
    final note = influencer.manualEngagementNote?.trim();
    final updatedAt = influencer.manualEngagementUpdatedAt;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: PresenceBorder(
          type: 'channel',
          id: influencer.id,
          field: 'manual_engagement',
          child: EditingScope(
            target: EditingTarget(
              type: 'channel',
              id: influencer.id,
              field: 'manual_engagement',
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        l10n.manualEngagementTitle,
                        style: theme.textTheme.titleMedium,
                      ),
                    ),
                    IconButton(
                      tooltip: l10n.manualEngagementEditAction,
                      icon: const Icon(Icons.edit_outlined, size: 20),
                      onPressed: () => _edit(context, ref),
                    ),
                  ],
                ),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.person_outline,
                      size: 14,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        l10n.manualEngagementDisclaimer,
                        style: theme.textTheme.bodySmall,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                if (updatedAt == null)
                  Text(
                    l10n.manualEngagementNeverEntered,
                    style: theme.textTheme.bodySmall,
                  )
                else ...[
                  Wrap(
                    spacing: 24,
                    runSpacing: 12,
                    children: [
                      _StatItem(
                        label: l10n.manualEngagementRateLabel,
                        value: rate == null
                            ? l10n.manualEngagementRateNotSet
                            : '${formatMoney(rate, locale: l10n.localeName)}%',
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    l10n.manualEngagementNoteLabel,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  Text(
                    (note == null || note.isEmpty)
                        ? l10n.manualEngagementNoteNotSet
                        : note,
                    style: theme.textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _relativeUpdatedLabel(l10n, fmt, updatedAt),
                    style: theme.textTheme.bodySmall,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// `Updated today` / `Updated 3d ago`, in the same terse "Nd" shape
/// [InfluencerStatusTag]'s days-since-deal tag uses, rather than a fresh
/// vocabulary for the same idea.
String _relativeUpdatedLabel(
  AppLocalizations l10n,
  InstantFormatter fmt,
  DateTime updatedAt,
) {
  final daysAgo = -fmt.daysUntil(updatedAt);
  if (daysAgo <= 0) return l10n.manualEngagementUpdatedToday;
  return l10n.manualEngagementUpdatedDaysAgo(daysAgo);
}

class _StatItem extends StatelessWidget {
  const _StatItem({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(value, style: Theme.of(context).textTheme.titleMedium),
        Text(label, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}

/// What the edit dialog hands back: the whole entry as it should now read.
/// Both fields null is a valid, deliberate result — it is how clearing is
/// expressed, not an "unset" sentinel to be confused with "leave unchanged".
class _ManualEngagementEdit {
  const _ManualEngagementEdit({this.rate, this.note});

  final double? rate;
  final String? note;
}

class _ManualEngagementEditDialog extends StatefulWidget {
  const _ManualEngagementEditDialog({
    required this.l10n,
    required this.initialRate,
    required this.initialNote,
  });

  final AppLocalizations l10n;
  final double? initialRate;
  final String? initialNote;

  @override
  State<_ManualEngagementEditDialog> createState() =>
      _ManualEngagementEditDialogState();
}

class _ManualEngagementEditDialogState
    extends State<_ManualEngagementEditDialog> {
  late final TextEditingController _rateController;
  late final TextEditingController _noteController;
  String? _rateError;

  @override
  void initState() {
    super.initState();
    _rateController = TextEditingController(
      text: widget.initialRate == null
          ? ''
          : NumberFormat('#.##').format(widget.initialRate),
    );
    _noteController = TextEditingController(text: widget.initialNote ?? '');
  }

  @override
  void dispose() {
    _rateController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  /// Parses the rate box, or refuses to close the dialog on an unreadable
  /// or out-of-range value rather than silently dropping it — a media-kit
  /// number fat-fingered as "4.2.5" should never quietly become "not set".
  bool _validateAndPop(BuildContext context, {required bool clear}) {
    final l10n = widget.l10n;
    if (clear) {
      Navigator.of(context).pop(const _ManualEngagementEdit());
      return true;
    }

    final rateText = _rateController.text.trim();
    double? rate;
    if (rateText.isNotEmpty) {
      rate = double.tryParse(rateText);
      if (rate == null || rate < 0 || rate > 100) {
        setState(() => _rateError = l10n.manualEngagementRateInvalid);
        return false;
      }
    }
    final noteText = _noteController.text.trim();
    Navigator.of(context).pop(
      _ManualEngagementEdit(
        rate: rate,
        note: noteText.isEmpty ? null : noteText,
      ),
    );
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = widget.l10n;
    return AlertDialog(
      title: Text(l10n.manualEngagementEditTitle),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _rateController,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp('[0-9.]')),
              ],
              decoration: InputDecoration(
                labelText: l10n.manualEngagementRateLabel,
                hintText: l10n.manualEngagementRateHint,
                helperText: l10n.manualEngagementEditRateHelp,
                helperMaxLines: 3,
                suffixText: '%',
                border: const OutlineInputBorder(),
                errorText: _rateError,
              ),
              onChanged: (_) {
                if (_rateError != null) setState(() => _rateError = null);
              },
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _noteController,
              maxLines: 3,
              decoration: InputDecoration(
                labelText: l10n.manualEngagementNoteLabel,
                helperText: l10n.manualEngagementEditNoteHelp,
                helperMaxLines: 2,
                border: const OutlineInputBorder(),
              ),
            ),
          ],
        ),
      ),
      actions: [
        // Explicit clear, distinct from Cancel and from an empty Save — an
        // empty rate box plus Save already clears the rate, but a note left
        // in the box with the rate box emptied would otherwise have no way
        // to also go to null in one action.
        TextButton(
          onPressed: () => _validateAndPop(context, clear: true),
          child: Text(l10n.manualEngagementClearAction),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
        FilledButton(
          onPressed: () => _validateAndPop(context, clear: false),
          child: Text(l10n.commonSave),
        ),
      ],
    );
  }
}
