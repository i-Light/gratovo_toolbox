import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/core/widgets/status_badge.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// One row in the team-wide Deal list: brand name, influencer handle,
/// margin, and the stage badge. Resolves the brand/influencer names
/// independently via their own providers so one slow lookup never blocks
/// the rest of the list.
class DealListTile extends ConsumerWidget {
  const DealListTile({super.key, required this.deal});

  final Deal deal;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final brandAsync = ref.watch(brandByIdProvider(deal.brandId));
    final influencerAsync =
        ref.watch(influencerByIdProvider(deal.influencerId));

    final brandName = brandAsync.maybeWhen(
      data: (brand) => brand?.name ?? deal.brandId,
      orElse: () => deal.brandId,
    );
    final influencerHandle = influencerAsync.maybeWhen(
      data: (influencer) => influencer?.handle ?? deal.influencerId,
      orElse: () => deal.influencerId,
    );

    return Card(
      child: ListTile(
        onTap: () => context.go(AppRoutes.dealDetail(deal.id)),
        title: Text('$brandName × $influencerHandle'),
        subtitle: Text(
          '${formatCurrency(deal.brandPrice, locale: l10n.localeName)} → '
          '${formatCurrency(deal.influencerPayout, locale: l10n.localeName)} '
          '(${l10n.dealDetailMargin}: ${formatCurrency(deal.margin, locale: l10n.localeName)})',
        ),
        trailing: StatusBadge(
          label: deal.stage.label(l10n),
          color: deal.stage.color(context),
        ),
      ),
    );
  }
}
