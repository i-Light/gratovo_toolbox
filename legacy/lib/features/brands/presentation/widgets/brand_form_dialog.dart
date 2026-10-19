import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/data/models/agency_settings.dart';
import 'package:gratovo_toolbox/data/models/brand.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/brands/application/boycott_check.dart';
import 'package:gratovo_toolbox/features/settings/application/agency_settings_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Opens the New brand / Edit brand form (fix #5) and saves what comes back.
/// [initial] edits that brand; [prefill] starts a new one from a draft (a
/// brand seen sponsoring). Returns the saved brand, or null when the person
/// cancelled.
Future<Brand?> showBrandForm(
  BuildContext context, {
  Brand? initial,
  Brand? prefill,
}) async {
  final draft = await showDialog<Brand>(
    context: context,
    builder: (context) => BrandFormDialog(initial: initial, prefill: prefill),
  );
  if (draft == null || !context.mounted) return null;
  final container = ProviderScope.containerOf(context, listen: false);
  final l10n = AppLocalizations.of(context);
  final repository = container.read(brandRepositoryProvider);
  try {
    final Brand saved;
    if (initial == null) {
      saved = await repository.create(draft);
    } else {
      await repository.update(draft);
      saved = draft;
    }
    container.read(dataRevisionsProvider.notifier).bump({DataDomain.brands});
    if (context.mounted) AppToast.success(context, l10n.brandSaved);
    return saved;
  } on Exception catch (error) {
    if (context.mounted) AppToast.error(context, '$error');
    return null;
  }
}

/// The boycott line for [hit] (HC-09), in the words the form, the list and
/// the profile all use.
String boycottMessage(AppLocalizations l10n, BoycottHit hit) =>
    switch (hit.reason) {
      BoycottReason.country => l10n.brandBoycottCountry(hit.value),
      BoycottReason.brand => l10n.brandBoycottBrand(hit.value),
    };

class BrandFormDialog extends ConsumerStatefulWidget {
  const BrandFormDialog({super.key, this.initial, this.prefill});

  /// The brand being edited; null for a new one.
  final Brand? initial;

  /// Where a new brand's fields start from.
  final Brand? prefill;

  @override
  ConsumerState<BrandFormDialog> createState() => _BrandFormDialogState();
}

class _ContactRow {
  _ContactRow([BrandContact? contact])
      : name = TextEditingController(text: contact?.name ?? ''),
        email = TextEditingController(text: contact?.email ?? ''),
        role = TextEditingController(text: contact?.role ?? '');

  final TextEditingController name;
  final TextEditingController email;
  final TextEditingController role;

  bool get isEmpty => name.text.trim().isEmpty && email.text.trim().isEmpty;

  void dispose() {
    name.dispose();
    email.dispose();
    role.dispose();
  }
}

class _BrandFormDialogState extends ConsumerState<BrandFormDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _website;
  late final TextEditingController _category;
  late final TextEditingController _country;
  late final TextEditingController _budget;
  late final TextEditingController _brief;
  late String _currency;
  late final List<_ContactRow> _contacts;
  int _primary = 0;

  static const _currencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'];

  @override
  void initState() {
    super.initState();
    final brand = widget.initial ?? widget.prefill;
    _name = TextEditingController(text: brand?.name ?? '');
    _website = TextEditingController(text: brand?.website ?? '');
    _category = TextEditingController(text: brand?.category ?? '');
    _country = TextEditingController(text: brand?.country ?? '');
    _budget = TextEditingController(
        text: brand?.budget == null ? '' : _plain(brand!.budget!));
    _brief = TextEditingController(text: brand?.campaignBrief ?? '');
    _currency = brand?.budgetCurrency ?? 'USD';
    final contacts = brand?.allContacts ?? const <BrandContact>[];
    _contacts = [
      for (final contact in contacts) _ContactRow(contact),
      if (contacts.isEmpty) _ContactRow(),
    ];
    final primary = contacts.indexWhere((c) => c.isPrimary);
    _primary = primary < 0 ? 0 : primary;
  }

  static String _plain(double value) =>
      value == value.roundToDouble() ? '${value.round()}' : '$value';

  @override
  void dispose() {
    for (final controller in [
      _name,
      _website,
      _category,
      _country,
      _budget,
      _brief,
    ]) {
      controller.dispose();
    }
    for (final row in _contacts) {
      row.dispose();
    }
    super.dispose();
  }

  String? _text(TextEditingController c) =>
      c.text.trim().isEmpty ? null : c.text.trim();

  Brand _draft() {
    final kept = [
      for (final (i, row) in _contacts.indexed)
        if (!row.isEmpty) (i, row),
    ];
    final primaryKept = kept.any((entry) => entry.$1 == _primary)
        ? _primary
        : (kept.isEmpty ? -1 : kept.first.$1);
    final base = widget.initial ?? widget.prefill;
    return Brand(
      id: base?.id ?? '',
      name: _name.text.trim(),
      createdAt: base?.createdAt ?? DateTime.now().toUtc(),
      contactPhone: base?.contactPhone,
      website: _text(_website),
      budget: double.tryParse(_budget.text.trim()),
      budgetCurrency: _currency,
      campaignBrief: _text(_brief),
      preferredCriteria: base?.preferredCriteria ?? const [],
      notes: base?.notes,
      category: _text(_category),
      country: _text(_country)?.toUpperCase(),
      source: base?.source ?? BrandSource.manual,
      contacts: [
        for (final (i, row) in kept)
          BrandContact(
            name: row.name.text.trim(),
            email: row.email.text.trim(),
            role: _text(row.role),
            isPrimary: i == primaryKept,
          ),
      ],
    );
  }

  void _save() {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    Navigator.of(context).pop(_draft());
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final agency =
        ref.watch(agencySettingsProvider).value ?? const AgencySettings();
    final hit = boycottHit(_draft(), agency);
    InputDecoration field(String label) => InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          isDense: true,
        );
    void changed(String _) => setState(() {});

    return AlertDialog(
      title: Text(widget.initial == null ? l10n.brandNew : l10n.brandEdit),
      content: SizedBox(
        width: 560,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              spacing: 12,
              children: [
                if (hit != null)
                  _BoycottBanner(text: boycottMessage(l10n, hit)),
                TextFormField(
                  key: const ValueKey('brand-name'),
                  controller: _name,
                  decoration: field(l10n.brandFormName),
                  onChanged: changed,
                  validator: (text) => (text ?? '').trim().isEmpty
                      ? l10n.brandFormNameRequired
                      : null,
                ),
                TextFormField(
                  key: const ValueKey('brand-website'),
                  controller: _website,
                  keyboardType: TextInputType.url,
                  decoration: field(l10n.brandFormWebsite),
                  onChanged: changed,
                ),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 8,
                  children: [
                    Expanded(
                      flex: 2,
                      child: TextFormField(
                        key: const ValueKey('brand-category'),
                        controller: _category,
                        decoration: field(l10n.brandFormCategory),
                      ),
                    ),
                    Expanded(
                      child: TextFormField(
                        key: const ValueKey('brand-country'),
                        controller: _country,
                        textCapitalization: TextCapitalization.characters,
                        decoration: field(l10n.brandFormCountry),
                        onChanged: changed,
                        validator: (text) {
                          final code = (text ?? '').trim();
                          return code.isEmpty ||
                                  RegExp(r'^[A-Za-z]{2}$').hasMatch(code)
                              ? null
                              : l10n.brandFormCountryInvalid;
                        },
                      ),
                    ),
                  ],
                ),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 8,
                  children: [
                    Expanded(
                      flex: 2,
                      child: TextFormField(
                        key: const ValueKey('brand-budget'),
                        controller: _budget,
                        keyboardType: const TextInputType.numberWithOptions(
                            decimal: true),
                        decoration: field(l10n.brandFormBudget),
                        validator: (text) => (text ?? '').trim().isEmpty ||
                                double.tryParse(text!.trim()) != null
                            ? null
                            : l10n.mediaKitInvalidNumber,
                      ),
                    ),
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue:
                            _currencies.contains(_currency) ? _currency : 'USD',
                        isExpanded: true,
                        decoration: field(l10n.brandFormCurrency),
                        items: [
                          for (final code in _currencies)
                            DropdownMenuItem(value: code, child: Text(code)),
                        ],
                        onChanged: (value) =>
                            setState(() => _currency = value ?? _currency),
                      ),
                    ),
                  ],
                ),
                Text(l10n.brandFormContacts, style: theme.textTheme.labelLarge),
                RadioGroup<int>(
                  groupValue: _primary,
                  onChanged: (value) =>
                      setState(() => _primary = value ?? _primary),
                  child: Column(
                    spacing: 12,
                    children: [
                      for (final (i, row) in _contacts.indexed)
                        _ContactFields(
                          index: i,
                          row: row,
                          l10n: l10n,
                          onRemove: _contacts.length == 1
                              ? null
                              : () => setState(() {
                                    _contacts.removeAt(i).dispose();
                                    if (_primary >= _contacts.length) {
                                      _primary = 0;
                                    }
                                  }),
                        ),
                    ],
                  ),
                ),
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: TextButton.icon(
                    onPressed: () =>
                        setState(() => _contacts.add(_ContactRow())),
                    icon: const Icon(Icons.person_add_alt),
                    label: Text(l10n.brandFormAddContact),
                  ),
                ),
                TextFormField(
                  key: const ValueKey('brand-brief'),
                  controller: _brief,
                  minLines: 2,
                  maxLines: 6,
                  decoration: field(l10n.brandFormBrief),
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
        FilledButton(onPressed: _save, child: Text(l10n.commonSave)),
      ],
    );
  }
}

class _ContactFields extends StatelessWidget {
  const _ContactFields({
    required this.index,
    required this.row,
    required this.l10n,
    required this.onRemove,
  });

  final int index;
  final _ContactRow row;
  final AppLocalizations l10n;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    InputDecoration field(String label) => InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          isDense: true,
        );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: 8,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 8,
          children: [
            Expanded(
              child: TextFormField(
                key: ValueKey('brand-contact-name-$index'),
                controller: row.name,
                decoration: field(l10n.brandFormContactName),
              ),
            ),
            Expanded(
              child: TextFormField(
                key: ValueKey('brand-contact-email-$index'),
                controller: row.email,
                keyboardType: TextInputType.emailAddress,
                decoration: field(l10n.brandFormContactEmail),
                validator: (text) {
                  final value = (text ?? '').trim();
                  return value.isEmpty ||
                          RegExp(r'^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$')
                              .hasMatch(value)
                      ? null
                      : l10n.brandFormEmailInvalid;
                },
              ),
            ),
          ],
        ),
        Row(
          spacing: 8,
          children: [
            Expanded(
              child: TextFormField(
                key: ValueKey('brand-contact-role-$index'),
                controller: row.role,
                decoration: field(l10n.brandFormContactRole),
              ),
            ),
            Radio<int>(value: index),
            Flexible(child: Text(l10n.brandFormContactPrimary)),
            if (onRemove != null)
              IconButton(
                tooltip: l10n.brandFormRemoveContact,
                icon: const Icon(Icons.close),
                onPressed: onRemove,
              ),
          ],
        ),
      ],
    );
  }
}

/// HC-09's warning, as an icon and words.
class _BoycottBanner extends StatelessWidget {
  const _BoycottBanner({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.errorContainer,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          ExcludeSemantics(
            child: Icon(Icons.block, color: theme.colorScheme.onErrorContainer),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: TextStyle(color: theme.colorScheme.onErrorContainer),
            ),
          ),
        ],
      ),
    );
  }
}

/// The same warning, for the brand profile and anywhere else a boycotted
/// brand is shown.
class BrandBoycottBanner extends ConsumerWidget {
  const BrandBoycottBanner({super.key, required this.brand});

  final Brand brand;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final agency = ref.watch(agencySettingsProvider).value;
    final hit = agency == null ? null : boycottHit(brand, agency);
    if (hit == null) return const SizedBox.shrink();
    return _BoycottBanner(
        text: boycottMessage(AppLocalizations.of(context), hit));
  }
}
