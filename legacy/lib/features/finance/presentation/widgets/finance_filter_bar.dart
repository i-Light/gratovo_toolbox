import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/features/finance/application/finance_filter_controller.dart';
import 'package:gratovo_toolbox/features/finance/application/finance_models.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Which slice of the ledger is on screen — same `ChoiceChip` row shape as
/// `deal_list_screen.dart`'s `_StageFilterBar`, backed by
/// [financeFilterProvider] instead of `dealFilterProvider`.
class FinanceFilterBar extends ConsumerWidget {
  const FinanceFilterBar({required this.selected, super.key});

  final FinanceFilter selected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final notifier = ref.read(financeFilterProvider.notifier);

    String labelFor(FinanceFilter filter) => switch (filter) {
          FinanceFilter.all => l10n.financeFilterAll,
          FinanceFilter.invoiceUnpaid => l10n.financeFilterInvoiceUnpaid,
          FinanceFilter.invoiceOverdue => l10n.financeFilterInvoiceOverdue,
          FinanceFilter.payoutDue => l10n.financeFilterPayoutDue,
          FinanceFilter.payoutOverdue => l10n.financeFilterPayoutOverdue,
          FinanceFilter.settled => l10n.financeFilterSettled,
        };

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          for (final filter in FinanceFilter.values)
            ChoiceChip(
              label: Text(labelFor(filter)),
              selected: selected == filter,
              onSelected: (_) => notifier.setFilter(filter),
            ),
        ],
      ),
    );
  }
}
