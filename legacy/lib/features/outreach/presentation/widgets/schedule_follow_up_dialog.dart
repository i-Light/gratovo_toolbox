import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/widgets/date_time_picker.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/features/outreach/application/follow_up_scheduler_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Sets a follow-up reminder for one channel: a note, and either a quick
/// preset (tomorrow / +3 days / +1 week, all at 09:00) or a picked date and
/// time.
///
/// Saving always creates the reminder row; a desktop notification is
/// attempted on top and the confirmation says which of the two happened.
///
/// For every contact method, not only a Gmail send: a DM, a call or a
/// `mailto:` hand-off needs chasing too, and the composer's follow-up planner
/// can only queue emails. This dialog and its button were removed with the
/// email overhaul (109b13e) when the planner arrived, which left every other
/// way of reaching out with no follow-up at all; restored beside Mark as
/// sent.
class ScheduleFollowUpDialog extends ConsumerStatefulWidget {
  const ScheduleFollowUpDialog({super.key, required this.influencer});

  final Influencer influencer;

  @override
  ConsumerState<ScheduleFollowUpDialog> createState() =>
      _ScheduleFollowUpDialogState();
}

class _ScheduleFollowUpDialogState
    extends ConsumerState<ScheduleFollowUpDialog> {
  late final TextEditingController _titleController;
  FollowUpPreset _preset = FollowUpPreset.inThreeDays;
  DateTime? _customLocal;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController();
  }

  @override
  void dispose() {
    _titleController.dispose();
    super.dispose();
  }

  Future<void> _pickCustom() async {
    final picked = await pickDateTime(context, initial: _customLocal);
    if (picked != null) {
      setState(() {
        _customLocal = picked;
        _preset = FollowUpPreset.custom;
      });
    }
  }

  Future<void> _save() async {
    if (_saving) return;
    final l10n = AppLocalizations.of(context);
    final navigator = Navigator.of(context);
    final scheduler = ref.read(followUpSchedulerProvider);
    final fmt = ref.read(instantFormatterProvider);

    final dueLocal = scheduler.resolve(_preset, custom: _customLocal);
    final dueUtc = dueLocal.toUtc();
    final title = _titleController.text.trim().isEmpty
        ? l10n.outreachFollowUpDefaultTitle(widget.influencer.handle)
        : _titleController.text.trim();

    setState(() => _saving = true);
    final notified = await scheduler.schedule(
      influencerId: widget.influencer.id,
      title: title,
      dueUtc: dueUtc,
    );

    if (!mounted) return;
    // Raised before the pop, while this dialog's context is still mounted;
    // the toast overlay sits above the navigator, so it outlives the dialog.
    AppToast.success(
      context,
      notified
          ? l10n.outreachFollowUpScheduled(fmt.dateTime(dueUtc))
          : l10n.outreachFollowUpSavedNoNotif,
    );
    navigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final fmt = ref.watch(instantFormatterProvider);

    return AlertDialog(
      title: Text(l10n.outreachScheduleFollowUp),
      content: SizedBox(
        width: 380,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _titleController,
              decoration: InputDecoration(
                labelText: l10n.outreachFollowUpReminderLabel,
                hintText:
                    l10n.outreachFollowUpDefaultTitle(widget.influencer.handle),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              l10n.outreachFollowUpWhenLabel,
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final entry in <(FollowUpPreset, String)>[
                  (FollowUpPreset.tomorrow, l10n.outreachFollowUpTomorrow),
                  (FollowUpPreset.inThreeDays, l10n.outreachFollowUpIn3Days),
                  (FollowUpPreset.inAWeek, l10n.outreachFollowUpInAWeek),
                  (FollowUpPreset.custom, l10n.outreachFollowUpCustom),
                ])
                  ChoiceChip(
                    label: Text(entry.$2),
                    selected: _preset == entry.$1,
                    onSelected: (_) {
                      if (entry.$1 == FollowUpPreset.custom) {
                        _pickCustom();
                      } else {
                        setState(() => _preset = entry.$1);
                      }
                    },
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              _preset == FollowUpPreset.custom && _customLocal != null
                  ? fmt.dateTime(_customLocal!.toUtc())
                  : fmt.dateTime(
                      ref
                          .read(followUpSchedulerProvider)
                          .resolve(_preset, custom: _customLocal)
                          .toUtc(),
                    ),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (_preset == FollowUpPreset.custom)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _pickCustom,
                  icon: const Icon(Icons.event_outlined),
                  label: Text(l10n.outreachFollowUpPickDateTime),
                ),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
        FilledButton(
          key: const Key('follow-up-save'),
          onPressed: _saving ? null : _save,
          child: Text(l10n.commonSave),
        ),
      ],
    );
  }
}
