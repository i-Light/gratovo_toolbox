import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/email_tag.dart';
import 'package:gratovo_toolbox/features/email_library/application/email_library_controller.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/add_tag_dialog.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/tag_ordering.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Where tags are renamed and deleted, for both vocabularies.
///
/// Separate from the editor's inline "+" on purpose. Adding a tag happens
/// constantly and mid-thought, so it belongs where you are typing; renaming and
/// deleting are rare, affect every record at once, and want a screen where the
/// consequences are visible — which is why every row here shows how many
/// records carry it.
Future<void> showManageTagsSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => const _ManageTagsSheet(),
  );
}

class _ManageTagsSheet extends ConsumerStatefulWidget {
  const _ManageTagsSheet();

  @override
  ConsumerState<_ManageTagsSheet> createState() => _ManageTagsSheetState();
}

class _ManageTagsSheetState extends ConsumerState<_ManageTagsSheet> {
  EmailTagKind _kind = EmailTagKind.niche;
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    final label = await showAddTagDialog(
      context,
      kind: _kind,
      initialValue: _searchController.text.trim(),
    );
    if (label == null) return;
    await ref.read(emailLibraryActionsProvider).addTag(_kind, label);
  }

  Future<void> _rename(EmailTag tag) async {
    final label = await showAddTagDialog(
      context,
      kind: tag.kind,
      initialValue: tag.label,
    );
    if (label == null || label == tag.label) return;
    await ref.read(emailLibraryActionsProvider).renameTag(tag, label);
  }

  Future<void> _delete(EmailTag tag, int usage) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.emailLibraryDeleteTagTitle(tag.label)),
        // The count is the whole point of the confirmation: deleting a tag
        // strips it off every record silently, and thirty is a very different
        // decision from zero.
        content: Text(l10n.emailLibraryDeleteTagBody(usage)),
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
    await ref.read(emailLibraryActionsProvider).deleteTag(tag);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final tags = ref.watch(emailTagsProvider(_kind)).value ?? const [];
    final usage = ref.watch(emailTagUsageProvider(_kind)).value ?? const {};
    final visible = filterTagsByQuery(tags, _searchController.text);

    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Text(
                  l10n.emailLibraryManageTags,
                  style: theme.textTheme.titleMedium,
                ),
                const Spacer(),
                TextButton.icon(
                  onPressed: _add,
                  icon: const Icon(Icons.add, size: 18),
                  label: Text(l10n.emailLibraryAddTag),
                ),
              ],
            ),
            const SizedBox(height: 12),
            SegmentedButton<EmailTagKind>(
              segments: [
                ButtonSegment(
                  value: EmailTagKind.stage,
                  label: Text(l10n.emailLibraryFieldStage),
                ),
                ButtonSegment(
                  value: EmailTagKind.niche,
                  label: Text(l10n.emailLibraryFieldNiche),
                ),
              ],
              selected: {_kind},
              showSelectedIcon: false,
              onSelectionChanged: (selection) =>
                  setState(() => _kind = selection.first),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _searchController,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                isDense: true,
                prefixIcon: const Icon(Icons.search, size: 18),
                hintText: l10n.emailLibraryNicheSearchHint,
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),
            ConstrainedBox(
              // Half the viewport: tall enough to work in, short enough that
              // the sheet never becomes a full-screen page by accident.
              constraints: BoxConstraints(
                maxHeight: MediaQuery.sizeOf(context).height * 0.5,
              ),
              child: visible.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.symmetric(vertical: 24),
                      child: Text(
                        l10n.emailLibraryNoNicheTags,
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodySmall
                            ?.copyWith(color: theme.colorScheme.outline),
                      ),
                    )
                  : ListView.builder(
                      shrinkWrap: true,
                      itemCount: visible.length,
                      itemBuilder: (context, index) {
                        final tag = visible[index];
                        final count = usage[tag.id] ?? 0;
                        return ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: Text(tag.label),
                          subtitle: Text(l10n.emailLibraryTagUsage(count)),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              IconButton(
                                tooltip: l10n.emailLibraryRenameTag,
                                onPressed: () => _rename(tag),
                                iconSize: 18,
                                icon: const Icon(Icons.edit_outlined),
                              ),
                              IconButton(
                                tooltip: l10n.commonDelete,
                                onPressed: () => _delete(tag, count),
                                iconSize: 18,
                                icon: const Icon(Icons.delete_outline),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
