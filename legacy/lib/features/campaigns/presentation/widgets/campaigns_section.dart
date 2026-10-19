import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/widgets/status_badge.dart';
import 'package:gratovo_toolbox/data/models/campaign.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/campaigns/application/campaign_providers.dart';
import 'package:gratovo_toolbox/features/campaigns/campaign_routes.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The "Campaigns" card on the brand profile: every [Campaign] grouping this
/// brand's deals, name + status badge + start/live dates, newest first, a
/// dialog to create one and a tap to open its detail screen.
///
/// Purely organisational, per [Campaign]'s own doc comment — no budget or
/// KPI is shown here because none exists on the model.
class CampaignsSection extends ConsumerWidget {
  const CampaignsSection({super.key, required this.brandId});

  final String brandId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final campaignsAsync = ref.watch(campaignsByBrandProvider(brandId));

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
                    l10n.campaignSectionTitle,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                TextButton.icon(
                  onPressed: () => _addCampaign(context, ref, l10n),
                  icon: const Icon(Icons.add),
                  label: Text(l10n.campaignAddButton),
                ),
              ],
            ),
            const SizedBox(height: 4),
            campaignsAsync.when(
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (error, stackTrace) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.commonError),
                  TextButton(
                    onPressed: () =>
                        ref.invalidate(campaignsByBrandProvider(brandId)),
                    child: Text(l10n.commonRetry),
                  ),
                ],
              ),
              data: (campaigns) {
                if (campaigns.isEmpty) {
                  return Text(l10n.campaignSectionEmpty);
                }
                final sorted = [...campaigns]
                  ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
                return Column(
                  children: [
                    for (final campaign in sorted)
                      _CampaignTile(brandId: brandId, campaign: campaign),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _addCampaign(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
  ) async {
    final created = await showDialog<bool>(
      context: context,
      builder: (_) => _AddCampaignDialog(brandId: brandId),
    );
    if ((created ?? false) && context.mounted) {
      AppToast.success(context, l10n.campaignAddedToast);
    }
  }
}

class _CampaignTile extends ConsumerWidget {
  const _CampaignTile({required this.brandId, required this.campaign});

  final String brandId;
  final Campaign campaign;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final fmt = ref.watch(instantFormatterProvider);

    final dateParts = <String>[
      if (campaign.startDate != null)
        l10n.campaignStartDateValue(fmt.date(campaign.startDate!)),
      if (campaign.liveDate != null)
        l10n.campaignLiveDateValue(fmt.date(campaign.liveDate!)),
    ];

    return ListTile(
      contentPadding: EdgeInsets.zero,
      onTap: () => context.go(campaignDetailPath(brandId, campaign.id)),
      title: Text(campaign.name),
      subtitle: dateParts.isEmpty ? null : Text(dateParts.join(' · ')),
      trailing: StatusBadge(
        label: campaign.status.label(l10n),
        color: campaign.status.color(context),
      ),
    );
  }
}

class _AddCampaignDialog extends ConsumerStatefulWidget {
  const _AddCampaignDialog({required this.brandId});

  final String brandId;

  @override
  ConsumerState<_AddCampaignDialog> createState() => _AddCampaignDialogState();
}

class _AddCampaignDialogState extends ConsumerState<_AddCampaignDialog> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _notesController = TextEditingController();
  DateTime? _startDate;
  DateTime? _liveDate;
  bool _saving = false;

  @override
  void dispose() {
    _nameController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final fmt = ref.watch(instantFormatterProvider);

    return AlertDialog(
      title: Text(l10n.campaignAddDialogTitle),
      content: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextFormField(
                controller: _nameController,
                autofocus: true,
                decoration: InputDecoration(labelText: l10n.campaignNameLabel),
                validator: (value) => (value == null || value.trim().isEmpty)
                    ? l10n.campaignNameRequired
                    : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _notesController,
                maxLines: 3,
                decoration: InputDecoration(labelText: l10n.campaignNotesLabel),
              ),
              const SizedBox(height: 12),
              _DatePickerField(
                label: l10n.campaignStartDateLabel,
                value: _startDate,
                formatted: _startDate != null ? fmt.date(_startDate!) : null,
                notSetLabel: l10n.campaignDateNotSet,
                onChanged: (value) => setState(() => _startDate = value),
              ),
              const SizedBox(height: 8),
              _DatePickerField(
                label: l10n.campaignLiveDateLabel,
                value: _liveDate,
                formatted: _liveDate != null ? fmt.date(_liveDate!) : null,
                notSetLabel: l10n.campaignDateNotSet,
                onChanged: (value) => setState(() => _liveDate = value),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: Text(l10n.commonCancel),
        ),
        FilledButton(
          onPressed: _saving ? null : _submit,
          child: Text(l10n.commonAdd),
        ),
      ],
    );
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _saving = true);
    final now = DateTime.now();
    final notes = _notesController.text.trim();
    try {
      await ref.read(campaignRepositoryProvider).create(
            Campaign(
              id: '',
              brandId: widget.brandId,
              name: _nameController.text.trim(),
              notes: notes.isEmpty ? null : notes,
              startDate: _startDate,
              liveDate: _liveDate,
              createdAt: now,
              updatedAt: now,
            ),
          );
      ref.bumpData(const {DataDomain.campaigns});
      if (mounted) Navigator.of(context).pop(true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

/// A label, the current date (or [notSetLabel]), a tap to pick one and, once
/// set, a clear button — the same shape as `DeliverablesSection`'s
/// `_DateField`, duplicated here rather than shared since each of this
/// file's callers is meant to stay self-contained.
class _DatePickerField extends StatelessWidget {
  const _DatePickerField({
    required this.label,
    required this.value,
    required this.formatted,
    required this.notSetLabel,
    required this.onChanged,
  });

  final String label;
  final DateTime? value;
  final String? formatted;
  final String notSetLabel;
  final ValueChanged<DateTime?> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        SizedBox(
          width: 90,
          child: Text(label, style: Theme.of(context).textTheme.labelMedium),
        ),
        Expanded(
          child: InkWell(
            onTap: () async {
              final now = DateTime.now();
              final picked = await showDatePicker(
                context: context,
                initialDate: value ?? now,
                firstDate: DateTime(now.year - 2),
                lastDate: DateTime(now.year + 3),
              );
              if (picked != null) onChanged(picked);
            },
            child: Row(
              children: [
                Text(formatted ?? notSetLabel),
                const SizedBox(width: 4),
                const Icon(Icons.edit_calendar_outlined, size: 16),
              ],
            ),
          ),
        ),
        if (value != null)
          IconButton(
            icon: const Icon(Icons.close, size: 14),
            visualDensity: VisualDensity.compact,
            onPressed: () => onChanged(null),
          ),
      ],
    );
  }
}
