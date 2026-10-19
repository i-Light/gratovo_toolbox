import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/deals/application/deal_filter_controller.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/deal_list_tile.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Every Deal across the whole team, not scoped to one influencer or
/// brand — filterable by stage, most-recently-updated first. Tapping a row
/// routes to `/deals/:id` (deal_detail_screen.dart).
class DealListScreen extends ConsumerWidget {
  const DealListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final dealsAsync = ref.watch(allDealsProvider);
    final stageFilter = ref.watch(dealFilterProvider);

    return Scaffold(
        appBar: GradientAppBar(title: GradientText(l10n.navDeals)),
        body: GradientBackdrop(
          colors: const [
            AppColors.brandNavy,
            AppColors.primaryDark,
            AppColors.info
          ],
          fade: false,
          strength: 0.2,
          from: Alignment.topCenter,
          extent: 1,
          child: Column(
            children: [
              _StageFilterBar(selected: stageFilter, l10n: l10n),
              Expanded(
                child: dealsAsync.when(
                  skipLoadingOnReload: true,
                  loading: () =>
                      const Center(child: CircularProgressIndicator()),
                  error: (error, stackTrace) => Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(l10n.commonError),
                        TextButton(
                          onPressed: () => ref.invalidate(allDealsProvider),
                          child: Text(l10n.commonRetry),
                        ),
                      ],
                    ),
                  ),
                  data: (deals) {
                    final visible = applyDealFilter(deals, stageFilter);
                    if (visible.isEmpty) {
                      return Center(child: Text(l10n.dealListEmpty));
                    }
                    return ListView.builder(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                      itemCount: visible.length,
                      itemBuilder: (context, index) =>
                          DealListTile(deal: visible[index]),
                    );
                  },
                ),
              ),
            ],
          ),
        ));
  }
}

class _StageFilterBar extends ConsumerWidget {
  const _StageFilterBar({required this.selected, required this.l10n});

  final DealStage? selected;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifier = ref.read(dealFilterProvider.notifier);

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Wrap(
          spacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            ChoiceChip(
              label: Text(l10n.influencerListFilterAll),
              selected: selected == null,
              onSelected: (_) => notifier.setStage(null),
            ),
            for (final stage in DealStage.values)
              ChoiceChip(
                label: Text(stage.label(l10n)),
                selected: selected == stage,
                onSelected: (_) => notifier.setStage(stage),
              ),
          ],
        ),
      ),
    );
  }
}
