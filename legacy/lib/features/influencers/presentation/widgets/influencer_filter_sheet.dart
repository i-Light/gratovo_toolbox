import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/countries.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_filter_controller.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_page_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The Influencer Database's filters, in a sheet rather than a permanent bar.
///
/// There are ten of them. A bar wide enough to hold ten controls either eats
/// the top third of the screen or wraps into something unreadable, and nine of
/// the ten are set rarely. The bar keeps what changes constantly (search, sort,
/// view mode) and everything else lives here behind a button that shows how
/// many are active, so a filter can never be silently on.
///
/// Every control writes straight through to [influencerFilterProvider] rather
/// than collecting into a draft applied on close. The list behind the sheet
/// updates as you go, which is what makes a range filter usable at all — you
/// are choosing a threshold against the results, not guessing one blind.
class InfluencerFilterSheet extends ConsumerWidget {
  const InfluencerFilterSheet({super.key});

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => const InfluencerFilterSheet(),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final query = ref.watch(influencerFilterProvider);
    final notifier = ref.read(influencerFilterProvider.notifier);
    final countriesAsync = ref.watch(influencerCountriesProvider);

    return SafeArea(
      child: ConstrainedBox(
        // Half the window at most, so the list stays visible behind it and the
        // effect of a filter can be seen while it is being set.
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.7,
        ),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      l10n.influencerListFilters,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  if (!query.isUnfiltered)
                    TextButton(
                      onPressed: notifier.clear,
                      child: Text(l10n.influencerListClearFilters),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              // First: the yes/no questions a person asks most (fix #10).
              _Section(label: l10n.influencerFilterShowOnly),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final flag in InfluencerFlag.values)
                    FilterChip(
                      label: Text(switch (flag) {
                        InfluencerFlag.hasEmail =>
                          l10n.influencerFilterHasEmail,
                        InfluencerFlag.sponsored =>
                          l10n.influencerFilterSponsored,
                        InfluencerFlag.shortlisted =>
                          l10n.influencerFilterShortlisted,
                        InfluencerFlag.readyToPitch =>
                          l10n.influencerFilterReadyToPitch,
                        InfluencerFlag.neverContacted =>
                          l10n.influencerFilterNeverContacted,
                      }),
                      selected: query.requireFlags.contains(flag),
                      onSelected: (_) => notifier.toggleFlag(flag),
                    ),
                ],
              ),
              _Section(label: l10n.influencerFilterCountry),
              _IncludeExcludeList<String>(
                // Only the countries some channel actually has, not all
                // 249 — a list of every country in the world to pick between
                // the eleven in the data is a scroll for nothing. A value
                // still selected but no longer among them (the last channel
                // with it was edited while the sheet was open) is folded
                // back in, so the row stays visible and clearable instead of
                // silently vanishing.
                options: {
                  ...countriesAsync.value ?? const [],
                  ...query.includeCountries,
                  ...query.excludeCountries,
                }.toList()
                  ..sort(),
                labelFor: countryNameFor,
                include: query.includeCountries,
                exclude: query.excludeCountries,
                includeLabel: l10n.influencerFilterInclude,
                excludeLabel: l10n.influencerFilterExclude,
                onToggleInclude: notifier.toggleIncludeCountry,
                onToggleExclude: notifier.toggleExcludeCountry,
              ),
              _Section(label: l10n.influencerFilterChannelTag),
              _IncludeExcludeList<ChannelTag>(
                options: ChannelTag.values,
                labelFor: (tag) => tag.label(l10n),
                include: query.includeChannelTags,
                exclude: query.excludeChannelTags,
                includeLabel: l10n.influencerFilterInclude,
                excludeLabel: l10n.influencerFilterExclude,
                onToggleInclude: notifier.toggleIncludeChannelTag,
                onToggleExclude: notifier.toggleExcludeChannelTag,
              ),
              _Section(label: l10n.influencerFilterStage),
              _IncludeExcludeList<PipelineStage>(
                options: PipelineStage.values,
                labelFor: (stage) => stage.label(l10n),
                include: query.includePipelineStages,
                exclude: query.excludePipelineStages,
                includeLabel: l10n.influencerFilterInclude,
                excludeLabel: l10n.influencerFilterExclude,
                onToggleInclude: notifier.toggleIncludePipelineStage,
                onToggleExclude: notifier.toggleExcludePipelineStage,
              ),
              _Section(label: l10n.influencerFilterMinSubscribers),
              _NumberRangeRow(
                minLabel: l10n.influencerFilterMin,
                maxLabel: l10n.influencerFilterMax,
                min: query.minSubscribers,
                max: query.maxSubscribers,
                onMinChanged: notifier.setMinSubscribers,
                onMaxChanged: notifier.setMaxSubscribers,
              ),
              _Section(label: l10n.influencerFilterMedianViews),
              _NumberRangeRow(
                minLabel: l10n.influencerFilterMin,
                maxLabel: l10n.influencerFilterMax,
                min: query.minMedianViews,
                max: query.maxMedianViews,
                onMinChanged: notifier.setMinMedianViews,
                onMaxChanged: notifier.setMaxMedianViews,
              ),
              _Section(label: l10n.influencerFilterDaysSinceDeal),
              _NumberRangeRow(
                minLabel: l10n.influencerFilterMin,
                maxLabel: l10n.influencerFilterMax,
                min: query.minDaysSinceLastDeal,
                max: query.maxDaysSinceLastDeal,
                onMinChanged: (value) => notifier.setDaysSinceLastDeal(
                  min: value,
                  max: query.maxDaysSinceLastDeal,
                ),
                onMaxChanged: (value) => notifier.setDaysSinceLastDeal(
                  min: query.minDaysSinceLastDeal,
                  max: value,
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  // Said outright rather than left to be discovered: a channel
                  // that has never had a deal has no value here, so any bound
                  // on this silently excludes every channel never worked with.
                  l10n.influencerFilterDealsOnlyNote,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 16, bottom: 6),
      child: Text(label, style: Theme.of(context).textTheme.labelLarge),
    );
  }
}

/// A filter dimension with more than "on/off": each option gets an Include
/// checkbox and an Exclude checkbox, so the list can be narrowed to a few
/// values ("EG or US") and ruled off a few others ("not LB") in the same
/// pass. The two are independent sets rather than one tri-state per option —
/// [InfluencerFilterNotifier]'s toggle methods are what keep an option out of
/// both at once, this widget just renders whatever state it is handed.
class _IncludeExcludeList<T> extends StatelessWidget {
  const _IncludeExcludeList({
    required this.options,
    required this.labelFor,
    required this.include,
    required this.exclude,
    required this.includeLabel,
    required this.excludeLabel,
    required this.onToggleInclude,
    required this.onToggleExclude,
  });

  final List<T> options;
  final String Function(T) labelFor;
  final Set<T> include;
  final Set<T> exclude;
  final String includeLabel;
  final String excludeLabel;
  final ValueChanged<T> onToggleInclude;
  final ValueChanged<T> onToggleExclude;

  static const _checkboxColumnWidth = 64.0;

  @override
  Widget build(BuildContext context) {
    final labelStyle = Theme.of(context).textTheme.labelSmall;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Expanded(child: SizedBox.shrink()),
            SizedBox(
              width: _checkboxColumnWidth,
              child: Text(
                includeLabel,
                textAlign: TextAlign.center,
                style: labelStyle,
              ),
            ),
            SizedBox(
              width: _checkboxColumnWidth,
              child: Text(
                excludeLabel,
                textAlign: TextAlign.center,
                style: labelStyle,
              ),
            ),
          ],
        ),
        for (final option in options)
          Row(
            children: [
              Expanded(
                child: Text(
                  labelFor(option),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              SizedBox(
                width: _checkboxColumnWidth,
                child: Checkbox(
                  value: include.contains(option),
                  onChanged: (_) => onToggleInclude(option),
                ),
              ),
              SizedBox(
                width: _checkboxColumnWidth,
                child: Checkbox(
                  value: exclude.contains(option),
                  onChanged: (_) => onToggleExclude(option),
                ),
              ),
            ],
          ),
      ],
    );
  }
}

class _NumberRangeRow extends StatelessWidget {
  const _NumberRangeRow({
    required this.minLabel,
    required this.maxLabel,
    required this.min,
    required this.max,
    required this.onMinChanged,
    required this.onMaxChanged,
  });

  final String minLabel;
  final String maxLabel;
  final int? min;
  final int? max;
  final ValueChanged<int?> onMinChanged;
  final ValueChanged<int?> onMaxChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _NumberField(
            label: minLabel,
            value: min,
            onChanged: onMinChanged,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _NumberField(
            label: maxLabel,
            value: max,
            onChanged: onMaxChanged,
          ),
        ),
      ],
    );
  }
}

/// A numeric filter field where an empty box means "no bound".
///
/// Stateful with its own controller rather than rebuilt from [value] every
/// frame: writing the parsed value back into the field as you type is what
/// makes a text field jump the cursor to the end after every keystroke.
class _NumberField extends StatefulWidget {
  const _NumberField({
    required this.label,
    required this.value,
    required this.onChanged,
  });

  final String label;
  final int? value;
  final ValueChanged<int?> onChanged;

  @override
  State<_NumberField> createState() => _NumberFieldState();
}

class _NumberFieldState extends State<_NumberField> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.value?.toString() ?? '');

  @override
  void didUpdateWidget(_NumberField oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Only follow an external change — "Clear filters" emptying the box. A
    // value that already matches what is typed is left alone, cursor intact.
    final incoming = widget.value?.toString() ?? '';
    if (widget.value != oldWidget.value && incoming != _controller.text) {
      _controller.text = incoming;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      keyboardType: TextInputType.number,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      decoration: InputDecoration(
        labelText: widget.label,
        isDense: true,
        border: const OutlineInputBorder(),
      ),
      onChanged: (text) {
        final trimmed = text.trim();
        widget.onChanged(trimmed.isEmpty ? null : int.tryParse(trimmed));
      },
    );
  }
}
