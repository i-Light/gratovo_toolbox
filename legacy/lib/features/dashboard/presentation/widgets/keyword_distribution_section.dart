import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/features/dashboard/application/channel_analytics_controller.dart';
import 'package:gratovo_toolbox/features/dashboard/application/keyword_distribution_controller.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/widgets/channel_series_toggle.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/widgets/keyword_distribution_view.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The Dashboard's keyword-evaluation card: which search terms are pulling
/// their weight, measured by how watched the channels they found are.
///
/// Supplies [KeywordDistributionView] with its rows (from
/// [keywordDistributionProvider]) and its sort (from [keywordSortProvider]),
/// and draws nothing at all for an account that cannot see it — same shape as
/// [ChannelAnalyticsSection], one place to read for whether it appears.
class KeywordDistributionSection extends ConsumerWidget {
  const KeywordDistributionSection({super.key});

  /// The list's own scroll area. Tall enough for a page of rows; the view
  /// reveals more as it is scrolled.
  static const _listHeight = 560.0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(canSeeKeywordDistributionProvider)) {
      return const SizedBox.shrink();
    }

    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final keywords = ref.watch(keywordDistributionProvider);
    final sort = ref.watch(keywordSortProvider);
    // The same app-scoped toggles the analytics filter row drives. Reading the
    // provider here is the whole of the "sync": flip Live or Archived anywhere
    // and this list re-counts to match, with no re-fetch.
    final series = ref.watch(channelStatsSeriesProvider);

    return GratovoCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.dashboardKeywordsTitle,
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                IconButton(
                  tooltip: l10n.commonRefresh,
                  icon: const Icon(Icons.refresh),
                  onPressed: () => ref.invalidate(keywordDistributionProvider),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              l10n.dashboardKeywordsBody,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 12),
            const ChannelSeriesToggle(),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 50),
              child: SizedBox(
                height: _listHeight,
                child: keywords.when(
                  // The rows stay up while the roster is re-read after a change
                  // two screens away — same as the analytics section.
                  skipLoadingOnReload: true,
                  loading: () =>
                      const Center(child: CircularProgressIndicator()),
                  error: (_, __) => _Failed(
                    message: l10n.dashboardAnalyticsFailed,
                    retryLabel: l10n.commonRetry,
                    onRetry: () => ref.invalidate(keywordDistributionProvider),
                  ),
                  data: (rows) => KeywordDistributionView(
                    // Re-counted against the Live / Archive due / Archived
                    // toggles before it reaches the list — see
                    // [KeywordViewData.applySeries].
                    keywords: [
                      for (final row in rows)
                        row.applySeries(
                          live: series.live,
                          archiveDue: series.archiveDue,
                          archived: series.archived,
                        ),
                    ],
                    sort: sort,
                    onSortChanged: (value) =>
                        ref.read(keywordSortProvider.notifier).set(value),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Failed extends StatelessWidget {
  const _Failed({
    required this.message,
    required this.onRetry,
    required this.retryLabel,
  });

  final String message;
  final VoidCallback onRetry;
  final String retryLabel;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(child: Text(message)),
          const SizedBox(width: 8),
          TextButton(onPressed: onRetry, child: Text(retryLabel)),
        ],
      ),
    );
  }
}
