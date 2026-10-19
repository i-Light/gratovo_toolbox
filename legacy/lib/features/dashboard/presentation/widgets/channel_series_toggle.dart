import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/features/dashboard/application/channel_analytics_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The "Live" / "Archive due" / "Archived" series checkboxes, bound to
/// [channelStatsSeriesProvider].
///
/// Lifted out of the analytics card's chart legend so the one pair of toggles
/// can sit wherever it earns its place — in the analytics filter row (and the
/// pinned copy of it under the app bar, so it stays reachable once the section
/// has scrolled away), and in the keyword-evaluation card. Every instance reads
/// and writes the same app-scoped provider, so they move in lock-step with no
/// wiring between them.
///
/// It never touches the query, so nothing is re-fetched when a box flips — the
/// series is dropped from or restored to what is already loaded.
class ChannelSeriesToggle extends ConsumerWidget {
  const ChannelSeriesToggle({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final series = ref.watch(channelStatsSeriesProvider);
    final notifier = ref.read(channelStatsSeriesProvider.notifier);

    Widget box(
      Color color,
      String label,
      bool value,
      ValueChanged<bool> onChanged,
    ) {
      return InkWell(
        onTap: () => onChanged(!value),
        borderRadius: BorderRadius.circular(4),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 2, horizontal: 2),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 24,
                height: 24,
                child: Checkbox(
                  value: value,
                  activeColor: color,
                  visualDensity: VisualDensity.compact,
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  onChanged: (v) => onChanged(v ?? false),
                ),
              ),
              const SizedBox(width: 6),
              Text(label, style: theme.textTheme.bodySmall),
            ],
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsetsGeometry.symmetric(horizontal: 50),
      child: Wrap(
        spacing: 12,
        runSpacing: 4,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          box(
            theme.colorScheme.primary,
            l10n.dashboardAnalyticsLegendLive,
            series.live,
            notifier.setLive,
          ),
          box(
            AppColors.archiveDueSeries,
            l10n.dashboardAnalyticsLegendArchiveDue,
            series.archiveDue,
            notifier.setArchiveDue,
          ),
          box(
            AppColors.archivedSeries,
            l10n.dashboardAnalyticsLegendArchived,
            series.archived,
            notifier.setArchived,
          ),
        ],
      ),
    );
  }
}
