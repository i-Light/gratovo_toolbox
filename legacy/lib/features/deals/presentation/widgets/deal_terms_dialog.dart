import 'package:flutter/material.dart';
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

/// The text boxes and pickers behind a deal's terms, shared by Start deal
/// and Edit terms.
class DealTermsControllers {
  DealTermsControllers([Deal? deal])
      : price = TextEditingController(
            text: deal == null ? '' : _plain(deal.brandPrice)),
        payout = TextEditingController(
            text: deal == null ? '' : _plain(deal.influencerPayout)),
        deliverables = TextEditingController(text: deal?.deliverables ?? ''),
        paymentTerms = TextEditingController(text: deal?.paymentTerms ?? ''),
        trackingLink = TextEditingController(text: deal?.trackingLink ?? ''),
        currency = deal?.currency ?? 'USD',
        deadline = deal?.deadline;

  final TextEditingController price;
  final TextEditingController payout;
  final TextEditingController deliverables;
  final TextEditingController paymentTerms;
  final TextEditingController trackingLink;
  String currency;
  DateTime? deadline;

  static String _plain(double value) =>
      value == value.roundToDouble() ? '${value.round()}' : '$value';

  static String? _text(TextEditingController c) =>
      c.text.trim().isEmpty ? null : c.text.trim();

  /// The terms as typed; call after the form validated.
  DealTerms read() => DealTerms(
        brandPrice: double.parse(price.text.trim()),
        influencerPayout: double.parse(payout.text.trim()),
        currency: currency,
        deliverables: _text(deliverables),
        deadline: deadline,
        paymentTerms: _text(paymentTerms),
        trackingLink: _text(trackingLink),
      );

  void dispose() {
    price.dispose();
    payout.dispose();
    deliverables.dispose();
    paymentTerms.dispose();
    trackingLink.dispose();
  }
}

/// Price, payout, currency, deliverables, deadline, payment terms (no
/// default: decision payment-terms) and the tracking link.
class DealTermsFields extends ConsumerStatefulWidget {
  const DealTermsFields({super.key, required this.controllers});

  final DealTermsControllers controllers;

  @override
  ConsumerState<DealTermsFields> createState() => _DealTermsFieldsState();
}

class _DealTermsFieldsState extends ConsumerState<DealTermsFields> {
  static const _currencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'];

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final c = widget.controllers;
    InputDecoration field(String label, {String? hint}) => InputDecoration(
          labelText: label,
          hintText: hint,
          border: const OutlineInputBorder(),
          isDense: true,
        );
    String? amount(String? text) => double.tryParse((text ?? '').trim()) == null
        ? l10n.dealFormNumberRequired
        : null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: 12,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 8,
          children: [
            Expanded(
              child: TextFormField(
                key: const ValueKey('deal-price'),
                controller: c.price,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: field(l10n.dealFormBrandPrice),
                validator: amount,
              ),
            ),
            Expanded(
              child: TextFormField(
                key: const ValueKey('deal-payout'),
                controller: c.payout,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: field(l10n.dealFormPayout),
                validator: amount,
              ),
            ),
          ],
        ),
        DropdownButtonFormField<String>(
          initialValue: _currencies.contains(c.currency) ? c.currency : 'USD',
          isExpanded: true,
          decoration: field(l10n.dealFormCurrency),
          items: [
            for (final code in _currencies)
              DropdownMenuItem(value: code, child: Text(code)),
          ],
          onChanged: (value) =>
              setState(() => c.currency = value ?? c.currency),
        ),
        TextFormField(
          key: const ValueKey('deal-deliverables'),
          controller: c.deliverables,
          minLines: 1,
          maxLines: 4,
          decoration: field(l10n.dealFormDeliverables),
        ),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(l10n.dealFormDeadline,
                style: Theme.of(context).textTheme.labelLarge),
            OutlinedButton.icon(
              key: const ValueKey('deal-deadline'),
              onPressed: () async {
                final now = DateTime.now();
                final picked = await showDatePicker(
                  context: context,
                  initialDate: c.deadline ?? now,
                  firstDate: DateTime(now.year - 1),
                  lastDate: DateTime(now.year + 3),
                );
                if (picked != null && mounted) {
                  setState(() => c.deadline = picked);
                }
              },
              icon: const Icon(Icons.event),
              label: Text(c.deadline == null
                  ? l10n.dealFormPickDate
                  : fmt.date(c.deadline!)),
            ),
          ],
        ),
        TextFormField(
          key: const ValueKey('deal-payment-terms'),
          controller: c.paymentTerms,
          decoration: field(l10n.dealFormPaymentTerms,
              hint: l10n.dealFormPaymentTermsHint),
        ),
        TextFormField(
          key: const ValueKey('deal-tracking-link'),
          controller: c.trackingLink,
          keyboardType: TextInputType.url,
          decoration: field(l10n.dealFormTrackingLink),
        ),
      ],
    );
  }
}

/// Opens Edit terms for [deal] and saves the result as one unit, logged.
Future<void> showDealTermsDialog(BuildContext context, Deal deal) async {
  final terms = await showDialog<DealTerms>(
    context: context,
    builder: (context) => _DealTermsDialog(deal: deal),
  );
  if (terms == null || !context.mounted) return;
  final container = ProviderScope.containerOf(context, listen: false);
  final l10n = AppLocalizations.of(context);
  try {
    await container.read(dealRepositoryProvider).updateTerms(deal.id, terms);
    container.read(dataRevisionsProvider.notifier).bump({DataDomain.deals});
    final changed = [
      if (terms.brandPrice != deal.brandPrice) 'brand_price',
      if (terms.influencerPayout != deal.influencerPayout) 'influencer_payout',
      if (terms.currency != deal.currency) 'currency',
      if (terms.deliverables != deal.deliverables) 'deliverables',
      if (terms.deadline != deal.deadline) 'deadline',
      if (terms.paymentTerms != deal.paymentTerms) 'payment_terms',
      if (terms.trackingLink != deal.trackingLink) 'tracking_link',
    ];
    if (changed.isNotEmpty) {
      try {
        container.read(activityLoggerProvider).record(ActivityDraft(
              action: ActivityAction.updated,
              entityType: 'deal',
              entityId: deal.id,
              entityLabel: deal.id,
              field: changed.join(','),
              oldValue: '${deal.brandPrice}/${deal.influencerPayout}',
              newValue: '${terms.brandPrice}/${terms.influencerPayout}',
            ));
      } on Object catch (_) {
        // Best-effort: the terms are saved either way.
      }
    }
    if (context.mounted) AppToast.success(context, l10n.dealTermsSaved);
  } on Exception catch (error) {
    if (context.mounted) AppToast.error(context, '$error');
  }
}

class _DealTermsDialog extends StatefulWidget {
  const _DealTermsDialog({required this.deal});

  final Deal deal;

  @override
  State<_DealTermsDialog> createState() => _DealTermsDialogState();
}

class _DealTermsDialogState extends State<_DealTermsDialog> {
  final _formKey = GlobalKey<FormState>();
  late final _controllers = DealTermsControllers(widget.deal);

  @override
  void dispose() {
    _controllers.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(l10n.dealEditTerms),
      content: SizedBox(
        width: 520,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: DealTermsFields(controllers: _controllers),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
        FilledButton(
          onPressed: () {
            if (!(_formKey.currentState?.validate() ?? false)) return;
            Navigator.of(context).pop(_controllers.read());
          },
          child: Text(l10n.commonSave),
        ),
      ],
    );
  }
}
