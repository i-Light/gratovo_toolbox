import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/presence/editing_target.dart';
import 'package:gratovo_toolbox/core/presence/presence_widgets.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_mutation_guard.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Stats the influencer sent us themselves — audience geography split, their
/// own analytics screenshots transcribed, whatever they volunteered.
///
/// Free-form name/value pairs rather than a fixed set of fields. No two
/// creators send the same shape, and a fixed form would mean dropping whatever
/// did not fit — which is exactly the information worth keeping, since the
/// unusual thing a creator volunteers is usually the thing that decides a
/// deal.
///
/// Labelled as reported rather than measured, always. These numbers come from
/// the person being evaluated, and mixing them in beside pipeline-measured
/// figures with no distinction is how an unverified claim ends up quoted to a
/// brand as fact.
class ProvidedDataCard extends ConsumerWidget {
  const ProvidedDataCard({
    super.key,
    required this.influencer,
    required this.l10n,
  });

  final Influencer influencer;
  final AppLocalizations l10n;

  Future<void> _save(
    BuildContext context,
    WidgetRef ref,
    Map<String, dynamic> data,
  ) {
    return guardInfluencerMutation(
      context,
      ref,
      influencer,
      action: () => ref.read(influencerRepositoryProvider).updateProvidedData(
            influencer.id,
            base: influencer.providedData,
            // An empty map is stored as null rather than `{}`: "nothing was
            // provided" and "an empty object was provided" are the same fact,
            // and one of them is a shape every reader then has to handle.
            data.isEmpty ? null : data,
          ),
      // How many fields the creator has sent us, not what is in them. The
      // values here are audience-geography splits and analytics screenshots
      // shared in confidence, and a log is read by more people and for longer
      // than the card it copies.
      log: (logger) => logger.channelProvidedDataChanged(influencer,
          fieldCount: data.length),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final data = influencer.providedData ?? const <String, dynamic>{};
    final entries = data.entries.toList()
      ..sort((a, b) => a.key.compareTo(b.key));

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: PresenceBorder(
          type: 'channel',
          id: influencer.id,
          field: 'provided_data',
          child: EditingScope(
            target: EditingTarget(
              type: 'channel',
              id: influencer.id,
              field: 'provided_data',
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.influencerProfileProvidedTitle,
                  style: theme.textTheme.titleMedium,
                ),
                const SizedBox(height: 4),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.person_outline,
                      size: 14,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        l10n.influencerProfileProvidedUnverified,
                        style: theme.textTheme.bodySmall,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                if (entries.isEmpty)
                  Text(
                    l10n.influencerProfileProvidedEmpty,
                    style: theme.textTheme.bodySmall,
                  )
                else
                  Table(
                    columnWidths: const {
                      0: FlexColumnWidth(2),
                      1: FlexColumnWidth(3),
                      2: IntrinsicColumnWidth(),
                    },
                    defaultVerticalAlignment: TableCellVerticalAlignment.middle,
                    children: [
                      for (final entry in entries)
                        TableRow(
                          children: [
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 6),
                              child: Text(
                                entry.key,
                                style: theme.textTheme.bodyMedium,
                              ),
                            ),
                            Text(
                              // Whatever shape came back, rendered as text. A
                              // nested object or list is JSON in the database
                              // and is shown as-is rather than dropped — it is
                              // still readable, and losing it would be worse.
                              '${entry.value}',
                              style: theme.textTheme.bodyMedium,
                            ),
                            IconButton(
                              tooltip: l10n.commonDelete,
                              icon: const Icon(Icons.close, size: 18),
                              onPressed: () {
                                final updated = Map<String, dynamic>.from(data)
                                  ..remove(entry.key);
                                _save(context, ref, updated);
                              },
                            ),
                          ],
                        ),
                    ],
                  ),
                const SizedBox(height: 12),
                _AddPairRow(
                  l10n: l10n,
                  onAdd: (key, value) {
                    final updated = Map<String, dynamic>.from(data)
                      ..[key] = value;
                    _save(context, ref, updated);
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AddPairRow extends StatefulWidget {
  const _AddPairRow({required this.l10n, required this.onAdd});

  final AppLocalizations l10n;
  final void Function(String key, String value) onAdd;

  @override
  State<_AddPairRow> createState() => _AddPairRowState();
}

class _AddPairRowState extends State<_AddPairRow> {
  final _key = TextEditingController();
  final _value = TextEditingController();

  @override
  void dispose() {
    _key.dispose();
    _value.dispose();
    super.dispose();
  }

  void _submit() {
    final key = _key.text.trim();
    if (key.isEmpty) return;
    widget.onAdd(key, _value.text.trim());
    _key.clear();
    _value.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          flex: 2,
          child: TextField(
            controller: _key,
            decoration: InputDecoration(
              labelText: widget.l10n.influencerProfileProvidedKey,
              isDense: true,
              border: const OutlineInputBorder(),
            ),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          flex: 3,
          child: TextField(
            controller: _value,
            decoration: InputDecoration(
              labelText: widget.l10n.influencerProfileProvidedValue,
              isDense: true,
              border: const OutlineInputBorder(),
            ),
            onSubmitted: (_) => _submit(),
          ),
        ),
        const SizedBox(width: 8),
        FilledButton(
          onPressed: _submit,
          child: Text(widget.l10n.commonAdd),
        ),
      ],
    );
  }
}
