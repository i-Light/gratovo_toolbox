import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/data/models/brand.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/brands/application/boycott_check.dart';
import 'package:gratovo_toolbox/features/brands/presentation/widgets/brand_form_dialog.dart';
import 'package:gratovo_toolbox/features/brands/presentation/widgets/seen_brands_card.dart';
import 'package:gratovo_toolbox/features/roster/presentation/widgets/roster_section_switcher.dart';
import 'package:gratovo_toolbox/features/settings/application/agency_settings_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// List of brand/client records. Tapping a row routes to `/brands/:id`
/// (brand_profile_screen.dart).
class BrandListScreen extends ConsumerWidget {
  const BrandListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final brandsAsync = ref.watch(allBrandsProvider);

    return Scaffold(
      appBar: const GradientAppBar(title: RosterSectionSwitcher()),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => showBrandForm(context),
        icon: const Icon(Icons.add_business_outlined),
        label: Text(l10n.brandNew),
      ),
      body: brandsAsync.when(
        skipLoadingOnReload: true,
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(l10n.commonError),
              TextButton(
                onPressed: () => ref.invalidate(allBrandsProvider),
                child: Text(l10n.commonRetry),
              ),
            ],
          ),
        ),
        data: (brands) {
          final sorted = [...brands]..sort((a, b) => a.name.compareTo(b.name));
          // The seen-sponsoring card sits first: it is where new brands come
          // from, and stays useful while the list itself is still empty.
          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: sorted.length + 1 + (sorted.isEmpty ? 1 : 0),
            itemBuilder: (context, index) {
              if (index == 0) return const SeenBrandsCard();
              if (sorted.isEmpty) {
                return Padding(
                  padding: const EdgeInsets.all(24),
                  child: Center(child: Text(l10n.brandListEmpty)),
                );
              }
              return _BrandTile(brand: sorted[index - 1]);
            },
          );
        },
      ),
    );
  }
}

class _BrandTile extends ConsumerWidget {
  const _BrandTile({required this.brand});

  final Brand brand;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final agency = ref.watch(agencySettingsProvider).value;
    final hit = agency == null ? null : boycottHit(brand, agency);

    return Card(
      child: ListTile(
        onTap: () => context.go(AppRoutes.brandDetail(brand.id)),
        leading: CircleAvatar(
          backgroundColor: Theme.of(context).colorScheme.primaryContainer,
          child: Text(brand.name.isEmpty ? '?' : brand.name[0].toUpperCase()),
        ),
        title: Text(brand.name),
        // HC-09: an icon with the words as its label, never colour alone.
        trailing: hit == null
            ? null
            : Tooltip(
                message: boycottMessage(l10n, hit),
                child: Icon(
                  Icons.block,
                  color: Theme.of(context).colorScheme.error,
                  semanticLabel: boycottMessage(l10n, hit),
                ),
              ),
        subtitle: Text(
          brand.budget != null
              ? '${brand.primaryContact?.name ?? ''} · ${formatCurrency(brand.budget, locale: l10n.localeName)}'
              : brand.primaryContact?.name ?? '',
        ),
      ),
    );
  }
}
