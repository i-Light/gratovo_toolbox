import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/core/widgets/notes_card.dart';
import 'package:gratovo_toolbox/data/models/brand.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/brands/presentation/widgets/brand_form_dialog.dart';
import 'package:gratovo_toolbox/features/campaigns/presentation/widgets/campaigns_section.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/deal_history_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// Contact/company details, budget & campaign brief, preferred-influencer
/// criteria, notes, and the full deal history with this brand — the
/// brand-side mirror of influencer_profile_screen.dart, cross-linked with
/// Influencers via `Deal`.
class BrandProfileScreen extends ConsumerWidget {
  const BrandProfileScreen({super.key, required this.brandId});

  final String brandId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final brandAsync = ref.watch(brandByIdProvider(brandId));

    return Scaffold(
      appBar: GradientAppBar(
        // Reached with `context.go`, so there is no page to pop — the back
        // button returns to the Roster page explicitly.
        leading: BackButton(onPressed: () => context.go(AppRoutes.roster)),
        title: brandAsync.maybeWhen(
          data: (brand) => GradientText(brand?.name ?? l10n.navBrands),
          orElse: () => GradientText(l10n.navBrands),
        ),
        actions: [
          if (brandAsync.value case final brand?)
            IconButton(
              tooltip: l10n.brandEdit,
              icon: const Icon(Icons.edit_outlined),
              onPressed: () => showBrandForm(context, initial: brand),
            ),
        ],
      ),
      body: brandAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(l10n.commonError),
              TextButton(
                onPressed: () => ref.invalidate(brandByIdProvider(brandId)),
                child: Text(l10n.commonRetry),
              ),
            ],
          ),
        ),
        data: (brand) {
          if (brand == null) {
            return Center(child: Text(l10n.brandNotFound));
          }
          return SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // HC-09, above everything: nothing on this page is to be
                // acted on for a boycotted brand.
                BrandBoycottBanner(brand: brand),
                _ContactCard(brand: brand, l10n: l10n),
                const SizedBox(height: 16),
                NotesCard(
                  initialText: brand.notes,
                  hintText: l10n.brandProfileNotesHint,
                  onSave: (text) async {
                    await ref
                        .read(brandRepositoryProvider)
                        .updateNotes(brand.id, text);
                    // The brand list behind this page shows the same record.
                    ref.bumpData(const {DataDomain.brands});
                    if (context.mounted) {
                      AppToast.success(
                          context, l10n.influencerProfileNotesSaved);
                    }
                  },
                ),
                const SizedBox(height: 16),
                // Campaigns: the organizing label above deals, so it reads
                // top-down as plan -> deals.
                CampaignsSection(brandId: brandId),
                const SizedBox(height: 16),
                DealHistoryCard.forBrand(brandId),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _ContactCard extends StatelessWidget {
  const _ContactCard({required this.brand, required this.l10n});

  final Brand brand;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.brandProfileContactTitle,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 24,
              runSpacing: 12,
              children: [
                for (final contact in brand.allContacts)
                  _Item(
                    label: [
                      if (contact.name.isNotEmpty) contact.name,
                      if (contact.role != null) contact.role!,
                    ].join(' · '),
                    value: contact.email,
                  ),
                if (brand.country != null)
                  _Item(label: l10n.brandFormCountry, value: brand.country!),
                if (brand.category != null)
                  _Item(label: l10n.brandFormCategory, value: brand.category!),
                if (brand.source == BrandSource.seenSponsoring)
                  _Item(
                      label: l10n.brandSourceLabel,
                      value: l10n.brandSourceSeen),
                if (brand.contactPhone != null)
                  _Item(
                      label: l10n.brandProfileContactPhone,
                      value: brand.contactPhone!),
                if (brand.website != null)
                  _Item(label: l10n.brandProfileWebsite, value: brand.website!),
                if (brand.budget != null)
                  _Item(
                    label: l10n.brandProfileBudget,
                    value:
                        formatCurrency(brand.budget, locale: l10n.localeName),
                  ),
              ],
            ),
            if (brand.campaignBrief != null) ...[
              const SizedBox(height: 16),
              Text(
                l10n.brandProfileCampaignBrief,
                style: Theme.of(context).textTheme.labelLarge,
              ),
              const SizedBox(height: 4),
              Text(brand.campaignBrief!),
            ],
            if (brand.preferredCriteria.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(
                l10n.brandProfilePreferredCriteriaTitle,
                style: Theme.of(context).textTheme.labelLarge,
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final criterion in brand.preferredCriteria)
                    Chip(label: Text(criterion)),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Item extends StatelessWidget {
  const _Item({required this.label, required this.value});

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
