import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/deals/application/working_days_suggestion_provider.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The manually-entered [Deal.workingDaysEstimate] — always visible, freely
/// editable, never written except by the user tapping Save or "use this" —
/// with the auto-computed suggestion from [workingDaysSuggestionProvider]
/// shown alongside it as an ASSIST, not a replacement. See
/// `working_days_suggestion.dart` for what the suggestion is based on and
/// why it can be a wider span than "first contact to signed".
class WorkingDaysEstimateCard extends ConsumerStatefulWidget {
  const WorkingDaysEstimateCard({super.key, required this.deal});

  final Deal deal;

  @override
  ConsumerState<WorkingDaysEstimateCard> createState() =>
      _WorkingDaysEstimateCardState();
}

class _WorkingDaysEstimateCardState
    extends ConsumerState<WorkingDaysEstimateCard> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.deal.workingDaysEstimate?.toString() ?? '',
  );

  @override
  void didUpdateWidget(covariant WorkingDaysEstimateCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    // A save (ours or another machine's, via sync) changes the deal under
    // us; keep the field in step unless the person is mid-edit with a
    // different value already typed.
    final stored = widget.deal.workingDaysEstimate?.toString() ?? '';
    if (oldWidget.deal.workingDaysEstimate != widget.deal.workingDaysEstimate &&
        _controller.text ==
            (oldWidget.deal.workingDaysEstimate?.toString() ?? '')) {
      _controller.text = stored;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save(int? value) async {
    await ref
        .read(dealRepositoryProvider)
        .updateWorkingDaysEstimate(widget.deal.id, value);
    ref.bumpData(const {DataDomain.deals});
    if (mounted) {
      final l10n = AppLocalizations.of(context);
      AppToast.success(context, l10n.workingDaysSuggestionApplied);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final suggestionAsync =
        ref.watch(workingDaysSuggestionProvider(widget.deal.id));

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.dealDetailWorkingDaysLabel,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                SizedBox(
                  width: 100,
                  child: TextField(
                    controller: _controller,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: InputDecoration(
                      hintText: l10n.workingDaysSuggestionFieldHint,
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                FilledButton(
                  onPressed: () {
                    final text = _controller.text.trim();
                    _save(text.isEmpty ? null : int.tryParse(text));
                  },
                  child: Text(l10n.commonSave),
                ),
              ],
            ),
            suggestionAsync.maybeWhen(
              data: (suggestion) {
                if (suggestion == null) return const SizedBox.shrink();
                return Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 8,
                    runSpacing: 4,
                    children: [
                      Icon(
                        Icons.auto_graph,
                        size: 18,
                        color: Theme.of(context).colorScheme.secondary,
                      ),
                      Text(
                        l10n.workingDaysSuggestionText(suggestion.workingDays),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      TextButton(
                        onPressed: () {
                          _controller.text = '${suggestion.workingDays}';
                          _save(suggestion.workingDays);
                        },
                        child: Text(l10n.workingDaysSuggestionUseThis),
                      ),
                    ],
                  ),
                );
              },
              orElse: () => const SizedBox.shrink(),
            ),
          ],
        ),
      ),
    );
  }
}
