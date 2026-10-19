import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/widgets/collapsible_card.dart';
import 'package:gratovo_toolbox/data/models/agency_settings.dart';
import 'package:gratovo_toolbox/features/settings/application/agency_settings_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Settings -> Agency facts: the one shared `agency_settings` row.
///
/// What the drafting engine may say about the agency (its claim gate accepts
/// a claim only when it is listed here), the incubator line (HC-07), the
/// boycott list (HC-09) and the team's daily target (decision daily-target).
/// The whole card saves at once; last write wins.
class AgencyFactsCard extends ConsumerStatefulWidget {
  const AgencyFactsCard({super.key});

  @override
  ConsumerState<AgencyFactsCard> createState() => _AgencyFactsCardState();
}

class _AgencyFactsCardState extends ConsumerState<AgencyFactsCard> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _sender = TextEditingController();
  final _whatWeDo = TextEditingController();
  final _website = TextEditingController();
  final _claims = TextEditingController();
  final _campaigns = TextEditingController();
  final _countries = TextEditingController();
  final _brands = TextEditingController();
  final _target = TextEditingController();
  bool _incubator = true;
  bool _saving = false;

  /// The row the fields were last filled from, so a teammate's save arriving
  /// by sync refills them only while nothing has been typed over it.
  AgencySettings? _shown;

  @override
  void dispose() {
    for (final controller in [
      _name,
      _sender,
      _whatWeDo,
      _website,
      _claims,
      _campaigns,
      _countries,
      _brands,
      _target,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  void _fill(AgencySettings settings) {
    _name.text = settings.name;
    _sender.text = settings.sender;
    _whatWeDo.text = settings.whatWeDo;
    _website.text = settings.website;
    _claims.text = settings.trueClaims.join('\n');
    _campaigns.text = settings.pastCampaigns.join('\n');
    _countries.text = settings.boycottCountries.join(', ');
    _brands.text = settings.boycottBrands.join('\n');
    _target.text = '${settings.dailyTarget}';
    _incubator = settings.incubator;
    _shown = settings;
  }

  AgencySettings _read() => AgencySettings(
        name: _name.text.trim(),
        sender: _sender.text.trim(),
        whatWeDo: _whatWeDo.text.trim(),
        website: _website.text.trim(),
        trueClaims: _lines(_claims.text),
        pastCampaigns: _lines(_campaigns.text),
        incubator: _incubator,
        boycottCountries: _codes(_countries.text),
        boycottBrands: _lines(_brands.text),
        dailyTarget: int.parse(_target.text.trim()),
      );

  static List<String> _lines(String text) => [
        for (final line in text.split('\n'))
          if (line.trim().isNotEmpty) line.trim(),
      ];

  static List<String> _codes(String text) => [
        for (final code in text.split(RegExp(r'[,\s]+')))
          if (code.trim().isNotEmpty) code.trim().toUpperCase(),
      ];

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context);
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final settings = _read();
    setState(() => _saving = true);
    try {
      await ref.read(agencySettingsProvider.notifier).save(settings);
      _shown = settings;
      if (mounted) AppToast.success(context, l10n.settingsAgencySaved);
    } on Exception catch (error) {
      if (mounted) AppToast.error(context, '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final loaded = ref.watch(agencySettingsProvider).value;
    if (loaded != null && loaded != _shown && !_saving) {
      final untouched = _shown == null || _readOrNull() == _shown;
      if (untouched) _fill(loaded);
    }

    InputDecoration decoration(String label, {String? help}) => InputDecoration(
          labelText: label,
          helperText: help,
          helperMaxLines: 3,
          border: const OutlineInputBorder(),
        );

    return CollapsibleCard(
      leadingIcon: const Icon(
        Icons.business_outlined,
        size: 32,
        color: AppColors.offwhite,
      ),
      title: l10n.settingsAgencyTitle,
      subtitle: l10n.settingsAgencySubtitle,
      initiallyExpanded: false,
      child: loaded == null
          ? const Padding(
              padding: EdgeInsets.all(16),
              child: Center(child: CircularProgressIndicator()),
            )
          : Form(
              key: _formKey,
              child: Column(
                spacing: 16,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextFormField(
                    key: const ValueKey('agency-name'),
                    controller: _name,
                    decoration: decoration(l10n.settingsAgencyName),
                  ),
                  TextFormField(
                    key: const ValueKey('agency-sender'),
                    controller: _sender,
                    decoration: decoration(l10n.settingsAgencySender),
                  ),
                  TextFormField(
                    key: const ValueKey('agency-whatwedo'),
                    controller: _whatWeDo,
                    minLines: 2,
                    maxLines: 5,
                    decoration: decoration(l10n.settingsAgencyWhatWeDo),
                  ),
                  TextFormField(
                    key: const ValueKey('agency-website'),
                    controller: _website,
                    keyboardType: TextInputType.url,
                    decoration: decoration(l10n.settingsAgencyWebsite),
                  ),
                  TextFormField(
                    key: const ValueKey('agency-claims'),
                    controller: _claims,
                    minLines: 3,
                    maxLines: 10,
                    decoration: decoration(l10n.settingsAgencyTrueClaims,
                        help: l10n.settingsAgencyTrueClaimsHelp),
                  ),
                  TextFormField(
                    key: const ValueKey('agency-campaigns'),
                    controller: _campaigns,
                    minLines: 2,
                    maxLines: 8,
                    decoration: decoration(l10n.settingsAgencyPastCampaigns,
                        help: l10n.settingsAgencyPastCampaignsHelp),
                  ),
                  SwitchListTile(
                    key: const ValueKey('agency-incubator'),
                    contentPadding: EdgeInsets.zero,
                    value: _incubator,
                    onChanged: (value) => setState(() => _incubator = value),
                    title: Text(l10n.settingsAgencyIncubator),
                    subtitle: Text(l10n.settingsAgencyIncubatorHelp),
                  ),
                  Text(l10n.settingsAgencyBoycottSection,
                      style: theme.textTheme.titleSmall),
                  TextFormField(
                    key: const ValueKey('agency-countries'),
                    controller: _countries,
                    textCapitalization: TextCapitalization.characters,
                    decoration: decoration(l10n.settingsAgencyBoycottCountries,
                        help: l10n.settingsAgencyBoycottCountriesHelp),
                    validator: (text) => _codes(text ?? '').every(
                            (code) => RegExp(r'^[A-Z]{2}$').hasMatch(code))
                        ? null
                        : l10n.settingsAgencyCountryInvalid,
                  ),
                  TextFormField(
                    key: const ValueKey('agency-brands'),
                    controller: _brands,
                    minLines: 2,
                    maxLines: 10,
                    decoration: decoration(l10n.settingsAgencyBoycottBrands,
                        help: l10n.settingsAgencyBoycottBrandsHelp),
                  ),
                  TextFormField(
                    key: const ValueKey('agency-target'),
                    controller: _target,
                    keyboardType: TextInputType.number,
                    decoration: decoration(l10n.settingsAgencyDailyTarget),
                    validator: (text) {
                      final value = int.tryParse((text ?? '').trim());
                      return value != null && value >= 1 && value <= 500
                          ? null
                          : l10n.settingsAgencyDailyTargetInvalid;
                    },
                  ),
                  Align(
                    alignment: AlignmentDirectional.centerEnd,
                    child: FilledButton.icon(
                      onPressed: _saving ? null : _save,
                      icon: _saving
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.save_outlined),
                      label: Text(l10n.commonSave),
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  /// The fields as a value, or null while the target is not a number yet.
  AgencySettings? _readOrNull() =>
      int.tryParse(_target.text.trim()) == null ? null : _read();
}
