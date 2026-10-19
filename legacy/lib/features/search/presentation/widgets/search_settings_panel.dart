import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/constants/countries.dart';
import 'package:gratovo_toolbox/core/theme/panel_button_style.dart';
import 'package:gratovo_toolbox/features/archive/application/archive_controller.dart';
import 'package:gratovo_toolbox/features/search/application/auto_clean_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_settings_controller.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/auto_clean_panel.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// AppBar action that opens the per-run search settings — sort, results
/// type, country filter, max-videos override, and the standing auto-clean
/// rule.
///
/// Used to be a card collapsed by default at the top of the page: these are
/// overrides, and the shared team defaults in Settings are correct for
/// almost every run, so a panel of controls permanently occupying the top of
/// the page pushed the keyword box and Start button below the fold. Moving
/// it into the AppBar as a button removes it from that flow entirely — the
/// label carries the one summary worth seeing without opening anything (the
/// auto-clean rule, since it is the one setting here that acts on its own),
/// and everything else — [_SettingsFields] itself, unchanged — lives behind
/// a tap in [_SearchSettingsDialog].
class SearchSettingsButton extends ConsumerWidget {
  const SearchSettingsButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final canEdit = ref.watch(capabilitiesProvider).canEditSearchInputs;
    final autoCleanRule = ref.watch(autoCleanRuleProvider);
    final summary = autoCleanCompactSummary(l10n, autoCleanRule);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: ElevatedButton(
        style: panelButtonStyle(theme),
        onPressed: () => showDialog<void>(
          context: context,
          builder: (_) => _SearchSettingsDialog(canEdit: canEdit),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (summary.isNotEmpty) ...[
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 270),
                child: Text(
                  summary,
                  style: theme.textTheme.bodyMedium,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
            ],
            const Icon(Icons.tune, size: 20),
          ],
        ),
      ),
    );
  }
}

/// The settings themselves, exactly as they behaved inside the old collapsed
/// card — [_SettingsFields] is untouched, only its container changed.
class _SearchSettingsDialog extends StatelessWidget {
  const _SearchSettingsDialog({required this.canEdit});

  final bool canEdit;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final screen = MediaQuery.sizeOf(context);
    final width =
        screen.width * 0.9 < 560.0 ? screen.width * 0.9 : screen.width * 0.8;
    final height = screen.height * 0.85;

    return AlertDialog(
      title: Text(l10n.searchSettingsTitle),
      contentPadding: const EdgeInsets.fromLTRB(24, 12, 24, 0),
      content: SizedBox(
        width: width,
        height: height,
        child: SingleChildScrollView(
          child: _SettingsFields(canEdit: canEdit),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonClose),
        ),
      ],
    );
  }
}

class _SettingsFields extends ConsumerWidget {
  const _SettingsFields({required this.canEdit});

  final bool canEdit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final settings = ref.watch(searchSettingsProvider);
    final notifier = ref.read(searchSettingsProvider.notifier);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (!canEdit)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Row(
              children: [
                const Icon(Icons.lock_outline, size: 16),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    l10n.searchInputsReadOnlyHint,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              ],
            ),
          ),
        Wrap(
          spacing: 16,
          runSpacing: 16,
          children: [
            SizedBox(
              width: 220,
              child: DropdownButtonFormField<SearchSortBy>(
                initialValue: settings.sortBy,
                decoration: InputDecoration(
                  labelText: l10n.searchSortByLabel,
                  isDense: true,
                ),
                items: [
                  DropdownMenuItem(
                    value: SearchSortBy.relevance,
                    child: Text(l10n.searchSortByRelevance),
                  ),
                  DropdownMenuItem(
                    value: SearchSortBy.uploadDate,
                    child: Text(l10n.searchSortByUploadDate),
                  ),
                  DropdownMenuItem(
                    value: SearchSortBy.viewCount,
                    child: Text(l10n.searchSortByViewCount),
                  ),
                  DropdownMenuItem(
                    value: SearchSortBy.rating,
                    child: Text(l10n.searchSortByRating),
                  ),
                ],
                onChanged: canEdit
                    ? (value) {
                        if (value != null) notifier.setSortBy(value);
                      }
                    : null,
              ),
            ),
            SizedBox(
              width: 220,
              child: DropdownButtonFormField<SearchResultsType>(
                initialValue: settings.resultsType,
                decoration: InputDecoration(
                  labelText: l10n.searchResultsTypeLabel,
                  isDense: true,
                ),
                items: [
                  DropdownMenuItem(
                    value: SearchResultsType.video,
                    child: Text(l10n.searchResultsTypeVideo),
                  ),
                  DropdownMenuItem(
                    value: SearchResultsType.channel,
                    child: Text(l10n.searchResultsTypeChannel),
                  ),
                ],
                onChanged: canEdit
                    ? (value) {
                        if (value != null) notifier.setResultsType(value);
                      }
                    : null,
              ),
            ),
            _CountryDropdown(canEdit: canEdit),
            _MaxVideosField(canEdit: canEdit),
          ],
        ),
        // The standing auto-clean rule, as a sub-section of the search
        // settings. Full authority only, and absent rather than disabled for
        // everyone else — the database refuses the sweep regardless, so a rule
        // a `basic` account could switch on would be a switch that quietly does
        // nothing. See canBulkCleanProvider.
        if (ref.watch(canBulkCleanProvider)) ...[
          const SizedBox(height: 20),
          const Divider(height: 1),
          const SizedBox(height: 16),
          const AutoCleanPanel(),
        ],
      ],
    );
  }
}

/// Country picker: a closed field showing the chosen two-letter codes (or
/// "Any"), tapped to open a checklist of every country — frequently targeted
/// ones first. Multiple countries can be selected; the set is what `search.py`'s
/// COUNTRY_FILTER matches each discovered channel against.
class _CountryDropdown extends ConsumerWidget {
  const _CountryDropdown({required this.canEdit});

  final bool canEdit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final selected = ref.watch(
      searchSettingsProvider.select((s) => s.normalizedCountries),
    );
    final ordered = selected.toList()..sort();

    return SizedBox(
      width: 220,
      child: InkWell(
        onTap: canEdit ? () => _openPicker(context, ref) : null,
        child: InputDecorator(
          isEmpty: ordered.isEmpty,
          decoration: InputDecoration(
            labelText: l10n.searchCountryLabel,
            isDense: true,
            suffixIcon: const Icon(Icons.arrow_drop_down),
            enabled: canEdit,
          ),
          child: Text(
            ordered.isEmpty ? l10n.searchCountryAny : ordered.join(', '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: ordered.isEmpty
                ? null
                : const TextStyle(fontWeight: FontWeight.w600),
          ),
        ),
      ),
    );
  }

  Future<void> _openPicker(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    final notifier = ref.read(searchSettingsProvider.notifier);

    // Frequently targeted countries first, then a divider, then the rest
    // alphabetically.
    final frequent = kAllCountries
        .where((c) => kFrequentCountryCodes.contains(c.code))
        .toList()
      ..sort((a, b) => a.name.compareTo(b.name));
    final rest = kAllCountries
        .where((c) => !kFrequentCountryCodes.contains(c.code))
        .toList();

    var working = {...ref.read(searchSettingsProvider).normalizedCountries};

    await showDialog<void>(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            void toggle(String code, bool? value) {
              setDialogState(() {
                if (value ?? false) {
                  working.add(code);
                } else {
                  working.remove(code);
                }
              });
              notifier.setCountries(working);
            }

            Widget tile(Country c) => CheckboxListTile(
                  dense: true,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: working.contains(c.code),
                  onChanged: (v) => toggle(c.code, v),
                  title: Text('${c.name}  (${c.code})',
                      overflow: TextOverflow.ellipsis),
                );

            return AlertDialog(
              title: Text(l10n.searchCountryPickTitle),
              content: SizedBox(
                width: 380,
                height: 460,
                child: ListView(
                  children: [
                    for (final c in frequent) tile(c),
                    const Divider(height: 8),
                    for (final c in rest) tile(c),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () {
                    setDialogState(
                        () => working = {...kDefaultSearchCountries});
                    notifier.setCountries(working);
                  },
                  child: Text(l10n.searchCountryEnglishMarkets),
                ),
                TextButton(
                  onPressed: () {
                    setDialogState(() => working = <String>{});
                    notifier.setCountries(working);
                  },
                  child: Text(l10n.searchCountryClearAll),
                ),
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: Text(l10n.commonClose),
                ),
              ],
            );
          },
        );
      },
    );
  }
}

/// The per-keyword search-result cap, with the explanation that was missing.
class _MaxVideosField extends ConsumerWidget {
  const _MaxVideosField({required this.canEdit});

  final bool canEdit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final settings = ref.watch(searchSettingsProvider);
    final notifier = ref.read(searchSettingsProvider.notifier);

    return SizedBox(
      width: 240,
      child: Tooltip(
        message: l10n.searchMaxVideosTooltip,
        waitDuration: const Duration(milliseconds: 300),
        child: TextFormField(
          initialValue: settings.handleLimitOverride?.toString() ?? '',
          enabled: canEdit,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: InputDecoration(
            labelText: l10n.searchMaxVideosLabel,
            hintText: l10n.searchOverrideHint,
            isDense: true,
            // The tooltip covers the long explanation; this icon is what tells
            // people there IS one to hover.
            suffixIcon: Tooltip(
              message: l10n.searchMaxVideosTooltip,
              triggerMode: TooltipTriggerMode.tap,
              showDuration: const Duration(seconds: 8),
              child: const Icon(Icons.help_outline, size: 18),
            ),
          ),
          onChanged: (value) =>
              notifier.setHandleLimitOverride(int.tryParse(value)),
        ),
      ),
    );
  }
}
