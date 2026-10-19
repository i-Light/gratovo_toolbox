import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/models/activity_log_query.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/media_kit.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_mutation_guard.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The creator's media kit (fix #4) and whether they are ready to go into a
/// brand pitch: audience analytics and an agreed rate in hand (BRD-PRES-15),
/// enough of the audience in the brand's countries (HC-27), and not out of
/// scope (HC-08). Only a ready creator is pitched.
class MediaKitCard extends ConsumerWidget {
  const MediaKitCard({
    super.key,
    required this.influencer,
    required this.l10n,
  });

  final Influencer influencer;
  final AppLocalizations l10n;

  Future<void> _edit(BuildContext context, WidgetRef ref) async {
    final before = influencer.mediaKit;
    final next = await showDialog<MediaKit>(
      context: context,
      builder: (context) => _MediaKitDialog(l10n: l10n, initial: before),
    );
    if (next == null || !context.mounted) return;
    final value = next.isEmpty ? null : next;
    await guardInfluencerMutation(
      context,
      ref,
      influencer,
      action: () => ref
          .read(influencerRepositoryProvider)
          .updateMediaKit(influencer.id, value, base: before),
      log: (logger) => logger.record(
        ActivityDraft(
          action: ActivityAction.updated,
          entityType: 'channel',
          entityId: influencer.id,
          entityLabel: influencer.handle,
          field: 'media_kit',
        ),
      ),
      successMessage: l10n.mediaKitSaved,
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final kit = influencer.mediaKit;
    final readiness = PitchReadiness.of(influencer);
    final share = readiness.audienceShare;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 8,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(l10n.mediaKitTitle,
                      style: theme.textTheme.titleMedium),
                ),
                IconButton(
                  tooltip: l10n.mediaKitEdit,
                  icon: const Icon(Icons.edit_outlined, size: 20),
                  onPressed: () => _edit(context, ref),
                ),
              ],
            ),
            _Readiness(l10n: l10n, readiness: readiness),
            if (share != null)
              Text(l10n.mediaKitAudienceShare('${share.round()}'),
                  style: theme.textTheme.bodyMedium),
            if (kit == null || kit.isEmpty)
              Text(
                l10n.mediaKitEmpty,
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              )
            else ...[
              if (kit.countries.isNotEmpty)
                Text(l10n.mediaKitCountriesLine(kit.countries
                    .map((c) => '${c.code} ${_trim(c.pct)}%')
                    .join(' · '))),
              if (kit.ageBand != null) Text(l10n.mediaKitAgeLine(kit.ageBand!)),
              if (kit.engagement != null)
                Text(l10n.mediaKitEngagementLine(_trim(kit.engagement!))),
              if (kit.link != null)
                SelectableText(l10n.mediaKitLinkLine(kit.link!)),
              for (final row in kit.rates)
                Text(
                  row.agreed
                      ? l10n.mediaKitRateAgreed(
                          _formatLabel(l10n, row.format), _usd(row.price))
                      : l10n.mediaKitRateAsking(
                          _formatLabel(l10n, row.format), _usd(row.price)),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Readiness extends StatelessWidget {
  const _Readiness({required this.l10n, required this.readiness});

  final AppLocalizations l10n;
  final PitchReadiness readiness;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ready = readiness.ready;
    final color = ready ? theme.colorScheme.primary : theme.colorScheme.error;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 4,
      children: [
        Row(
          children: [
            ExcludeSemantics(
              child: Icon(
                ready ? Icons.verified_outlined : Icons.pending_outlined,
                color: color,
                size: 20,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                ready ? l10n.mediaKitReady : l10n.mediaKitNotReady,
                style: theme.textTheme.titleSmall?.copyWith(color: color),
              ),
            ),
          ],
        ),
        for (final gap in readiness.missing)
          Padding(
            padding: const EdgeInsetsDirectional.only(start: 28),
            child: Text(
              switch (gap) {
                PitchGap.analytics => l10n.mediaKitGapAnalytics,
                PitchGap.agreedRate => l10n.mediaKitGapRate,
                PitchGap.audience => l10n.mediaKitGapAudience,
                PitchGap.outOfScope => l10n.mediaKitGapOutOfScope,
              },
              style: theme.textTheme.bodySmall,
            ),
          ),
      ],
    );
  }
}

/// The deliverable types `deliverables.type` uses, in the words the deal
/// screens already use for them.
const List<String> _formats = [
  'integration',
  'dedicated',
  'short',
  'communityPost',
  'other',
];

String _formatLabel(AppLocalizations l10n, String format) => switch (format) {
      'integration' => l10n.deliverableTypeIntegration,
      'dedicated' => l10n.deliverableTypeDedicated,
      'short' => l10n.deliverableTypeShort,
      'communityPost' => l10n.deliverableTypeCommunityPost,
      _ => l10n.deliverableTypeOther,
    };

/// Rates are always USD, whatever the app's language.
String _usd(num price) => '\$${formatMoney(price)}';

String _trim(num value) =>
    value == value.roundToDouble() ? '${value.round()}' : '$value';

class _CountryRow {
  _CountryRow([AudienceShare? share])
      : code = TextEditingController(text: share?.code ?? ''),
        pct =
            TextEditingController(text: share == null ? '' : _trim(share.pct));

  final TextEditingController code;
  final TextEditingController pct;

  void dispose() {
    code.dispose();
    pct.dispose();
  }
}

class _RateRow {
  _RateRow([RateCardRow? row])
      : format = row?.format ?? _formats.first,
        price =
            TextEditingController(text: row == null ? '' : _trim(row.price)),
        agreed = row?.agreed ?? false;

  String format;
  final TextEditingController price;
  bool agreed;
}

class _MediaKitDialog extends StatefulWidget {
  const _MediaKitDialog({required this.l10n, required this.initial});

  final AppLocalizations l10n;
  final MediaKit? initial;

  @override
  State<_MediaKitDialog> createState() => _MediaKitDialogState();
}

class _MediaKitDialogState extends State<_MediaKitDialog> {
  final _formKey = GlobalKey<FormState>();
  late final List<_CountryRow> _countries;
  late final List<_RateRow> _rates;
  late final TextEditingController _age;
  late final TextEditingController _engagement;
  late final TextEditingController _link;

  @override
  void initState() {
    super.initState();
    final kit = widget.initial ?? const MediaKit();
    _countries = [
      for (final share in kit.countries) _CountryRow(share),
      if (kit.countries.isEmpty) _CountryRow(),
    ];
    _rates = [for (final row in kit.rates) _RateRow(row)];
    _age = TextEditingController(text: kit.ageBand ?? '');
    _engagement = TextEditingController(
        text: kit.engagement == null ? '' : _trim(kit.engagement!));
    _link = TextEditingController(text: kit.link ?? '');
  }

  @override
  void dispose() {
    for (final row in _countries) {
      row.dispose();
    }
    for (final row in _rates) {
      row.price.dispose();
    }
    _age.dispose();
    _engagement.dispose();
    _link.dispose();
    super.dispose();
  }

  String? _number(String? text) {
    final value = (text ?? '').trim();
    if (value.isEmpty) return null;
    return num.tryParse(value) == null
        ? widget.l10n.mediaKitInvalidNumber
        : null;
  }

  void _save() {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    String? text(TextEditingController c) =>
        c.text.trim().isEmpty ? null : c.text.trim();
    Navigator.of(context).pop(MediaKit(
      countries: [
        for (final row in _countries)
          if (row.code.text.trim().isNotEmpty &&
              num.tryParse(row.pct.text.trim()) != null)
            AudienceShare(
              code: row.code.text.trim().toUpperCase(),
              pct: num.parse(row.pct.text.trim()),
            ),
      ],
      ageBand: text(_age),
      engagement: num.tryParse(_engagement.text.trim())?.toDouble(),
      link: text(_link),
      rates: [
        for (final row in _rates)
          if (num.tryParse(row.price.text.trim()) case final price?)
            RateCardRow(format: row.format, price: price, agreed: row.agreed),
      ],
    ));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = widget.l10n;
    final theme = Theme.of(context);
    InputDecoration field(String label, {String? hint}) => InputDecoration(
          labelText: label,
          hintText: hint,
          border: const OutlineInputBorder(),
          isDense: true,
        );

    return AlertDialog(
      title: Text(l10n.mediaKitEdit),
      content: SizedBox(
        width: 520,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              spacing: 12,
              children: [
                Text(l10n.mediaKitCountriesLabel,
                    style: theme.textTheme.labelLarge),
                for (final (i, row) in _countries.indexed)
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    spacing: 8,
                    children: [
                      Expanded(
                        child: TextFormField(
                          key: ValueKey('kit-code-$i'),
                          controller: row.code,
                          textCapitalization: TextCapitalization.characters,
                          decoration: field(l10n.mediaKitCountryCode),
                          validator: (text) {
                            final code = (text ?? '').trim();
                            return code.isEmpty ||
                                    RegExp(r'^[A-Za-z]{2}$').hasMatch(code)
                                ? null
                                : l10n.mediaKitInvalidCode;
                          },
                        ),
                      ),
                      Expanded(
                        child: TextFormField(
                          key: ValueKey('kit-pct-$i'),
                          controller: row.pct,
                          keyboardType: const TextInputType.numberWithOptions(
                              decimal: true),
                          decoration: field(l10n.mediaKitShare),
                          validator: _number,
                        ),
                      ),
                    ],
                  ),
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: TextButton.icon(
                    onPressed: () =>
                        setState(() => _countries.add(_CountryRow())),
                    icon: const Icon(Icons.add),
                    label: Text(l10n.mediaKitAddCountry),
                  ),
                ),
                TextFormField(
                  key: const ValueKey('kit-age'),
                  controller: _age,
                  decoration: field(l10n.mediaKitAgeBand,
                      hint: l10n.mediaKitAgeBandHint),
                ),
                TextFormField(
                  key: const ValueKey('kit-engagement'),
                  controller: _engagement,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: field(l10n.mediaKitEngagement),
                  validator: _number,
                ),
                TextFormField(
                  key: const ValueKey('kit-link'),
                  controller: _link,
                  keyboardType: TextInputType.url,
                  decoration: field(l10n.mediaKitLink),
                ),
                Text(l10n.mediaKitRatesLabel,
                    style: theme.textTheme.labelLarge),
                for (final (i, row) in _rates.indexed)
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      SizedBox(
                        width: 180,
                        child: DropdownButtonFormField<String>(
                          initialValue: row.format,
                          isExpanded: true,
                          decoration: field(l10n.mediaKitFormat),
                          items: [
                            for (final format in _formats)
                              DropdownMenuItem(
                                value: format,
                                child: Text(_formatLabel(l10n, format)),
                              ),
                          ],
                          onChanged: (value) =>
                              setState(() => row.format = value ?? row.format),
                        ),
                      ),
                      SizedBox(
                        width: 120,
                        child: TextFormField(
                          key: ValueKey('kit-price-$i'),
                          controller: row.price,
                          keyboardType: const TextInputType.numberWithOptions(
                              decimal: true),
                          decoration: field(l10n.mediaKitPrice),
                          validator: _number,
                        ),
                      ),
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Checkbox(
                            key: ValueKey('kit-agreed-$i'),
                            value: row.agreed,
                            onChanged: (value) =>
                                setState(() => row.agreed = value ?? false),
                          ),
                          Flexible(child: Text(l10n.mediaKitAgreed)),
                        ],
                      ),
                      IconButton(
                        tooltip: l10n.mediaKitRemoveRow,
                        icon: const Icon(Icons.close),
                        onPressed: () => setState(() {
                          _rates.removeAt(i).price.dispose();
                        }),
                      ),
                    ],
                  ),
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: TextButton.icon(
                    onPressed: () => setState(() => _rates.add(_RateRow())),
                    icon: const Icon(Icons.add),
                    label: Text(l10n.mediaKitAddRate),
                  ),
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
