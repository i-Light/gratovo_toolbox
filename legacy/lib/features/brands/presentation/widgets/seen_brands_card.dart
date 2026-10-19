import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/widgets/collapsible_card.dart';
import 'package:gratovo_toolbox/data/models/agency_settings.dart';
import 'package:gratovo_toolbox/data/models/brand.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/brands/application/boycott_check.dart';
import 'package:gratovo_toolbox/features/brands/application/seen_brands.dart';
import 'package:gratovo_toolbox/features/brands/presentation/widgets/brand_form_dialog.dart';
import 'package:gratovo_toolbox/features/settings/application/agency_settings_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The brands the pipeline found in creators' videos (fix #6), cleaned.
final seenBrandsProvider = FutureProvider<List<SeenBrand>>((ref) async {
  ref.watch(dataRevisionProvider(DataDomain.channels));
  final sightings =
      await ref.watch(influencerRepositoryProvider).sponsorSightings();
  return aggregateSeenBrands(sightings);
});

/// Roster -> Brands: "Brands seen sponsoring" — who sponsors the creators we
/// track, on how many channels, and one click to make any of them a brand
/// record. Brands that already have one say so; boycotted ones (HC-09) say
/// that instead.
class SeenBrandsCard extends ConsumerStatefulWidget {
  const SeenBrandsCard({super.key});

  @override
  ConsumerState<SeenBrandsCard> createState() => _SeenBrandsCardState();
}

class _SeenBrandsCardState extends ConsumerState<SeenBrandsCard> {
  static const _shortList = 20;
  bool _showAll = false;

  static String _key(String text) =>
      text.toLowerCase().replaceAll(RegExp('[^a-z0-9]'), '');

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final seen = ref.watch(seenBrandsProvider).value ?? const <SeenBrand>[];
    final saved = {
      for (final brand in ref.watch(allBrandsProvider).value ?? const [])
        _key(brand.name),
    };
    final agency =
        ref.watch(agencySettingsProvider).value ?? const AgencySettings();
    final channelCount = {for (final b in seen) ...b.channelIds}.length;
    final shown = _showAll ? seen : seen.take(_shortList).toList();
    final summary = l10n.seenBrandsSummary(seen.length, channelCount);

    return CollapsibleCard(
      title: l10n.seenBrandsTitle,
      subtitle: l10n.seenBrandsSubtitle,
      initiallyExpanded: false,
      collapsedSummary: Text(summary, style: theme.textTheme.bodySmall),
      child: seen.isEmpty
          ? Text(l10n.seenBrandsEmpty, style: theme.textTheme.bodySmall)
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(summary, style: theme.textTheme.bodySmall),
                for (final brand in shown)
                  _SeenBrandRow(
                    brand: brand,
                    saved: saved.contains(_key(brand.name)),
                    boycott: boycottHit(
                      Brand(id: '', name: brand.name, createdAt: DateTime(0)),
                      agency,
                    ),
                    l10n: l10n,
                  ),
                if (seen.length > _shortList)
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: TextButton(
                      onPressed: () => setState(() => _showAll = !_showAll),
                      child: Text(_showAll
                          ? l10n.seenBrandsShowFewer
                          : l10n.seenBrandsShowAll(seen.length)),
                    ),
                  ),
              ],
            ),
    );
  }
}

class _SeenBrandRow extends ConsumerWidget {
  const _SeenBrandRow({
    required this.brand,
    required this.saved,
    required this.boycott,
    required this.l10n,
  });

  final SeenBrand brand;
  final bool saved;
  final BoycottHit? boycott;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final handles = brand.handles.take(4).join(', ') +
        (brand.handles.length > 4 ? ', …' : '');
    final latest = brand.latestUploadAt;
    final hit = boycott;

    final Widget trailing;
    if (hit != null) {
      trailing = Tooltip(
        message: boycottMessage(l10n, hit),
        child: Icon(Icons.block,
            color: theme.colorScheme.error,
            semanticLabel: boycottMessage(l10n, hit)),
      );
    } else if (saved) {
      trailing = Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ExcludeSemantics(
            child:
                Icon(Icons.check, size: 18, color: theme.colorScheme.primary),
          ),
          const SizedBox(width: 4),
          Text(l10n.seenBrandsSaved),
        ],
      );
    } else {
      trailing = TextButton(
        onPressed: () => showBrandForm(
          context,
          prefill: Brand(
            id: '',
            name: brand.name,
            createdAt: DateTime.now().toUtc(),
            source: BrandSource.seenSponsoring,
          ),
        ),
        child: Text(l10n.seenBrandsCreate),
      );
    }

    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(brand.name),
      subtitle: Text(
        [
          l10n.seenBrandsChannels(brand.channelIds.length, handles),
          if (latest != null) l10n.seenBrandsLatest(fmt.date(latest)),
        ].join('\n'),
      ),
      isThreeLine: latest != null,
      trailing: trailing,
    );
  }
}
