import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Which of [Deal]'s four manual payment timestamps a row/action targets.
enum _PaymentDateField {
  brandInvoiceSentAt,
  brandInvoicePaidAt,
  creatorPayoutDueAt,
  creatorPayoutPaidAt,
}

/// The broker's manual payment ledger for one deal — currency, the
/// brand-invoice and creator-payout timestamp pairs, payment method and
/// reference, plus [Deal.margin] shown prominently since that's the
/// broker's actual take. See `deal.dart`'s doc comments on the payment
/// fields for the "Path A" design this follows (nobody's bank feed is wired
/// up; every timestamp here is set by a person who checked), and
/// `DealRepository.updatePayment`'s doc comment for why every write below
/// sends the full field set rather than just the one value that changed.
///
/// Self-contained by design so the other wave-2 agents editing
/// `deal_detail_screen.dart` in parallel never touch this file — see that
/// screen's single `// Payment tracking` insertion point.
class PaymentSection extends ConsumerStatefulWidget {
  const PaymentSection({super.key, required this.deal});

  final Deal deal;

  @override
  ConsumerState<PaymentSection> createState() => _PaymentSectionState();
}

class _PaymentSectionState extends ConsumerState<PaymentSection> {
  late final TextEditingController _currencyController =
      TextEditingController(text: widget.deal.currency);
  late final TextEditingController _methodController =
      TextEditingController(text: widget.deal.paymentMethod ?? '');
  late final TextEditingController _referenceController =
      TextEditingController(text: widget.deal.paymentReference ?? '');

  @override
  void didUpdateWidget(covariant PaymentSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Same "don't clobber a mid-edit" rule as `working_days_estimate_card.dart`:
    // only pull a field's freshly-fetched value in when it wasn't already
    // diverged from what this widget last showed.
    _syncController(
      _currencyController,
      oldWidget.deal.currency,
      widget.deal.currency,
    );
    _syncController(
      _methodController,
      oldWidget.deal.paymentMethod ?? '',
      widget.deal.paymentMethod ?? '',
    );
    _syncController(
      _referenceController,
      oldWidget.deal.paymentReference ?? '',
      widget.deal.paymentReference ?? '',
    );
  }

  void _syncController(
    TextEditingController controller,
    String oldStored,
    String newStored,
  ) {
    if (oldStored != newStored && controller.text == oldStored) {
      controller.text = newStored;
    }
  }

  @override
  void dispose() {
    _currencyController.dispose();
    _methodController.dispose();
    _referenceController.dispose();
    super.dispose();
  }

  /// Sends the full payment field set, per `updatePayment`'s contract:
  /// every field not explicitly overridden here keeps [widget.deal]'s
  /// current (persisted) value, never a stale or half-typed draft.
  Future<void> _save({
    String? currency,
    DateTime? Function()? brandInvoiceSentAt,
    DateTime? Function()? brandInvoicePaidAt,
    DateTime? Function()? creatorPayoutDueAt,
    DateTime? Function()? creatorPayoutPaidAt,
    String? Function()? paymentMethod,
    String? Function()? paymentReference,
  }) async {
    final deal = widget.deal;
    await ref.read(dealRepositoryProvider).updatePayment(
          deal.id,
          currency: currency ?? deal.currency,
          brandInvoiceSentAt: brandInvoiceSentAt != null
              ? brandInvoiceSentAt()
              : deal.brandInvoiceSentAt,
          brandInvoicePaidAt: brandInvoicePaidAt != null
              ? brandInvoicePaidAt()
              : deal.brandInvoicePaidAt,
          creatorPayoutDueAt: creatorPayoutDueAt != null
              ? creatorPayoutDueAt()
              : deal.creatorPayoutDueAt,
          creatorPayoutPaidAt: creatorPayoutPaidAt != null
              ? creatorPayoutPaidAt()
              : deal.creatorPayoutPaidAt,
          paymentMethod:
              paymentMethod != null ? paymentMethod() : deal.paymentMethod,
          paymentReference: paymentReference != null
              ? paymentReference()
              : deal.paymentReference,
        );
    ref.bumpData(const {DataDomain.deals});
  }

  Future<void> _saveDetails() async {
    final currency = _currencyController.text.trim();
    final method = _methodController.text.trim();
    final reference = _referenceController.text.trim();
    await _save(
      currency:
          currency.isEmpty ? widget.deal.currency : currency.toUpperCase(),
      paymentMethod: () => method.isEmpty ? null : method,
      paymentReference: () => reference.isEmpty ? null : reference,
    );
    if (mounted) {
      final l10n = AppLocalizations.of(context);
      AppToast.success(context, l10n.paymentDetailsSaved);
    }
  }

  Future<void> _setDate(_PaymentDateField field, DateTime? value) async {
    await switch (field) {
      _PaymentDateField.brandInvoiceSentAt =>
        _save(brandInvoiceSentAt: () => value),
      _PaymentDateField.brandInvoicePaidAt =>
        _save(brandInvoicePaidAt: () => value),
      _PaymentDateField.creatorPayoutDueAt =>
        _save(creatorPayoutDueAt: () => value),
      _PaymentDateField.creatorPayoutPaidAt =>
        _save(creatorPayoutPaidAt: () => value),
    };
    if (mounted) {
      final l10n = AppLocalizations.of(context);
      AppToast.success(context, l10n.paymentDateSaved);
    }
  }

  Future<DateTime?> _pickDate(DateTime? initial) {
    final now = DateTime.now();
    return showDatePicker(
      context: context,
      initialDate: initial ?? now,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 5),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final deal = widget.deal;

    String? fmtDate(DateTime? value) => value == null ? null : fmt.date(value);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.paymentSectionTitle, style: theme.textTheme.titleMedium),
            const SizedBox(height: 12),
            // The broker's actual take on this deal — shown here too, not
            // only in the Pricing card above, since this is the section
            // someone opens specifically to answer "did we make money on
            // this."
            Row(
              children: [
                Text(l10n.paymentMarginLabel,
                    style: theme.textTheme.bodyMedium),
                const SizedBox(width: 8),
                Text(
                  formatCurrency(deal.margin, locale: l10n.localeName),
                  style: theme.textTheme.headlineSmall?.copyWith(
                    color: theme.colorScheme.primary,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 110,
                  child: TextField(
                    controller: _currencyController,
                    textCapitalization: TextCapitalization.characters,
                    decoration: InputDecoration(
                      labelText: l10n.paymentCurrencyLabel,
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                    controller: _methodController,
                    decoration: InputDecoration(
                      labelText: l10n.paymentMethodLabel,
                      hintText: l10n.paymentMethodHint,
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _referenceController,
              decoration: InputDecoration(
                labelText: l10n.paymentReferenceLabel,
                hintText: l10n.paymentReferenceHint,
                border: const OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton(
                onPressed: _saveDetails,
                child: Text(l10n.commonSave),
              ),
            ),
            const Divider(height: 32),
            _DateRow(
              label: l10n.paymentInvoiceSentLabel,
              formattedValue: fmtDate(deal.brandInvoiceSentAt),
              notSetLabel: l10n.paymentNotSet,
              quickActionLabel: l10n.paymentMarkSentNow,
              pickTooltip: l10n.paymentPickDateTooltip,
              clearTooltip: l10n.paymentClearDateTooltip,
              onQuickAction: () => _setDate(
                _PaymentDateField.brandInvoiceSentAt,
                DateTime.now(),
              ),
              onPick: () async {
                final picked = await _pickDate(deal.brandInvoiceSentAt);
                if (picked != null) {
                  await _setDate(_PaymentDateField.brandInvoiceSentAt, picked);
                }
              },
              onClear: deal.brandInvoiceSentAt == null
                  ? null
                  : () => _setDate(_PaymentDateField.brandInvoiceSentAt, null),
            ),
            _DateRow(
              label: l10n.paymentInvoicePaidLabel,
              formattedValue: fmtDate(deal.brandInvoicePaidAt),
              notSetLabel: l10n.paymentNotSet,
              quickActionLabel: l10n.paymentMarkPaidNow,
              pickTooltip: l10n.paymentPickDateTooltip,
              clearTooltip: l10n.paymentClearDateTooltip,
              onQuickAction: () => _setDate(
                _PaymentDateField.brandInvoicePaidAt,
                DateTime.now(),
              ),
              onPick: () async {
                final picked = await _pickDate(deal.brandInvoicePaidAt);
                if (picked != null) {
                  await _setDate(_PaymentDateField.brandInvoicePaidAt, picked);
                }
              },
              onClear: deal.brandInvoicePaidAt == null
                  ? null
                  : () => _setDate(_PaymentDateField.brandInvoicePaidAt, null),
            ),
            _DateRow(
              label: l10n.paymentPayoutDueLabel,
              formattedValue: fmtDate(deal.creatorPayoutDueAt),
              notSetLabel: l10n.paymentNotSet,
              quickActionLabel: l10n.paymentMarkDueToday,
              pickTooltip: l10n.paymentPickDateTooltip,
              clearTooltip: l10n.paymentClearDateTooltip,
              onQuickAction: () => _setDate(
                _PaymentDateField.creatorPayoutDueAt,
                DateTime.now(),
              ),
              onPick: () async {
                final picked = await _pickDate(deal.creatorPayoutDueAt);
                if (picked != null) {
                  await _setDate(_PaymentDateField.creatorPayoutDueAt, picked);
                }
              },
              onClear: deal.creatorPayoutDueAt == null
                  ? null
                  : () => _setDate(_PaymentDateField.creatorPayoutDueAt, null),
            ),
            _DateRow(
              label: l10n.paymentPayoutPaidLabel,
              formattedValue: fmtDate(deal.creatorPayoutPaidAt),
              notSetLabel: l10n.paymentNotSet,
              quickActionLabel: l10n.paymentMarkPaidNow,
              pickTooltip: l10n.paymentPickDateTooltip,
              clearTooltip: l10n.paymentClearDateTooltip,
              onQuickAction: () => _setDate(
                _PaymentDateField.creatorPayoutPaidAt,
                DateTime.now(),
              ),
              onPick: () async {
                final picked = await _pickDate(deal.creatorPayoutPaidAt);
                if (picked != null) {
                  await _setDate(_PaymentDateField.creatorPayoutPaidAt, picked);
                }
              },
              onClear: deal.creatorPayoutPaidAt == null
                  ? null
                  : () => _setDate(_PaymentDateField.creatorPayoutPaidAt, null),
            ),
          ],
        ),
      ),
    );
  }
}

/// One editable date row: label, current value (or a placeholder), a quick
/// "mark it now" action, a date-picker button for a specific date, and a
/// clear button when a value is already set.
class _DateRow extends StatelessWidget {
  const _DateRow({
    required this.label,
    required this.formattedValue,
    required this.notSetLabel,
    required this.quickActionLabel,
    required this.pickTooltip,
    required this.clearTooltip,
    required this.onQuickAction,
    required this.onPick,
    this.onClear,
  });

  final String label;
  final String? formattedValue;
  final String notSetLabel;
  final String quickActionLabel;
  final String pickTooltip;
  final String clearTooltip;
  final VoidCallback onQuickAction;
  final VoidCallback onPick;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 8,
        runSpacing: 4,
        children: [
          SizedBox(
            width: 100,
            child: Text(label, style: theme.textTheme.bodyMedium),
          ),
          Text(
            formattedValue ?? notSetLabel,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: formattedValue == null
                  ? theme.colorScheme.onSurfaceVariant
                  : null,
            ),
          ),
          TextButton(onPressed: onQuickAction, child: Text(quickActionLabel)),
          IconButton(
            tooltip: pickTooltip,
            icon: const Icon(Icons.calendar_today_outlined, size: 18),
            onPressed: onPick,
            visualDensity: VisualDensity.compact,
          ),
          if (onClear != null)
            IconButton(
              tooltip: clearTooltip,
              icon: const Icon(Icons.close, size: 18),
              onPressed: onClear,
              visualDensity: VisualDensity.compact,
            ),
        ],
      ),
    );
  }
}
