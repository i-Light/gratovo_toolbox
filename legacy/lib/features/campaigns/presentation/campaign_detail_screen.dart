import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/widgets/notes_card.dart';
import 'package:gratovo_toolbox/core/widgets/status_badge.dart';
import 'package:gratovo_toolbox/data/models/campaign.dart';
import 'package:gratovo_toolbox/features/campaigns/application/campaign_detail_controller.dart';
import 'package:gratovo_toolbox/features/campaigns/application/campaign_providers.dart';
import 'package:gratovo_toolbox/features/campaigns/presentation/widgets/campaign_shortlist_section.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// One [Campaign]'s detail: name, status, the two optional dates, notes, and
/// its shortlist — the organizing label a brand's deals share, edited here
/// and deleted here. Reached from the brand profile's Campaigns section, and
/// nested under `/brands/:id` the same way `/deals/:id` nests under `/deals`
/// (see `campaign_routes.dart`).
class CampaignDetailScreen extends ConsumerWidget {
  const CampaignDetailScreen({super.key, required this.campaignId});

  final String campaignId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final campaignAsync = ref.watch(campaignByIdProvider(campaignId));

    return Scaffold(
      appBar: GradientAppBar(
        title: campaignAsync.maybeWhen(
          data: (campaign) =>
              GradientText(campaign?.name ?? l10n.campaignDetailTitle),
          orElse: () => GradientText(l10n.campaignDetailTitle),
        ),
        actions: [
          campaignAsync.maybeWhen(
            data: (campaign) => campaign == null
                ? const SizedBox.shrink()
                : IconButton(
                    tooltip: l10n.campaignDeleteTooltip,
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () =>
                        _confirmDelete(context, ref, campaign, l10n),
                  ),
            orElse: () => const SizedBox.shrink(),
          ),
        ],
      ),
      body: campaignAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(l10n.commonError),
              TextButton(
                onPressed: () =>
                    ref.invalidate(campaignByIdProvider(campaignId)),
                child: Text(l10n.commonRetry),
              ),
            ],
          ),
        ),
        data: (campaign) {
          if (campaign == null) {
            return Center(child: Text(l10n.campaignNotFound));
          }
          return SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _CampaignDetailsCard(campaign: campaign),
                const SizedBox(height: 16),
                NotesCard(
                  initialText: campaign.notes,
                  hintText: l10n.campaignNotesHint,
                  onSave: (text) async {
                    await ref
                        .read(campaignDetailControllerProvider)
                        .updateNotes(campaign, text);
                    if (context.mounted) {
                      AppToast.success(context, l10n.campaignNotesSaved);
                    }
                  },
                ),
                const SizedBox(height: 16),
                CampaignShortlistSection(campaignId: campaign.id),
              ],
            ),
          );
        },
      ),
    );
  }

  Future<void> _confirmDelete(
    BuildContext context,
    WidgetRef ref,
    Campaign campaign,
    AppLocalizations l10n,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.campaignDeleteConfirmTitle),
        content: Text(l10n.campaignDeleteConfirmBody),
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
    await ref.read(campaignDetailControllerProvider).delete(campaign.id);
    if (context.mounted) {
      AppToast.success(context, l10n.campaignDeletedToast);
      context.go(AppRoutes.brandDetail(campaign.brandId));
    }
  }
}

class _CampaignDetailsCard extends ConsumerStatefulWidget {
  const _CampaignDetailsCard({required this.campaign});

  final Campaign campaign;

  @override
  ConsumerState<_CampaignDetailsCard> createState() =>
      _CampaignDetailsCardState();
}

class _CampaignDetailsCardState extends ConsumerState<_CampaignDetailsCard> {
  late final TextEditingController _nameController =
      TextEditingController(text: widget.campaign.name);

  @override
  void didUpdateWidget(covariant _CampaignDetailsCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Don't clobber a mid-edit: only pull in a freshly-fetched name when it
    // wasn't already diverged from what this widget last showed — same rule
    // `PaymentSection`/`DeliverablesSection` follow.
    if (oldWidget.campaign.name != widget.campaign.name &&
        _nameController.text == oldWidget.campaign.name) {
      _nameController.text = widget.campaign.name;
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  CampaignDetailController get _controller =>
      ref.read(campaignDetailControllerProvider);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final campaign = widget.campaign;

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
                  child: TextField(
                    controller: _nameController,
                    decoration: InputDecoration(
                      labelText: l10n.campaignNameLabel,
                      isDense: true,
                      border: const OutlineInputBorder(),
                    ),
                    onSubmitted: (_) => _saveName(),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: const Icon(Icons.check),
                  tooltip: l10n.commonSave,
                  onPressed: _saveName,
                ),
                const SizedBox(width: 8),
                DropdownButton<CampaignStatus>(
                  value: campaign.status,
                  underline: const SizedBox.shrink(),
                  items: [
                    for (final status in CampaignStatus.values)
                      DropdownMenuItem(
                        value: status,
                        child: StatusBadge(
                          label: status.label(l10n),
                          color: status.color(context),
                        ),
                      ),
                  ],
                  onChanged: (status) {
                    if (status == null || status == campaign.status) return;
                    _controller.updateStatus(campaign, status);
                  },
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 24,
              runSpacing: 8,
              children: [
                _DateField(
                  label: l10n.campaignStartDateLabel,
                  value: campaign.startDate,
                  formatted: campaign.startDate != null
                      ? fmt.date(campaign.startDate!)
                      : l10n.campaignDateNotSet,
                  onPick: (value) => _controller.setStartDate(
                    campaign,
                    value,
                  ),
                ),
                _DateField(
                  label: l10n.campaignLiveDateLabel,
                  value: campaign.liveDate,
                  formatted: campaign.liveDate != null
                      ? fmt.date(campaign.liveDate!)
                      : l10n.campaignDateNotSet,
                  onPick: (value) => _controller.setLiveDate(
                    campaign,
                    value,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  void _saveName() {
    final name = _nameController.text.trim();
    if (name.isEmpty || name == widget.campaign.name) return;
    _controller.updateName(widget.campaign, name);
  }
}

/// One of the two optional dates: the label, the current value (or a
/// placeholder), a tap to pick a new one and, once set, a clear button. Same
/// shape as `DeliverablesSection`'s private `_DateField`.
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
