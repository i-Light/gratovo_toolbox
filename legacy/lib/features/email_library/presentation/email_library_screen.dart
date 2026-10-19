import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/data/models/email_tag.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/email_library_providers.dart';
import 'package:gratovo_toolbox/features/email_library/application/email_library_controller.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/copy_range_dialog.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/email_record_card.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/email_record_editor.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/email_verdict_controls.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/manage_tags_sheet.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/tag_selection_row.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The Email Critique Library: emails somebody wrote, and what an expert said
/// about them — as a page body, with no Scaffold of its own.
///
/// A capture tool first and a browsing tool second. The corpus is only worth
/// anything once there is a lot of it, so everything here is arranged around
/// the cost of adding the next record — the date and URL carry forward, "save
/// and add another" never closes the editor, and the tags you were just using
/// stay selected.
///
/// What it is *for* is downstream: `pipeline/tools/email_library.py` reads the
/// same file back out, and the accumulated critiques are what the drafting
/// skills in `data/gemini skills/` get sharpened against.
///
/// It no longer has its own nav destination — it is one of the two views on
/// the Outreach page, reached from the switcher at the top of that page — so
/// what used to be app-bar chrome now lives inside the view: the
/// copy-for-a-handbook and manage-tags actions moved onto the audience-tabs
/// row (see [_AudienceTabs]), and "new record" is a FAB the Outreach Scaffold
/// hangs off itself (see [NewEmailRecordButton]).
class EmailLibraryView extends ConsumerWidget {
  const EmailLibraryView({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final available = ref.watch(emailLibraryRepositoryProvider).isAvailable;
    return available ? const _EmailLibraryBody() : const _UnavailableNotice();
  }
}

/// The "new email record" button. The Outreach page shows it as a FAB while
/// its Critique Library view is open.
///
/// A widget of its own rather than a bare callback: opening the editor needs
/// the draft defaults in hand first — the editor's controllers are built once
/// in initState — and that read is easiest to keep next to the button.
class NewEmailRecordButton extends ConsumerWidget {
  const NewEmailRecordButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    if (!ref.watch(emailLibraryRepositoryProvider).isAvailable) {
      return const SizedBox.shrink();
    }
    return FloatingActionButton.extended(
      onPressed: () => _createRecord(context, ref),
      icon: const Icon(Icons.add),
      label: Text(l10n.emailLibraryNewRecord),
    );
  }

  /// Opens a blank record for the open tab, pre-filled from the last one saved
  /// in it.
  Future<void> _createRecord(BuildContext context, WidgetRef ref) async {
    final audience = ref.read(emailAudienceProvider);
    // Read rather than watch, and awaited here rather than in the editor: the
    // editor's controllers are built once in initState, so the defaults have
    // to be in hand before it opens.
    final defaults = await ref.read(
      emailDraftDefaultsProvider(audience).future,
    );
    if (!context.mounted) return;

    await showEmailRecordEditor(
      context,
      record: EmailRecord.blank(audience: audience, defaults: defaults),
      isNew: true,
    );
  }
}

/// The page itself. Opening it brings in the skill factory's last bench run
/// as "test drafts" (plan, slice 3): drafts already in the library are left
/// alone, so this costs nothing when there is nothing new, and says so only
/// when there was.
class _EmailLibraryBody extends ConsumerStatefulWidget {
  const _EmailLibraryBody();

  @override
  ConsumerState<_EmailLibraryBody> createState() => _EmailLibraryBodyState();
}

class _EmailLibraryBodyState extends ConsumerState<_EmailLibraryBody> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_importBenchDrafts());
    });
  }

  Future<void> _importBenchDrafts() async {
    final int added;
    try {
      added = await ref.read(emailLibraryActionsProvider).importBenchDrafts();
    } catch (_) {
      // The library works without the bench run; a failed import must not
      // take the page down with it.
      return;
    }
    if (added == 0 || !mounted) return;
    AppToast.success(
      context,
      AppLocalizations.of(context).emailLibraryBenchImported(added),
    );
  }

  @override
  Widget build(BuildContext context) {
    return const Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _AudienceTabs(),
        Divider(height: 1),
        _FilterBar(),
        Expanded(child: _RecordList()),
      ],
    );
  }
}

/// The two tabs: influencers and brands.
///
/// A segmented button rather than a [TabBar], because these are not two views
/// of one thing — they are two separate corpora that must never be mixed, and
/// a segmented control reads as a choice where a tab bar reads as a page.
class _AudienceTabs extends ConsumerWidget {
  const _AudienceTabs();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final audience = ref.watch(emailAudienceProvider);
    final counts = ref.watch(emailRecordCountsProvider).value ?? const {};

    String label(String base, EmailAudience forAudience) {
      final count = counts[forAudience];
      if (count == null || count == 0) return base;
      return '$base  ${formatCount(count)}';
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Row(
        children: [
          Expanded(
            child: Align(
              alignment: AlignmentDirectional.centerStart,
              child: SegmentedButton<EmailAudience>(
                segments: [
                  ButtonSegment(
                    value: EmailAudience.influencer,
                    icon: const Icon(Icons.people_outline, size: 18),
                    label: Text(
                      label(l10n.emailLibraryTabInfluencers,
                          EmailAudience.influencer),
                    ),
                  ),
                  ButtonSegment(
                    value: EmailAudience.brand,
                    icon: const Icon(Icons.business_outlined, size: 18),
                    label: Text(
                      label(l10n.emailLibraryTabBrands, EmailAudience.brand),
                    ),
                  ),
                ],
                selected: {audience},
                showSelectedIcon: false,
                onSelectionChanged: (selection) => ref
                    .read(emailAudienceProvider.notifier)
                    .select(selection.first),
              ),
            ),
          ),
          // These two used to be app-bar actions. With the library folded into
          // the Outreach page they sit on the tabs row instead — still the
          // corpus-wide controls, now beside the corpus they act on.
          const SizedBox(width: 8),
          IconButton(
            // English-only, unlike everything around it - see [CopyRangeDialog]
            // for why this one control is not localised.
            tooltip: 'Copy records for a handbook',
            onPressed: () => showCopyRangeDialog(
              context,
              audience: audience,
            ),
            icon: const Icon(Icons.copy_all_outlined),
          ),
          IconButton(
            tooltip: l10n.emailLibraryManageTags,
            onPressed: () => showManageTagsSheet(context),
            icon: const Icon(Icons.sell_outlined),
          ),
        ],
      ),
    );
  }
}

/// Search plus the stage-tag filter — the two ways of narrowing a tab.
///
/// The niche vocabulary is deliberately not here. It runs to hundreds of
/// entries, and a control that size belongs in the editor where it is being
/// filled in, not in a filter bar that has to stay one line tall. Searching
/// for the niche's name finds the same records, because a niche is almost
/// always named in the context field too.
class _FilterBar extends ConsumerStatefulWidget {
  const _FilterBar();

  @override
  ConsumerState<_FilterBar> createState() => _FilterBarState();
}

class _FilterBarState extends ConsumerState<_FilterBar> {
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final filter = ref.watch(emailLibraryFilterProvider);
    final stageTags =
        ref.watch(emailTagsProvider(EmailTagKind.stage)).value ?? const [];

    // Switching tabs clears the filter (see EmailAudienceNotifier), which the
    // search box has no other way to hear about.
    ref.listen(emailLibraryFilterProvider, (_, next) {
      if (next.search.isEmpty && _searchController.text.isNotEmpty) {
        _searchController.clear();
      }
    });

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _searchController,
                  onChanged:
                      ref.read(emailLibraryFilterProvider.notifier).setSearch,
                  decoration: InputDecoration(
                    isDense: true,
                    prefixIcon: const Icon(Icons.search, size: 18),
                    hintText: l10n.emailLibrarySearchHint,
                    border: const OutlineInputBorder(),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 12,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              const _SortDropdown(),
              if (!filter.isUnfiltered) ...[
                const SizedBox(width: 8),
                TextButton.icon(
                  onPressed:
                      ref.read(emailLibraryFilterProvider.notifier).clear,
                  icon: const Icon(Icons.filter_alt_off_outlined, size: 18),
                  label: Text(l10n.emailLibraryClearFilters),
                ),
              ],
            ],
          ),
          const SizedBox(height: 10),
          _SourceChips(selected: filter.source),
          if (stageTags.isNotEmpty) ...[
            const SizedBox(height: 10),
            TagSelectionRow(
              tags: stageTags,
              selectedIds: filter.stageTagIds,
              addTooltip: l10n.emailLibraryManageTags,
              onAdd: () => showManageTagsSheet(context),
              onToggle: (tag) => ref
                  .read(emailLibraryFilterProvider.notifier)
                  .toggleStageTag(tag.id),
            ),
          ],
        ],
      ),
    );
  }
}

/// Which kind of record the list shows: every kind, the ones typed in from
/// videos, the factory's test drafts, the drafts rated in the app, or the
/// owner's own examples. One choice at a time — "Test drafts" is a place to
/// work through, not a facet to combine.
class _SourceChips extends ConsumerWidget {
  const _SourceChips({required this.selected});

  final EmailRecordSource? selected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final notifier = ref.read(emailLibraryFilterProvider.notifier);
    final options = <(EmailRecordSource?, String)>[
      (null, l10n.emailLibrarySourceAll),
      (EmailRecordSource.video, l10n.emailLibrarySourceVideo),
      (EmailRecordSource.testDraft, l10n.emailLibrarySourceTestDraft),
      (EmailRecordSource.appDraft, l10n.emailLibrarySourceAppDraft),
      (EmailRecordSource.mine, l10n.emailLibrarySourceMine),
    ];
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [
        for (final (source, label) in options)
          ChoiceChip(
            key: ValueKey('email-source-${source?.storageValue ?? 'all'}'),
            visualDensity: VisualDensity.compact,
            label: Text(label),
            selected: selected == source,
            onSelected: (_) => notifier.setSource(source),
          ),
      ],
    );
  }
}

/// Orders the list. A view preference rather than a filter — see
/// [emailRecordSortProvider] — so it is not cleared when the tab changes and
/// sits outside the "clear filters" affordance.
class _SortDropdown extends ConsumerWidget {
  const _SortDropdown();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final sort = ref.watch(emailRecordSortProvider);

    String label(EmailRecordSort value) => switch (value) {
          EmailRecordSort.videoDate => l10n.emailLibrarySortVideoDate,
          EmailRecordSort.lastEdited => l10n.emailLibrarySortLastEdited,
          EmailRecordSort.lastCreated => l10n.emailLibrarySortLastCreated,
        };

    return DropdownButton<EmailRecordSort>(
      value: sort,
      underline: const SizedBox.shrink(),
      padding: const EdgeInsets.only(left: 10, right: 10),
      icon: const Icon(Icons.sort, size: 18),
      borderRadius: BorderRadius.circular(8),
      items: [
        for (final value in EmailRecordSort.values)
          DropdownMenuItem(value: value, child: Text(label(value))),
      ],
      onChanged: (value) {
        if (value != null) {
          ref.read(emailRecordSortProvider.notifier).select(value);
        }
      },
    );
  }
}

class _RecordList extends ConsumerWidget {
  const _RecordList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final records = ref.watch(emailRecordsProvider);
    final filter = ref.watch(emailLibraryFilterProvider);

    // Both vocabularies as one id -> tag map, resolved once for the whole list
    // rather than per card.
    final tagLabels = <String, EmailTag>{
      for (final kind in EmailTagKind.values)
        for (final tag in ref.watch(emailTagsProvider(kind)).value ?? const [])
          tag.id: tag,
    };

    return records.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => _CentredMessage(
        icon: Icons.error_outline,
        message: l10n.emailLibraryLoadFailed,
        detail: '$error',
      ),
      data: (items) {
        if (items.isEmpty) {
          return _CentredMessage(
            icon: Icons.drafts_outlined,
            message: filter.isUnfiltered
                ? l10n.emailLibraryEmpty
                : l10n.emailLibraryNoMatches,
          );
        }
        return ListView.builder(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 88),
          itemCount: items.length,
          itemBuilder: (context, index) {
            final record = items[index];
            return EmailRecordCard(
              record: record,
              tagLabels: tagLabels,
              onTap: () => showEmailRecordEditor(context, record: record),
              onDelete: () => _confirmDelete(context, ref, record),
              onVerdict: (verdict) => _rate(context, ref, record, verdict),
            );
          },
        );
      },
    );
  }

  /// Good saves at once; Bad asks why first, since a regression case needs
  /// its reason; tapping the chosen one again takes the rating off.
  Future<void> _rate(
    BuildContext context,
    WidgetRef ref,
    EmailRecord record,
    EmailVerdict? verdict,
  ) async {
    var note = '';
    if (verdict == EmailVerdict.bad) {
      final typed = await showVerdictNoteDialog(
        context,
        verdict: verdict!,
        initial: record.verdict == EmailVerdict.bad ? record.verdictNote : '',
      );
      if (typed == null) return;
      note = typed;
    } else if (verdict == record.verdict) {
      note = record.verdictNote;
    }
    await ref
        .read(emailLibraryActionsProvider)
        .setVerdict(record, verdict, note: note);
  }

  Future<void> _confirmDelete(
    BuildContext context,
    WidgetRef ref,
    EmailRecord record,
  ) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.emailLibraryDeleteTitle),
        content: Text(l10n.emailLibraryDeleteBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.commonCancel),
          ),
          FilledButton.tonal(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.commonDelete),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await ref.read(emailLibraryActionsProvider).deleteRecord(record);
  }
}

/// Shown when there is nowhere to write — the web build, or a machine whose
/// `data/database/email_library.db` could not be opened.
///
/// An explanation rather than a disabled editor, and specifically an
/// explanation that names the file and the setting: the usual cause is a
/// project root the app cannot resolve, which is a thing the person reading
/// this can fix in Settings.
class _UnavailableNotice extends StatelessWidget {
  const _UnavailableNotice();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return _CentredMessage(
      icon: Icons.folder_off_outlined,
      message: l10n.emailLibraryUnavailable,
      detail: l10n.emailLibraryUnavailableDetail,
    );
  }
}

class _CentredMessage extends StatelessWidget {
  const _CentredMessage({
    required this.icon,
    required this.message,
    this.detail,
  });

  final IconData icon;
  final String message;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 460),
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 40, color: theme.colorScheme.outline),
              const SizedBox(height: 16),
              Text(
                message,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyLarge,
              ),
              if (detail != null) ...[
                const SizedBox(height: 8),
                Text(
                  detail!,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.outline),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
