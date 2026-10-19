import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/data/models/campaign_shortlist_entry.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/media_kit.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/campaigns/application/campaign_providers.dart';
import 'package:gratovo_toolbox/features/campaigns/application/campaign_shortlist_controller.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/start_deal_dialog.dart';
import 'package:gratovo_toolbox/features/outreach/application/comms_queue_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// A campaign's shortlist — channels under consideration before any of them
/// becomes a [Deal] (see [CampaignShortlistEntry]'s doc comment). Add a
/// channel by id with an optional why-fit note, list what's already there
/// with its frozen price snapshot if one was captured at add time, remove
/// one with confirmation.
class CampaignShortlistSection extends ConsumerWidget {
  const CampaignShortlistSection({super.key, required this.campaignId});

  final String campaignId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final entriesAsync = ref.watch(campaignShortlistProvider(campaignId));

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
                    l10n.campaignShortlistTitle,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                TextButton.icon(
                  onPressed: () => _addEntry(context, ref, l10n),
                  icon: const Icon(Icons.add),
                  label: Text(l10n.campaignShortlistAddButton),
                ),
              ],
            ),
            Text(
              l10n.campaignShortlistSubtitle,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            entriesAsync.when(
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
                        ref.invalidate(campaignShortlistProvider(campaignId)),
                    child: Text(l10n.commonRetry),
                  ),
                ],
              ),
              data: (entries) {
                if (entries.isEmpty) {
                  return Text(l10n.campaignShortlistEmpty);
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _DraftPitchButton(campaignId: campaignId),
                    const SizedBox(height: 8),
                    for (var i = 0; i < entries.length; i++) ...[
                      if (i > 0) const Divider(height: 20),
                      _ShortlistRow(entry: entries[i]),
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

  Future<void> _addEntry(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
  ) async {
    final added = await showDialog<bool>(
      context: context,
      builder: (_) => _AddShortlistEntryDialog(campaignId: campaignId),
    );
    if ((added ?? false) && context.mounted) {
      AppToast.success(context, l10n.campaignShortlistAddedToast);
    }
  }
}

/// Starts a brand pitch from this shortlist (final review I5): creators
/// ready to pitch only (BRD-PRES-15; the others are named and left out), to
/// the brand's primary contact. The draft waits in the Comms queue like any
/// other — nothing is sent from here.
class _DraftPitchButton extends ConsumerStatefulWidget {
  const _DraftPitchButton({required this.campaignId});

  final String campaignId;

  @override
  ConsumerState<_DraftPitchButton> createState() => _DraftPitchButtonState();
}

class _DraftPitchButtonState extends ConsumerState<_DraftPitchButton> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return FilledButton.tonalIcon(
      onPressed: _busy ? null : _draft,
      icon: _busy
          ? const SizedBox.square(
              dimension: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.campaign_outlined),
      label: Text(_busy ? l10n.campaignPitchDrafting : l10n.campaignDraftPitch),
    );
  }

  Future<void> _draft() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context);
    final campaign =
        await ref.read(campaignRepositoryProvider).getById(widget.campaignId);
    final brand = campaign == null
        ? null
        : await ref.read(brandRepositoryProvider).getById(campaign.brandId);
    final email = brand?.primaryContact?.email.trim() ?? '';
    if (!mounted) return;
    if (brand == null || email.isEmpty) {
      AppToast.error(context, l10n.campaignPitchNoContact);
      return;
    }
    final entries =
        await ref.read(campaignShortlistProvider(widget.campaignId).future);
    final influencers = ref.read(influencerRepositoryProvider);
    final creators = <Influencer>[
      for (final entry in entries)
        if (await influencers.getById(entry.channelId) case final creator?)
          creator,
    ];
    final ready = [
      for (final c in creators)
        if (PitchReadiness.of(c).ready) c,
    ];
    final leftOut = [
      for (final c in creators)
        if (!PitchReadiness.of(c).ready) c.handle,
    ];
    if (!mounted) return;
    if (ready.isEmpty) {
      AppToast.warning(context, l10n.campaignPitchNobodyReady);
      return;
    }
    if (leftOut.isNotEmpty) {
      final go = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(l10n.campaignPitchLeftOutTitle),
          content: Text(l10n.campaignPitchLeftOut(leftOut.join(', '))),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: Text(l10n.commonCancel),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: Text(l10n.campaignPitchConfirm),
            ),
          ],
        ),
      );
      if (!(go ?? false) || !mounted) return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(commsQueueProvider.notifier).draftBrandPitch(
        brandId: brand.id,
        contactEmail: email,
        channelIds: [for (final c in ready) c.id],
      );
      if (mounted) AppToast.success(context, l10n.campaignPitchDrafted);
    } on Object catch (error) {
      if (mounted) AppToast.error(context, l10n.commsDraftFailed('$error'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class _ShortlistRow extends ConsumerWidget {
  const _ShortlistRow({required this.entry});

  final CampaignShortlistEntry entry;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final snapshot = entry.priceBasisSnapshot;
    final creator = ref.watch(influencerByIdProvider(entry.channelId)).value;
    // BRD-PRES-15: only a ready creator goes into the brand's pitch.
    final ready = creator == null ? null : PitchReadiness.of(creator).ready;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                creator?.handle ?? entry.channelId,
                style: theme.textTheme.bodyLarge,
              ),
              if (ready != null)
                Row(
                  children: [
                    ExcludeSemantics(
                      child: Icon(
                        ready
                            ? Icons.verified_outlined
                            : Icons.pending_outlined,
                        size: 16,
                        color: ready
                            ? theme.colorScheme.primary
                            : theme.colorScheme.error,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        ready ? l10n.mediaKitReady : l10n.mediaKitNotReady,
                        style: theme.textTheme.bodySmall,
                      ),
                    ),
                  ],
                ),
              if (entry.whyFit != null) ...[
                const SizedBox(height: 2),
                Text(
                  entry.whyFit!,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
              if (snapshot != null) ...[
                const SizedBox(height: 2),
                Text(
                  _formatSnapshot(snapshot, l10n),
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
              ],
            ],
          ),
        ),
        IconButton(
          tooltip: l10n.dealStart,
          icon: const Icon(Icons.handshake_outlined),
          onPressed: () => _startDeal(context, ref),
        ),
        IconButton(
          tooltip: l10n.campaignShortlistRemoveTooltip,
          icon: const Icon(Icons.delete_outline),
          onPressed: () => _confirmRemove(context, ref, l10n),
        ),
      ],
    );
  }

  /// Start deal from this row: the creator, the campaign's brand and the
  /// campaign itself are all known here.
  Future<void> _startDeal(BuildContext context, WidgetRef ref) async {
    final creator =
        await ref.read(influencerRepositoryProvider).getById(entry.channelId);
    final campaign =
        await ref.read(campaignRepositoryProvider).getById(entry.campaignId);
    if (creator == null || !context.mounted) return;
    await showStartDealDialog(
      context,
      creator: creator,
      brandId: campaign?.brandId,
      campaignId: entry.campaignId,
    );
  }

  String _formatSnapshot(Map<String, dynamic> snapshot, AppLocalizations l10n) {
    final brandPrice = (snapshot['brandPrice'] as num?)?.toDouble();
    final influencerPayout = (snapshot['influencerPayout'] as num?)?.toDouble();
    final medianViews = (snapshot['medianViewsAtDeal'] as num?)?.toInt();

    final parts = <String>[
      if (brandPrice != null)
        l10n.campaignShortlistSnapshotBrandPrice(
          formatCurrency(brandPrice, locale: l10n.localeName),
        ),
      if (influencerPayout != null)
        l10n.campaignShortlistSnapshotInfluencerPayout(
          formatCurrency(influencerPayout, locale: l10n.localeName),
        ),
      if (medianViews != null)
        l10n.campaignShortlistSnapshotMedianViews(formatCount(medianViews)),
    ];
    return parts.join(' · ');
  }

  Future<void> _confirmRemove(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.campaignShortlistRemoveConfirmTitle),
        content: Text(l10n.campaignShortlistRemoveConfirmBody),
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
    await ref.read(campaignShortlistControllerProvider).remove(entry.id);
    if (context.mounted) {
      AppToast.success(context, l10n.campaignShortlistRemovedToast);
    }
  }
}

class _AddShortlistEntryDialog extends ConsumerStatefulWidget {
  const _AddShortlistEntryDialog({required this.campaignId});

  final String campaignId;

  @override
  ConsumerState<_AddShortlistEntryDialog> createState() =>
      _AddShortlistEntryDialogState();
}

class _AddShortlistEntryDialogState
    extends ConsumerState<_AddShortlistEntryDialog> {
  final _formKey = GlobalKey<FormState>();
  final _channelIdController = TextEditingController();
  final _whyFitController = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _channelIdController.dispose();
    _whyFitController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(l10n.campaignShortlistAddDialogTitle),
      content: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextFormField(
                controller: _channelIdController,
                autofocus: true,
                decoration: InputDecoration(
                  labelText: l10n.campaignShortlistChannelIdLabel,
                  hintText: l10n.campaignShortlistChannelIdHint,
                ),
                validator: (value) => (value == null || value.trim().isEmpty)
                    ? l10n.campaignShortlistChannelIdRequired
                    : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _whyFitController,
                maxLines: 3,
                decoration: InputDecoration(
                  labelText: l10n.campaignShortlistWhyFitLabel,
                  hintText: l10n.campaignShortlistWhyFitHint,
                ),
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
    try {
      await ref.read(campaignShortlistControllerProvider).add(
            campaignId: widget.campaignId,
            channelId: _channelIdController.text.trim(),
            whyFit: _whyFitController.text.trim(),
          );
      if (mounted) Navigator.of(context).pop(true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}
