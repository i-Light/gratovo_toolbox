import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/logging/activity_logger.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/models/activity_log_query.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// A deal's two contracts in the course's order (decision contract-order):
/// the brand's contract is the template; the creator signs first, the brand
/// after. Each side has its link, where it stands, and when it was signed.
class DealContractsCard extends ConsumerWidget {
  const DealContractsCard({super.key, required this.deal});

  final Deal deal;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 8,
          children: [
            Text(l10n.dealContractsTitle, style: theme.textTheme.titleMedium),
            Text(
              l10n.dealContractOrderNote,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            _ContractRow(
              deal: deal,
              party: ContractParty.creator,
              contract: deal.creatorContract,
            ),
            _ContractRow(
              deal: deal,
              party: ContractParty.brand,
              contract: deal.brandContract,
            ),
            // The single link deals had before there were two contracts.
            if (deal.contractUrl != null)
              SelectableText('${l10n.dealDetailContractTitle}: '
                  '${deal.contractUrl}'),
          ],
        ),
      ),
    );
  }
}

String contractStatusLabel(AppLocalizations l10n, ContractStatus status) =>
    switch (status) {
      ContractStatus.none => l10n.contractStatusNone,
      ContractStatus.draft => l10n.contractStatusDraft,
      ContractStatus.sent => l10n.contractStatusSent,
      ContractStatus.signed => l10n.contractStatusSigned,
    };

class _ContractRow extends ConsumerWidget {
  const _ContractRow({
    required this.deal,
    required this.party,
    required this.contract,
  });

  final Deal deal;
  final ContractParty party;
  final DealContract contract;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final signed = contract.status == ContractStatus.signed;
    final signedAt = contract.signedAt;
    final waiting =
        party == ContractParty.brand && !signed && !canMarkBrandSigned(deal);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ExcludeSemantics(
          child: Icon(
            signed ? Icons.task_alt : Icons.description_outlined,
            color: signed ? theme.colorScheme.primary : null,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                party == ContractParty.creator
                    ? l10n.dealContractCreator
                    : l10n.dealContractBrand,
                style: theme.textTheme.titleSmall,
              ),
              Text(signed && signedAt != null
                  ? l10n.dealContractSignedOn(fmt.date(signedAt))
                  : contractStatusLabel(l10n, contract.status)),
              if (contract.url != null)
                Text(contract.url!, style: theme.textTheme.bodySmall),
              if (waiting)
                Text(l10n.dealContractBrandWaits,
                    style: theme.textTheme.bodySmall),
            ],
          ),
        ),
        if (contract.url != null)
          IconButton(
            tooltip: l10n.dealDetailCopyContractLink,
            icon: const Icon(Icons.copy),
            onPressed: () =>
                Clipboard.setData(ClipboardData(text: contract.url!)),
          ),
        TextButton(
          key: ValueKey('contract-${party.name}-update'),
          onPressed: () => _update(context, ref),
          child: Text(l10n.dealContractUpdate),
        ),
      ],
    );
  }

  Future<void> _update(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    final next = await showDialog<DealContract>(
      context: context,
      builder: (context) => _ContractDialog(
        contract: contract,
        canSign: party == ContractParty.creator || canMarkBrandSigned(deal),
      ),
    );
    if (next == null || !context.mounted) return;
    try {
      await ref
          .read(dealRepositoryProvider)
          .updateContract(deal.id, party, next);
      ref.bumpData(const {DataDomain.deals});
      try {
        ref.read(activityLoggerProvider).record(ActivityDraft(
              action: ActivityAction.updated,
              entityType: 'deal',
              entityId: deal.id,
              entityLabel: deal.id,
              field: '${party.name}_contract',
              oldValue: contract.status.name,
              newValue: next.status.name,
            ));
      } on Object catch (_) {
        // Best-effort: the contract is saved either way.
      }
      if (context.mounted) AppToast.success(context, l10n.dealContractSaved);
    } on Exception catch (error) {
      if (context.mounted) AppToast.error(context, '$error');
    }
  }
}

class _ContractDialog extends StatefulWidget {
  const _ContractDialog({required this.contract, required this.canSign});

  final DealContract contract;

  /// False for the brand's contract while the creator has not signed.
  final bool canSign;

  @override
  State<_ContractDialog> createState() => _ContractDialogState();
}

class _ContractDialogState extends State<_ContractDialog> {
  late final _url = TextEditingController(text: widget.contract.url ?? '');
  late ContractStatus _status = widget.contract.status;

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(l10n.dealContractUpdate),
      content: SizedBox(
        width: 460,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: 12,
          children: [
            TextField(
              key: const ValueKey('contract-url'),
              controller: _url,
              keyboardType: TextInputType.url,
              decoration: InputDecoration(
                labelText: l10n.dealContractUrl,
                border: const OutlineInputBorder(),
                isDense: true,
              ),
            ),
            DropdownButtonFormField<ContractStatus>(
              key: const ValueKey('contract-status'),
              initialValue: _status,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: l10n.dealContractStatus,
                border: const OutlineInputBorder(),
                isDense: true,
                helperText: widget.canSign ? null : l10n.dealContractBrandWaits,
                helperMaxLines: 2,
              ),
              items: [
                for (final status in ContractStatus.values)
                  DropdownMenuItem(
                    value: status,
                    enabled: status != ContractStatus.signed || widget.canSign,
                    child: Text(contractStatusLabel(l10n, status)),
                  ),
              ],
              onChanged: (value) => setState(() => _status = value ?? _status),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
        FilledButton(
          onPressed: () {
            final url = _url.text.trim();
            final signed = _status == ContractStatus.signed;
            Navigator.of(context).pop(DealContract(
              url: url.isEmpty ? null : url,
              status: _status,
              signedAt: signed
                  ? (widget.contract.signedAt ?? DateTime.now().toUtc())
                  : null,
            ));
          },
          child: Text(l10n.commonSave),
        ),
      ],
    );
  }
}
