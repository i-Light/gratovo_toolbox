import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/data/models/news_item.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/news/application/news_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The feed list, on wide layouts: filter by source, and see which feeds are
/// actually working.
///
/// A failing feed is shown as failing, with the reason. That is the whole
/// reason this panel exists rather than a plain dropdown — a feed whose
/// certificate expired, or that moved its URL, produces exactly the same
/// symptom as a quiet week (no new stories), and without this nobody finds out
/// for months.
class NewsSourcesPanel extends ConsumerWidget {
  const NewsSourcesPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final sourcesAsync = ref.watch(newsSourcesProvider);
    final filter = ref.watch(newsFilterProvider);
    final notifier = ref.read(newsFilterProvider.notifier);

    return sourcesAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, stackTrace) => Center(child: Text(l10n.commonError)),
      data: (sources) => ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: Text(
              l10n.newsSourcesTitle,
              style: theme.textTheme.labelLarge,
            ),
          ),
          ListTile(
            dense: true,
            selected: filter.isUnfiltered,
            title: Text(l10n.newsAllSources),
            onTap: notifier.showAll,
          ),
          for (final source in sources)
            _SourceTile(
              source: source,
              selected: filter.sourceId == source.id,
              l10n: l10n,
              onTap: () => notifier.showSource(source.id),
            ),
        ],
      ),
    );
  }
}

class _SourceTile extends ConsumerWidget {
  const _SourceTile({
    required this.source,
    required this.selected,
    required this.l10n,
    required this.onTap,
  });

  final NewsSource source;
  final bool selected;
  final AppLocalizations l10n;
  final VoidCallback onTap;

  Future<void> _confirmRemove(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(source.displayName),
        content: Text(l10n.newsRemoveSourceConfirm),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.commonCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.commonDelete),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    await ref.read(newsRepositoryProvider).removeSource(source.id);
    // The stories go with the feed (the foreign key cascades), so both have
    // to be re-read — and the filter may now point at a source that is gone.
    ref
      ..invalidate(newsSourcesProvider)
      ..invalidate(newsItemsProvider);
    ref.read(newsFilterProvider.notifier).showAll();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final fmt = ref.watch(instantFormatterProvider);

    final subtitle = <String>[
      if (!source.enabled) l10n.newsSourceDisabled,
      if (source.lastFetchedAt == null)
        l10n.newsSourceNeverFetched
      else
        l10n.newsSourceLastFetched(fmt.date(source.lastFetchedAt!)),
    ].join('  ·  ');

    return ListTile(
      dense: true,
      selected: selected,
      onTap: onTap,
      title: Text(
        source.displayName,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          // A disabled feed is dimmed rather than hidden: it is still there,
          // its stories are still readable, and hiding it makes "why is this
          // source gone" a question with no visible answer.
          color: source.enabled ? null : theme.colorScheme.onSurfaceVariant,
        ),
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(subtitle, style: theme.textTheme.bodySmall),
          if (source.isFailing && source.lastFetchError != null)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                source.lastFetchError!,
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.error),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
        ],
      ),
      leading: source.isFailing
          ? Tooltip(
              message: l10n.newsSourceFailing,
              child: Icon(
                Icons.error_outline,
                size: 18,
                color: theme.colorScheme.error,
              ),
            )
          : const Icon(Icons.rss_feed, size: 18),
      trailing: PopupMenuButton<String>(
        icon: const Icon(Icons.more_vert, size: 18),
        itemBuilder: (context) => [
          PopupMenuItem(
            value: 'toggle',
            child: Text(source.enabled
                ? l10n.newsSourceDisable
                : l10n.newsSourceEnable),
          ),
          PopupMenuItem(
            value: 'remove',
            child: Text(l10n.newsRemoveSource),
          ),
        ],
        onSelected: (action) async {
          if (action == 'toggle') {
            await ref
                .read(newsRepositoryProvider)
                .setSourceEnabled(source.id, !source.enabled);
            ref.invalidate(newsSourcesProvider);
          } else if (action == 'remove' && context.mounted) {
            await _confirmRemove(context, ref);
          }
        },
      ),
    );
  }
}
