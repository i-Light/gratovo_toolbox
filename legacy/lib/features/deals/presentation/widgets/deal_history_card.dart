import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/core/widgets/status_badge.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/start_deal_dialog.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// Which party's profile page the card sits on. The list shows the deals of
/// that party, and each row is titled with the *other* party — a brand's
/// history names influencers, an influencer's names brands.
enum _Party { brand, influencer }

/// The "Deal history" card on a profile page: every deal this brand or
/// influencer has been part of, newest first, each row opening the deal.
class DealHistoryCard extends ConsumerWidget {
  const DealHistoryCard.forBrand(this.id, {super.key}) : _party = _Party.brand;

  const DealHistoryCard.forInfluencer(this.id, {super.key})
      : _party = _Party.influencer;

  /// The brand's or influencer's id, per the constructor used.
  final String id;
  final _Party _party;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final dealsAsync = ref.watch(switch (_party) {
      _Party.brand => dealsByBrandProvider(id),
      _Party.influencer => dealsByInfluencerProvider(id),
    });

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.influencerProfileDealHistoryTitle,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                if (_party == _Party.influencer)
                  if (ref.watch(influencerByIdProvider(id)).value
                      case final creator?)
                    TextButton.icon(
                      onPressed: () =>
                          showStartDealDialog(context, creator: creator),
                      icon: const Icon(Icons.handshake_outlined),
                      label: Text(l10n.dealStart),
                    ),
              ],
            ),
            const SizedBox(height: 8),
            dealsAsync.when(
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (error, stackTrace) => Text(l10n.commonError),
              data: (deals) {
                if (deals.isEmpty) {
                  return Text(switch (_party) {
                    _Party.brand => l10n.brandProfileDealHistoryEmpty,
                    _Party.influencer => l10n.influencerProfileNoDeals,
                  });
                }
                return Column(
                  children: [
                    for (final deal in deals)
                      _DealHistoryTile(deal: deal, party: _party),
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

class _DealHistoryTile extends ConsumerWidget {
  const _DealHistoryTile({required this.deal, required this.party});

  final Deal deal;
  final _Party party;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    // The other side of the deal, falling back to its id until (or unless)
    // the record loads.
    final counterparty = switch (party) {
      _Party.brand =>
        ref.watch(influencerByIdProvider(deal.influencerId)).maybeWhen(
              data: (influencer) => influencer?.handle ?? deal.influencerId,
              orElse: () => deal.influencerId,
            ),
      _Party.influencer => ref.watch(brandByIdProvider(deal.brandId)).maybeWhen(
            data: (brand) => brand?.name ?? deal.brandId,
            orElse: () => deal.brandId,
          ),
    };

    return ListTile(
      contentPadding: EdgeInsets.zero,
      onTap: () => context.go(AppRoutes.dealDetail(deal.id)),
      title: Text(counterparty),
      subtitle: Text(
        '${formatCurrency(deal.brandPrice, locale: l10n.localeName)} → '
        '${formatCurrency(deal.influencerPayout, locale: l10n.localeName)} · '
        '${fmt.date(deal.updatedAt)}',
      ),
      trailing: StatusBadge(
        label: deal.stage.label(l10n),
        color: deal.stage.color(context),
      ),
    );
  }
}
