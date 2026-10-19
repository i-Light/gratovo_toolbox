import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/core/widgets/notes_card.dart';
import 'package:gratovo_toolbox/core/widgets/status_badge.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/deals/application/deal_stage_controller.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/deal_contracts_card.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/deal_terms_dialog.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/deliverables_section.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/payment_section.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/working_days_estimate_card.dart';
import 'package:gratovo_toolbox/features/team/presentation/owner_picker.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// Two-sided pricing, the negotiation-stage pipeline (editable here — this
/// is the one screen that actually moves a deal's stage), contract link,
/// deliverables & deadline, and notes for this specific deal round. See
/// the `Deal` model for its full shape and why it's the Brand↔Influencer
/// join entity.
class DealDetailScreen extends ConsumerWidget {
  const DealDetailScreen({super.key, required this.dealId});

  final String dealId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final dealAsync = ref.watch(dealByIdProvider(dealId));

    return Scaffold(
      appBar: GradientAppBar(title: GradientText(l10n.navDeals)),
      body: dealAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(l10n.commonError),
              TextButton(
                onPressed: () => ref.invalidate(dealByIdProvider(dealId)),
                child: Text(l10n.commonRetry),
              ),
            ],
          ),
        ),
        data: (deal) {
          if (deal == null) {
            return Center(child: Text(l10n.dealNotFound));
          }
          return SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _PartiesCard(deal: deal, l10n: l10n),
                const SizedBox(height: 16),
                // Wave 2: ownership picker
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: OwnerPicker(
                    ownerId: deal.ownerId,
                    onChanged: (ownerId) async {
                      await ref
                          .read(dealRepositoryProvider)
                          .updateOwner(deal.id, ownerId);
                      ref.bumpData(const {DataDomain.deals});
                    },
                  ),
                ),
                const SizedBox(height: 16),
                _StageCard(deal: deal, l10n: l10n),
                const SizedBox(height: 16),
                _PricingCard(deal: deal, l10n: l10n),
                const SizedBox(height: 16),
                WorkingDaysEstimateCard(deal: deal),
                const SizedBox(height: 16),
                _DeliverablesCard(deal: deal, l10n: l10n),
                const SizedBox(height: 16),
                // Two contracts, in the course's order (contract-order).
                DealContractsCard(deal: deal),
                const SizedBox(height: 16),
                NotesCard(
                  initialText: deal.notes,
                  hintText: l10n.dealDetailNotesHint,
                  onSave: (text) async {
                    await ref
                        .read(dealRepositoryProvider)
                        .updateNotes(deal.id, text);
                    ref.bumpData(const {DataDomain.deals});
                    if (context.mounted) {
                      AppToast.success(
                          context, l10n.influencerProfileNotesSaved);
                    }
                  },
                ),
                const SizedBox(height: 16),
                // Deliverables (per-item tracking)
                DeliverablesSection(dealId: deal.id),
                const SizedBox(height: 12),
                _Timestamps(deal: deal, l10n: l10n),
                const SizedBox(height: 16),
                // Payment tracking
                PaymentSection(deal: deal),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _PartiesCard extends ConsumerWidget {
  const _PartiesCard({required this.deal, required this.l10n});

  final Deal deal;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final brandAsync = ref.watch(brandByIdProvider(deal.brandId));
    final influencerAsync =
        ref.watch(influencerByIdProvider(deal.influencerId));

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.dealDetailPartiesTitle,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.business_outlined),
              title: Text(l10n.dealDetailBrandLabel),
              subtitle: Text(
                brandAsync.maybeWhen(
                  data: (brand) => brand?.name ?? deal.brandId,
                  orElse: () => deal.brandId,
                ),
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.go(AppRoutes.brandDetail(deal.brandId)),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.person_outline),
              title: Text(l10n.dealDetailInfluencerLabel),
              subtitle: Text(
                influencerAsync.maybeWhen(
                  data: (influencer) => influencer?.handle ?? deal.influencerId,
                  orElse: () => deal.influencerId,
                ),
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () =>
                  context.go(AppRoutes.influencerDetail(deal.influencerId)),
            ),
          ],
        ),
      ),
    );
  }
}

class _StageCard extends ConsumerWidget {
  const _StageCard({required this.deal, required this.l10n});

  final Deal deal;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Expanded(
              child: Text(
                l10n.dealDetailStageLabel,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            DropdownButton<DealStage>(
              value: deal.stage,
              underline: const SizedBox.shrink(),
              items: [
                for (final stage in DealStage.values)
                  DropdownMenuItem(
                    value: stage,
                    child: StatusBadge(
                      label: stage.label(l10n),
                      color: stage.color(context),
                    ),
                  ),
              ],
              onChanged: (stage) async {
                if (stage == null || stage == deal.stage) return;
                // Through the controller (not the repository directly) so a
                // fresh close also records the channel's rate-history entry.
                await ref
                    .read(dealStageControllerProvider)
                    .updateStage(deal, stage);
                // This deal, both lists it appears on, the influencer's
                // latest-stage badge and the dashboard's negotiation count all
                // read deals; none of them has to be named here.
                ref.bumpData(const {DataDomain.deals});
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _PricingCard extends StatelessWidget {
  const _PricingCard({required this.deal, required this.l10n});

  final Deal deal;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
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
                    l10n.dealDetailPricingTitle,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                IconButton(
                  tooltip: l10n.dealEditTerms,
                  icon: const Icon(Icons.edit_outlined, size: 20),
                  onPressed: () => showDealTermsDialog(context, deal),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 24,
              runSpacing: 12,
              children: [
                _Stat(
                  label: l10n.dealDetailBrandPays,
                  value:
                      formatCurrency(deal.brandPrice, locale: l10n.localeName),
                ),
                _Stat(
                  label: l10n.dealDetailInfluencerReceives,
                  value: formatCurrency(deal.influencerPayout,
                      locale: l10n.localeName),
                ),
                _Stat(
                  label: l10n.dealDetailMargin,
                  value: formatCurrency(deal.margin, locale: l10n.localeName),
                ),
              ],
            ),
            const SizedBox(height: 12),
            // No default: payment terms are set per deal (payment-terms).
            Text(deal.paymentTerms == null
                ? l10n.dealPaymentTermsNone
                : l10n.dealPaymentTermsLine(deal.paymentTerms!)),
            if (deal.trackingLink != null)
              SelectableText(l10n.dealTrackingLinkLine(deal.trackingLink!)),
          ],
        ),
      ),
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
        Text(value, style: Theme.of(context).textTheme.titleMedium),
        Text(label, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}

class _DeliverablesCard extends ConsumerWidget {
  const _DeliverablesCard({required this.deal, required this.l10n});

  final Deal deal;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fmt = ref.watch(instantFormatterProvider);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.dealDetailDeliverablesTitle,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(deal.deliverables ?? '—'),
            const SizedBox(height: 12),
            Text(
              l10n.dealDetailDeadlineLabel,
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: 4),
            Text(
              deal.deadline != null
                  ? fmt.date(deal.deadline!)
                  : l10n.dealDetailNoDeadline,
            ),
          ],
        ),
      ),
    );
  }
}

class _Timestamps extends ConsumerWidget {
  const _Timestamps({required this.deal, required this.l10n});

  final Deal deal;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fmt = ref.watch(instantFormatterProvider);
    return Text(
      '${l10n.dealDetailCreatedAt(fmt.date(deal.createdAt))} · '
      '${l10n.dealDetailUpdatedAt(fmt.date(deal.updatedAt))}',
      style: Theme.of(context).textTheme.bodySmall,
    );
  }
}
