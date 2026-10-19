import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/data/models/channel_rate_history_entry.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// One channel's closed-deal rate history, newest first.
///
/// Written by `DealStageController` the moment a deal for this channel first
/// closes (see that class's doc comment), never edited after — see
/// [ChannelRateHistoryEntry]'s own doc comment. Watches [DataDomain.deals]
/// rather than a domain of its own: every write here happens inside the same
/// call that already bumps deals, so a second domain would only be one more
/// thing a future writer has to remember to bump.
final _rateHistoryForChannelProvider =
    FutureProvider.family<List<ChannelRateHistoryEntry>, String>(
  (ref, channelId) {
    ref.watch(dataRevisionProvider(DataDomain.deals));
    return ref
        .watch(channelRateHistoryRepositoryProvider)
        .getForChannel(channelId);
  },
);

/// The "Rate history" card on a channel's profile: every closed-deal rate
/// this channel has actually gone for before — what the team prices a new
/// proposal against.
class RateHistoryCard extends ConsumerWidget {
  const RateHistoryCard({super.key, required this.channelId});

  final String channelId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final historyAsync = ref.watch(_rateHistoryForChannelProvider(channelId));

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.rateHistoryTitle,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            historyAsync.when(
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (error, stackTrace) => Text(l10n.commonError),
              data: (entries) {
                if (entries.isEmpty) {
                  return Text(l10n.rateHistoryEmpty);
                }
                return Column(
                  children: [
                    for (var i = 0; i < entries.length; i++) ...[
                      if (i > 0) const Divider(height: 24),
                      _RateHistoryTile(entry: entries[i]),
                    ],
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _RateHistoryTile extends ConsumerWidget {
  const _RateHistoryTile({required this.entry});

  final ChannelRateHistoryEntry entry;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final fmt = ref.watch(instantFormatterProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 20,
          runSpacing: 8,
          children: [
            _Stat(
              label: l10n.dealDetailBrandPays,
              value: formatCurrency(entry.brandPrice, locale: l10n.localeName),
            ),
            _Stat(
              label: l10n.dealDetailInfluencerReceives,
              value: formatCurrency(entry.influencerPayout,
                  locale: l10n.localeName),
            ),
            _Stat(
              label: l10n.dealDetailMargin,
              value: formatCurrency(entry.margin, locale: l10n.localeName),
            ),
            _Stat(
              label: l10n.rateHistoryMedianViewsLabel,
              value: entry.medianViewsAtDeal != null
                  ? formatCompact(entry.medianViewsAtDeal,
                      locale: l10n.localeName)
                  : l10n.rateHistoryViewsNotMeasured,
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          fmt.date(entry.closedAt),
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(value, style: Theme.of(context).textTheme.titleSmall),
        Text(label, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}
