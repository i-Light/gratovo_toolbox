import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/native/url_launcher_provider.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/data/models/archived_channel.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/archive/application/archive_controller.dart';
import 'package:gratovo_toolbox/features/archive/presentation/widgets/bulk_clean_dialog.dart';
import 'package:gratovo_toolbox/features/roster/presentation/widgets/roster_section_switcher.dart';
import 'package:gratovo_toolbox/features/search/application/reenrich_run_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// What is left of the channels the team rejected.
///
/// Read-only by construction. There is no edit here and no restore button,
/// because there is nothing to restore: archiving deleted the videos, notes and
/// contacts, and this page holds the only six facts that survived. The one way
/// back is adding the channel again by hand from the Influencers page, which
/// starts it over as a new channel — said out loud at the bottom of the page
/// rather than left for someone to discover.
class ArchiveScreen extends ConsumerWidget {
  const ArchiveScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final query = ref.watch(archiveFilterProvider);
    final page = ref.watch(archivePageProvider(query));
    final total = ref.watch(archiveCountProvider);

    return Scaffold(
      appBar: GradientAppBar(
        title: const RosterSectionSwitcher(),
        actions: [
          // Full authority only. The database refuses anyone else anyway — see
          // canBulkCleanProvider for why the button is hidden rather than left
          // to fail.
          if (ref.watch(canBulkCleanProvider))
            TextButton.icon(
              icon: const Icon(Icons.cleaning_services_outlined, size: 18),
              label: Text(l10n.archiveBulkCleanAction),
              onPressed: () => _runBulkClean(context, ref, query),
            ),
          IconButton(
            tooltip: l10n.commonRefresh,
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.invalidate(archiveCountProvider);
              ref.read(archivePageProvider(query).notifier).refresh();
            },
          ),
        ],
      ),
      body: Column(
        children: [
          _Header(
            l10n: l10n,
            total: total.value,
          ),
          _Controls(l10n: l10n, query: query),
          const Divider(height: 1),
          Expanded(
            child: page.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (_, __) => _Message(text: l10n.archiveLoadFailed),
              data: (state) {
                if (state.items.isEmpty) {
                  // Two genuinely different situations that must not read the
                  // same: an archive that has never held anything, and a filter
                  // that happens to match nothing.
                  final filtered =
                      query.search.trim().isNotEmpty || query.label != null;
                  return _Message(
                    text: filtered ? l10n.archiveNoMatches : l10n.archiveEmpty,
                    hint: filtered ? null : l10n.archiveEmptyHint,
                  );
                }
                return _ArchiveList(l10n: l10n, query: query, state: state);
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// Opens the bulk clean, and reconciles the page with whatever it did.
///
/// Both providers are invalidated on the way back, not just the list: an
/// immediate clean moves rows INTO the archive, so the total in the header is
/// as stale as the list under it, and refreshing one without the other leaves a
/// count that disagrees with what is on screen.
Future<void> _runBulkClean(
  BuildContext context,
  WidgetRef ref,
  ArchiveQuery query,
) async {
  // The dialog already knows which of its two modes ran and picks its own
  // wording, so what comes back here is the finished sentence rather than an
  // outcome this caller would have to know two shapes of.
  final message = await showBulkCleanDialog(context);
  if (message == null) return;

  // A bulk clean both writes archive rows and rejects the channels behind
  // them, so both kinds of reader are told.
  ref.bumpData(const {DataDomain.archive, DataDomain.channels});
  await ref.read(archivePageProvider(query).notifier).refresh();
  if (!context.mounted) return;
  AppToast.success(context, message);
}

/// Changes the rejecting label on one archived row.
///
/// The reason is a correction of the record, not a rewrite of it — see
/// [ArchiveRepository.updateLabel]. A `no-op` when [next] is what the row
/// already carries so an accidental re-pick of the current reason costs
/// nothing.
Future<void> _changeReason(
  BuildContext context,
  WidgetRef ref,
  ArchivedChannel entry,
  ChannelTag next,
  ArchiveQuery query,
) async {
  if (next == entry.label) return;
  final l10n = AppLocalizations.of(context);
  try {
    await ref
        .read(archiveRepositoryProvider)
        .updateLabel(entry.channelId, next);
  } catch (_) {
    if (!context.mounted) return;
    AppToast.error(context, l10n.archiveReasonChangeFailed);
    return;
  }
  // The row may no longer match an active reason filter; the debounced
  // re-read in `ArchivePageNotifier` drops it on this bump.
  ref.bumpData(const {DataDomain.archive});
  await ref.read(archivePageProvider(query).notifier).refresh();
  if (!context.mounted) return;
  AppToast.success(context, l10n.archiveReasonChanged(next.label(l10n)));
}

/// Removes the tombstone for [entry] and queues a single-channel enrichment,
/// so the channel comes back to the Influencers list as a fresh find.
///
/// The re-enrich run is started FIRST: if the pipeline is busy (a search, a
/// backfill or another re-enrich already going) it throws, and the channel is
/// left in the archive so the action stays retryable. Only once the run has
/// launched is the tombstone lifted — `search.py --refetch` clears the local
/// copy of it too, so the two deletes are idempotent.
Future<void> _freeChannel(
  BuildContext context,
  WidgetRef ref,
  ArchivedChannel entry,
  ArchiveQuery query,
) async {
  final l10n = AppLocalizations.of(context);

  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(l10n.archiveFreeConfirmTitle(entry.handle)),
      content: Text(l10n.archiveFreeConfirmBody),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: Text(l10n.commonCancel),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(l10n.archiveFreeConfirmAction),
        ),
      ],
    ),
  );
  if (confirmed != true) return;

  try {
    await ref
        .read(reenrichRunControllerProvider.notifier)
        .run(handle: entry.handle);
  } on StateError {
    if (!context.mounted) return;
    AppToast.warning(context, l10n.archiveFreeBusy);
    return;
  } catch (_) {
    if (!context.mounted) return;
    AppToast.error(context, l10n.archiveFreeFailed);
    return;
  }

  try {
    await ref.read(archiveRepositoryProvider).unarchive(entry.channelId);
  } catch (_) {
    // The run is already going and `search.py --refetch` lifts the local
    // tombstone itself; a failed server delete here just means the row lingers
    // until the next sync. Not worth interrupting the person over.
  }
  ref.bumpData(const {DataDomain.archive, DataDomain.channels});
  await ref.read(archivePageProvider(query).notifier).refresh();
  if (!context.mounted) return;
  AppToast.success(context, l10n.archiveFreeStarted(entry.handle));
}

class _Header extends StatelessWidget {
  const _Header({required this.l10n, required this.total});

  final AppLocalizations l10n;
  final int? total;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (total != null)
            Text(
              l10n.archiveHoldingCount(total!),
              style: theme.textTheme.titleMedium,
            ),
          const SizedBox(height: 4),
          // Stated on the page, not just in the migration's comments. Someone
          // arriving here wondering where a channel's notes went deserves the
          // answer where they are looking.
          Text(
            l10n.archiveExplanation,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

class _Controls extends ConsumerWidget {
  const _Controls({required this.l10n, required this.query});

  final AppLocalizations l10n;
  final ArchiveQuery query;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.read(archiveFilterProvider.notifier);

    // A Wrap, not a Row: a search box, two dropdowns and a direction toggle do
    // not fit side by side at phone width, and a Row cannot shrink a TextField
    // below its intrinsic width — it overflows instead.
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Wrap(
        spacing: 12,
        runSpacing: 12,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          SizedBox(
            width: 440,
            child: TextField(
              decoration: InputDecoration(
                hintText: l10n.archiveSearchHint,
                prefixIcon: const Icon(Icons.search, size: 18),
                isDense: true,
                border: const OutlineInputBorder(),
              ),
              onChanged: filter.setSearch,
            ),
          ),
          // Bounded and ellipsized. A dropdown sizes itself to its widest item,
          // and an unbounded one is what overflowed the Logs page's actor
          // filter by 199px at phone width.
          SizedBox(
            width: 250,
            child: DropdownButtonFormField<ChannelTag?>(
              initialValue: query.label,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: l10n.archiveFilterLabel,
                isDense: true,
                border: const OutlineInputBorder(),
              ),
              items: [
                DropdownMenuItem(
                  value: null,
                  child: Text(
                    l10n.archiveFilterAllLabels,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                for (final tag in ChannelTag.rejecting)
                  DropdownMenuItem(
                    value: tag,
                    child:
                        Text(tag.label(l10n), overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: filter.setLabel,
            ),
          ),
          SizedBox(
            width: 250,
            child: DropdownButtonFormField<ArchiveSortBy>(
              initialValue: query.sortBy,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: l10n.archiveSortLabel,
                isDense: true,
                border: const OutlineInputBorder(),
              ),
              items: [
                for (final sort in ArchiveSortBy.values)
                  DropdownMenuItem(
                    value: sort,
                    child: Text(
                      switch (sort) {
                        ArchiveSortBy.archivedAt => l10n.archiveSortArchivedAt,
                        ArchiveSortBy.handle => l10n.archiveSortHandle,
                        ArchiveSortBy.subscribers =>
                          l10n.archiveSortSubscribers,
                        ArchiveSortBy.medianViews =>
                          l10n.archiveSortAverageViews,
                        ArchiveSortBy.videosFound => l10n.archiveSortVideos,
                      },
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: (sort) {
                if (sort != null) filter.setSort(sort);
              },
            ),
          ),
          IconButton(
            tooltip: query.descending
                ? l10n.commonSortDescending
                : l10n.commonSortAscending,
            icon: Icon(
              query.descending ? Icons.arrow_downward : Icons.arrow_upward,
            ),
            onPressed: () => filter.setSort(query.sortBy),
          ),
        ],
      ),
    );
  }
}

/// What a stat with no recorded value shows. An em dash rather than a zero:
/// see [ArchivedChannel.medianViewsLast30] for why the two must not look alike.
const _emptyValue = '—';

/// Between two dates on one line.
const _separator = '  ·  ';

/// Why this row's median reads the way it does.
///
/// The archive is read months after the videos behind it were deleted, so a
/// number here has to carry its own provenance or it is not evidence. Three
/// different things can put an em dash in this column and they mean quite
/// different things — nobody ever fetched a video, the videos were fetched
/// but none carried a view count, or the row predates the column — and a
/// median that IS there was taken over one of two different sets. Saying
/// which, every time, is what makes the column comparable with itself.
String _medianHint(AppLocalizations l10n, ArchivedChannel entry) {
  if (entry.medianViewsLast30 == null) {
    // Nothing was ever counted: the auto-clean gate rejects on the subscriber
    // count during a search, before the video pass, so there was no median to
    // lose. Distinct from "we looked and found no view counts".
    return entry.videosFound == null
        ? l10n.archiveMedianNotFetched
        : l10n.archiveNoAverage;
  }
  return switch (entry.medianBasis) {
    ArchiveMedianBasis.lifetime => l10n.archiveMedianLifetime,
    ArchiveMedianBasis.window30 => l10n.archiveMedianWindow30,
    // Written before the basis was recorded, or by something newer than this
    // build. Either way the number stands on its own without a claim about
    // what it spans.
    _ => l10n.archiveColumnAvgViews,
  };
}

String _medianTooltip(AppLocalizations l10n, ArchivedChannel entry) =>
    entry.medianViewsLast30 == null
        ? _medianHint(l10n, entry)
        : '${l10n.archiveColumnAvgViews}: '
            '${formatCount(entry.medianViewsLast30)}'
            '$_separator${_medianHint(l10n, entry)}';

/// Zero videos and no count are not the same finding — see
/// [ArchivedChannel.videosFound].
String _videosHint(AppLocalizations l10n, ArchivedChannel entry) =>
    switch (entry.videosFound) {
      null => l10n.archiveVideosNotCounted,
      0 => l10n.archiveVideosNone,
      _ => l10n.archiveColumnVideos,
    };

String _videosTooltip(AppLocalizations l10n, ArchivedChannel entry) =>
    entry.videosFound == null
        ? l10n.archiveVideosNotCounted
        : '${l10n.archiveColumnVideos}: ${formatCount(entry.videosFound)}'
            '$_separator${_videosHint(l10n, entry)}';

class _ArchiveList extends ConsumerWidget {
  const _ArchiveList({
    required this.l10n,
    required this.query,
    required this.state,
  });

  final AppLocalizations l10n;
  final ArchiveQuery query;
  final ArchiveListState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      itemCount: state.items.length + 1,
      // 4, not 8: a row is a single line now, and a gap that read as
      // breathing room between cards reads as a hole between lines.
      separatorBuilder: (_, __) => const SizedBox(height: 4),
      itemBuilder: (context, index) {
        if (index == state.items.length) {
          return _Footer(l10n: l10n, state: state, query: query);
        }
        return _ArchiveTile(
          entry: state.items[index],
          l10n: l10n,
          query: query,
        );
      },
    );
  }
}

class _Footer extends ConsumerWidget {
  const _Footer({required this.l10n, required this.state, required this.query});

  final AppLocalizations l10n;
  final ArchiveListState state;
  final ArchiveQuery query;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        children: [
          if (state.hasMore)
            state.isLoadingMore
                ? const Padding(
                    padding: EdgeInsets.all(8),
                    child: CircularProgressIndicator(),
                  )
                : OutlinedButton(
                    onPressed: () => ref
                        .read(archivePageProvider(query).notifier)
                        .loadMore(),
                    child: Text(l10n.archiveLoadMore),
                  ),
          if (state.loadMoreError != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                l10n.archiveLoadFailed,
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.error),
              ),
            ),
          const SizedBox(height: 24),
          Text(
            l10n.archiveRestoreNote,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

/// One archived channel, on one line wherever one line is enough.
///
/// The archive holds six facts about a channel nobody is going to work with
/// again, and the old card gave each of them a labelled block over three rows.
/// That is a reasonable amount of ceremony for a channel you are deciding
/// about, and far too much for a list whose only real use is scanning: at a
/// hundred rows it was eleven screens of mostly whitespace.
///
/// So: one row, values only, on anything wide enough to hold them. The labels
/// move into tooltips rather than disappearing — the numbers are unambiguous in
/// context ("41 videos") but the two view figures are not, and a stat nobody
/// can identify is not saved space.
///
/// The stacked layout is kept for narrow windows rather than being squeezed.
/// Below roughly 620px the six values cannot sit on a line without every one of
/// them ellipsizing to nothing, and a row of "12…" is worse than the card was.
class _ArchiveTile extends StatelessWidget {
  const _ArchiveTile({
    required this.entry,
    required this.l10n,
    required this.query,
  });

  /// Below this the row cannot hold its six values legibly; above it, it can.
  ///
  /// At the default text size. The dense row is built from fixed-width value
  /// slots, and the figures inside them grow with the font slider while the
  /// slots do not — so the width it needs grows too, and a window wide enough
  /// at 1.0 is 17px short at 1.6. The threshold is scaled by the same factor
  /// the text is, which hands those windows the stacked form instead.
  static const _oneLineWidth = 620.0;

  final ArchivedChannel entry;
  final AppLocalizations l10n;
  final ArchiveQuery query;

  @override
  Widget build(BuildContext context) {
    final threshold = MediaQuery.textScalerOf(context).scale(_oneLineWidth);
    return LayoutBuilder(
      builder: (context, constraints) => constraints.maxWidth >= threshold
          ? _OneLine(entry: entry, l10n: l10n, query: query)
          : _Stacked(entry: entry, l10n: l10n, query: query),
    );
  }
}

/// The dense form. A Row of fixed-width value slots, not a Wrap: the point of
/// this layout is that the figures line up down the list, and a Wrap re-flows
/// each row to its own content so no two of them agree.
class _OneLine extends ConsumerWidget {
  const _OneLine({
    required this.entry,
    required this.l10n,
    required this.query,
  });

  final ArchivedChannel entry;
  final AppLocalizations l10n;
  final ArchiveQuery query;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final archivedOn = l10n.archiveArchivedOn(fmt.dateTime12(entry.archivedAt));

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsetsDirectional.fromSTEB(4, 6, 4, 6),
        child: Row(
          children: [
            _FreeButton(entry: entry, l10n: l10n, query: query),
            Expanded(
              child: Text(
                entry.handle,
                style: theme.textTheme.titleSmall,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 8),
            _LabelChip(entry: entry, l10n: l10n, query: query),
            const SizedBox(width: 12),
            // Compact, not grouped: "184K" and "1.2M" are the same width, so
            // the column stays a column. The exact figure is in the tooltip for
            // anyone who needs it.
            _Value(
              width: 96,
              text: entry.subscriberCount == null
                  ? _emptyValue
                  : formatCompact(entry.subscriberCount),
              tooltip: '${l10n.archiveColumnSubscribers}: '
                  '${formatCount(entry.subscriberCount)}',
              icon: Icons.people_outline,
            ),
            _Value(
              width: 112,
              // Null is not zero. A channel whose uploads never had a view
              // count recorded is a different fact from one averaging zero
              // views, and showing "0" would quietly assert the second.
              text: entry.medianViewsLast30 == null
                  ? _emptyValue
                  : formatCompact(entry.medianViewsLast30),
              tooltip: _medianTooltip(l10n, entry),
              icon: Icons.visibility_outlined,
            ),
            _Value(
              width: 80,
              text: entry.videosFound == null
                  ? _emptyValue
                  : formatCompact(entry.videosFound),
              tooltip: _videosTooltip(l10n, entry),
              icon: Icons.video_library_outlined,
            ),
            const SizedBox(width: 8),
            Tooltip(
              message: entry.foundAt == null
                  ? archivedOn
                  : [
                      archivedOn,
                      l10n.archiveFoundOn(fmt.dateTime12(entry.foundAt!))
                    ].join(_separator),
              child: SizedBox(
                width: 216,
                child: Text(
                  fmt.dateTime12(entry.archivedAt),
                  textAlign: TextAlign.end,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            ),
            IconButton(
              tooltip: l10n.archiveOpenOnYoutube,
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.open_in_new, size: 18),
              onPressed: () =>
                  ref.read(urlLauncherProvider)(Uri.parse(entry.channelUrl)),
            ),
          ],
        ),
      ),
    );
  }
}

/// One value in the dense row: an icon, a number, and the label in a tooltip.
///
/// Fixed width so the numbers form columns down the list. An icon rather than a
/// visible label because the label is three times the width of the value it
/// describes, and repeating it on every row is most of what made the card tall.
class _Value extends StatelessWidget {
  const _Value({
    required this.width,
    required this.text,
    required this.tooltip,
    required this.icon,
  });

  final double width;
  final String text;
  final String tooltip;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Tooltip(
      message: tooltip,
      child: SizedBox(
        width: width,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            Icon(icon, size: 14, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(width: 4),
            Flexible(
              child: Text(
                text,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodyMedium,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The narrow-window form — the original card, unchanged.
///
/// Kept whole rather than turned into a degraded version of the row above: on a
/// phone the labels are the only thing that makes six numbers readable, and the
/// space they cost is space a phone has vertically anyway.
class _Stacked extends ConsumerWidget {
  const _Stacked({
    required this.entry,
    required this.l10n,
    required this.query,
  });

  final ArchivedChannel entry;
  final AppLocalizations l10n;
  final ArchiveQuery query;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final fmt = ref.watch(instantFormatterProvider);

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(4, 8, 12, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _FreeButton(entry: entry, l10n: l10n, query: query),
                Expanded(
                  child: Text(
                    entry.handle,
                    style: theme.textTheme.titleSmall,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 8),
                _LabelChip(entry: entry, l10n: l10n, query: query),
                IconButton(
                  tooltip: l10n.archiveOpenOnYoutube,
                  icon: const Icon(Icons.open_in_new, size: 18),
                  onPressed: () => ref
                      .read(urlLauncherProvider)(Uri.parse(entry.channelUrl)),
                ),
              ],
            ),
            const SizedBox(height: 8),
            // A Wrap so three stat blocks reflow instead of overflowing on a
            // phone.
            Wrap(
              spacing: 24,
              runSpacing: 8,
              children: [
                _Stat(
                  label: l10n.archiveColumnSubscribers,
                  value: entry.subscriberCount == null
                      ? _emptyValue
                      : formatCount(entry.subscriberCount),
                ),
                _Stat(
                  label: l10n.archiveColumnAvgViews,
                  value: entry.medianViewsLast30 == null
                      ? _emptyValue
                      : formatCount(entry.medianViewsLast30),
                  hint: _medianHint(l10n, entry),
                ),
                _Stat(
                  label: l10n.archiveColumnVideos,
                  value: entry.videosFound == null
                      ? _emptyValue
                      : formatCount(entry.videosFound),
                  hint: _videosHint(l10n, entry),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              [
                l10n.archiveArchivedOn(fmt.date(entry.archivedAt)),
                if (entry.foundAt != null)
                  l10n.archiveFoundOn(fmt.date(entry.foundAt!)),
              ].join(_separator),
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The rejection reason, as a pill that opens a menu to correct it.
///
/// The pill was read-only until the reason turned out to be the one thing on
/// this page that is genuinely wrong sometimes and had no way to fix — a
/// mis-tag before archiving is otherwise a database edit. The menu offers only
/// [ChannelTag.rejecting]; the column's check constraint allows nothing else.
class _LabelChip extends ConsumerWidget {
  const _LabelChip({
    required this.entry,
    required this.l10n,
    required this.query,
  });

  final ArchivedChannel entry;
  final AppLocalizations l10n;
  final ArchiveQuery query;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final color = entry.label.color(context);
    return PopupMenuButton<ChannelTag>(
      tooltip: l10n.archiveChangeReasonTooltip,
      position: PopupMenuPosition.under,
      onSelected: (tag) => _changeReason(context, ref, entry, tag, query),
      itemBuilder: (context) => [
        for (final tag in ChannelTag.rejecting)
          PopupMenuItem(
            value: tag,
            child: Row(
              children: [
                Icon(
                  tag == entry.label
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                  size: 18,
                  color: tag == entry.label ? tag.color(context) : null,
                ),
                const SizedBox(width: 12),
                Text(tag.label(l10n)),
              ],
            ),
          ),
      ],
      child: Container(
        padding: const EdgeInsetsDirectional.fromSTEB(10, 3, 4, 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              entry.label.label(l10n),
              style: theme.textTheme.labelSmall?.copyWith(color: color),
            ),
            Icon(Icons.arrow_drop_down, size: 16, color: color),
          ],
        ),
      ),
    );
  }
}

/// The ✕ that frees a channel: removes its tombstone and queues a one-channel
/// enrichment run whose progress shows on the Search page.
///
/// Disabled off-desktop — freeing a channel re-enriches it, and the enrichment
/// is the local Python pipeline, which only the installed app can run. The
/// reason dropdown stays usable everywhere.
class _FreeButton extends ConsumerWidget {
  const _FreeButton({
    required this.entry,
    required this.l10n,
    required this.query,
  });

  final ArchivedChannel entry;
  final AppLocalizations l10n;
  final ArchiveQuery query;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final canRun = ref.watch(capabilitiesProvider).canRunSearch;
    return IconButton(
      visualDensity: VisualDensity.compact,
      tooltip: canRun ? l10n.archiveFreeTooltip : l10n.archiveFreeUnavailable,
      icon: const Icon(Icons.close, size: 18),
      onPressed: canRun ? () => _freeChannel(context, ref, entry, query) : null,
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, this.hint});

  final String label;
  final String value;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: theme.textTheme.labelSmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        Text(value, style: theme.textTheme.bodyMedium),
      ],
    );
    return hint == null ? content : Tooltip(message: hint, child: content);
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.text, this.hint});

  final String text;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(text, textAlign: TextAlign.center),
            if (hint != null) ...[
              const SizedBox(height: 8),
              Text(
                hint!,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
