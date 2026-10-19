import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/data/models/skill_gem_setup.dart';
import 'package:gratovo_toolbox/data/models/skill_group.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_providers.dart';
import 'package:gratovo_toolbox/features/skills/application/skill_markdown.dart';
import 'package:gratovo_toolbox/features/skills/application/skills_controller.dart';
import 'package:gratovo_toolbox/features/skills/application/skills_revision.dart';
import 'package:gratovo_toolbox/features/skills/presentation/widgets/skill_group_deck.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The Skills page: every skill (`data/gemini skills/*.md`) as a card you can
/// open into its own deck of cards. Embedded as a view inside Outreach (see
/// `OutreachScreen`), the same way the email critique library and the
/// scratchpad are, rather than its own nav-rail destination — it is a
/// configuration tool for the team's Gemini prompts, opened rarely next to
/// the conversations it feeds.
///
/// Drilling into a group is local widget state, not a route: a skill deck has
/// no reason to be a shareable URL, and this keeps `app_router.dart`
/// untouched.
/// What a tile shows beyond the name: total words, a two-line description from
/// the skill's own text, and whether the deck configures a Gemini gem.
class _SkillSummary {
  const _SkillSummary({
    required this.words,
    required this.description,
    required this.isGem,
    required this.text,
  });
  final int words;

  /// Lower-cased heading and body text of the whole deck, for search.
  final String text;
  final String description;
  final bool isGem;
}

final _skillSummaryProvider =
    FutureProvider.family<_SkillSummary, ({String id, String name})>(
        (ref, group) async {
  ref.watch(skillsRevisionProvider);
  final repo = ref.watch(skillsLibraryRepositoryProvider);
  final sections = await repo.listSections(group.id);
  final lines = <String>[
    for (final s in sections)
      for (final line in s.body.split('\n'))
        if (line.trim().isNotEmpty) line.trim(),
  ];
  final isGem = gemRoleForSkillName(group.name) != null ||
      await repo.getGemSetup(group.id) != null;
  return _SkillSummary(
    words: totalWordCount(sections),
    description: lines.take(2).join('\n'),
    isGem: isGem,
    text: [for (final s in sections) '${s.heading}\n${s.body}']
        .join('\n')
        .toLowerCase(),
  );
});

/// The gems the app expects a deck for, and the file each one is imported from.
const _expectedGems = <SkillGemRole, ({String label, String file})>{
  SkillGemRole.keywords: (
    label: 'Keyword generator',
    file: 'keyword generator skill',
  ),
};

class SkillsLibraryView extends ConsumerStatefulWidget {
  const SkillsLibraryView({super.key});

  @override
  ConsumerState<SkillsLibraryView> createState() => _SkillsLibraryViewState();
}

class _SkillsLibraryViewState extends ConsumerState<SkillsLibraryView> {
  SkillGroup? _open;

  String _query = '';

  @override
  Widget build(BuildContext context) {
    final open = _open;
    if (open != null) {
      return SkillGroupDeck(
        group: open,
        onBack: () => setState(() => _open = null),
      );
    }

    final l10n = AppLocalizations.of(context);
    final repo = ref.watch(skillsLibraryRepositoryProvider);
    final groupsAsync = ref.watch(skillsControllerProvider);

    if (!repo.isAvailable) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(l10n.skillsUnavailable, textAlign: TextAlign.center),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.skillsTitle),
        actions: [
          IconButton(
            tooltip: l10n.skillsImport,
            icon: const Icon(Icons.file_download_outlined),
            onPressed: () => _importFile(context),
          ),
          IconButton(
            tooltip: l10n.skillsExportAll,
            icon: const Icon(Icons.sync),
            onPressed: () => _exportAll(context),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _createGroup(context),
        icon: const Icon(Icons.add),
        label: Text(l10n.skillsNewSkill),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: TextField(
              onChanged: (value) => setState(() => _query = value),
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Search all skills',
                isDense: true,
                border: OutlineInputBorder(),
              ),
            ),
          ),
          Expanded(child: _buildGrid(context, groupsAsync)),
        ],
      ),
    );
  }

  Widget _buildGrid(
      BuildContext context, AsyncValue<List<SkillGroup>> groupsAsync) {
    return groupsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('$error')),
      data: (allGroups) {
        final q = _query.trim().toLowerCase();
        final groups = q.isEmpty
            ? allGroups
            : [
                for (final g in allGroups)
                  if (g.name.toLowerCase().contains(q) ||
                      (ref
                                  .watch(_skillSummaryProvider(
                                      (id: g.id, name: g.name)))
                                  .value
                                  ?.text ??
                              '')
                          .contains(q))
                    g,
              ];
        final missing = q.isNotEmpty
            ? const <({String label, String file})>[]
            : [
                for (final e in _expectedGems.entries)
                  if (!groups.any((g) => gemRoleForSkillName(g.name) == e.key))
                    e.value,
              ];
        return GridView.builder(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
            maxCrossAxisExtent: 340,
            mainAxisExtent: 186,
            crossAxisSpacing: 16,
            mainAxisSpacing: 16,
          ),
          itemCount: groups.length + missing.length,
          itemBuilder: (context, i) {
            if (i >= groups.length) {
              final gem = missing[i - groups.length];
              return _MissingGemCard(
                label: gem.label,
                onUpload: () => _importFile(context, preferFile: gem.file),
              );
            }
            final group = groups[i];
            final summary = ref
                .watch(_skillSummaryProvider((id: group.id, name: group.name)))
                .value;
            return _SkillGroupTile(
              group: group,
              isGem: summary?.isGem ?? false,
              words: summary?.words ?? 0,
              description: summary?.description ?? '',
              onTap: () => setState(() => _open = group),
              onDelete: () => _confirmDeleteGroup(context, group),
            );
          },
        );
      },
    );
  }

  Future<void> _createGroup(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final name = await showDialog<String>(
      context: context,
      builder: (context) => _NameDialog(title: l10n.skillsNewSkill),
    );
    if (name == null || name.trim().isEmpty) return;
    await ref.read(skillsControllerProvider.notifier).createGroup(name);
  }

  Future<void> _confirmDeleteGroup(
    BuildContext context,
    SkillGroup group,
  ) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.skillsDeleteSkill),
        content: Text(l10n.skillsDeleteSkillConfirm(group.name)),
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
    if (confirmed ?? false) {
      await ref.read(skillsControllerProvider.notifier).deleteGroup(group.id);
    }
  }

  Future<void> _importFile(BuildContext context, {String? preferFile}) async {
    final l10n = AppLocalizations.of(context);
    final controller = ref.read(skillsControllerProvider.notifier);
    final files = await controller.listImportable();
    if (!context.mounted) return;
    if (files.isEmpty) {
      AppToast.info(context, l10n.skillsImportNothingToImport);
      return;
    }
    String? chosen;
    if (preferFile != null) {
      for (final path in files) {
        if (_fileLabel(path).toLowerCase() ==
            '${preferFile.toLowerCase()}.md') {
          chosen = path;
        }
      }
    }
    chosen ??= await showDialog<String>(
      context: context,
      builder: (context) => SimpleDialog(
        title: Text(l10n.skillsImport),
        children: [
          for (final path in files)
            SimpleDialogOption(
              onPressed: () => Navigator.of(context).pop(path),
              child: Text(_fileLabel(path)),
            ),
        ],
      ),
    );
    if (chosen == null) return;
    final group = await controller.importFile(chosen);
    if (!context.mounted) return;
    if (group != null) {
      AppToast.success(context, l10n.skillsImportDone(group.name));
    } else {
      AppToast.warning(context, l10n.skillsImportFailed);
    }
  }

  String _fileLabel(String path) {
    final normalized = path.replaceAll('\\', '/');
    return normalized.substring(normalized.lastIndexOf('/') + 1);
  }

  Future<void> _exportAll(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final results =
        await ref.read(skillsControllerProvider.notifier).exportAll();
    if (!context.mounted) return;
    final failed = results.values.where((ok) => !ok).length;
    if (failed == 0) {
      AppToast.success(context, l10n.skillsExportAllDone);
    } else {
      AppToast.warning(context, l10n.skillsExportAllPartial(failed));
    }
  }
}

class _SkillGroupTile extends StatelessWidget {
  const _SkillGroupTile({
    required this.group,
    required this.isGem,
    required this.words,
    required this.description,
    required this.onTap,
    required this.onDelete,
  });

  final SkillGroup group;
  final bool isGem;
  final int words;
  final String description;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);

    final accent = theme.colorScheme.tertiary;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            spacing: 4,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (isGem) ...[
                    Icon(Icons.diamond_outlined,
                        size: 18, color: accent.withValues(alpha: 0.6)),
                    const SizedBox(width: 6),
                  ],
                  Expanded(
                    child: Text(
                      group.name,
                      style: theme.textTheme.titleMedium,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.delete_outline, size: 18),
                    tooltip: l10n.skillsDeleteSkill,
                    onPressed: onDelete,
                  ),
                ],
              ),
              if (description.isNotEmpty)
                Text(
                  description,
                  style: theme.textTheme.bodySmall,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              const Spacer(),
              Text('$words words', style: theme.textTheme.labelMedium),
              Text(
                group.exportedAt == null
                    ? l10n.skillsNeverExported
                    : l10n.skillsLastExported(group.exportedAt!
                        .toLocal()
                        .toString()
                        .split('.')
                        .first
                        .replaceAll(' ', '  ||  ')),
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.outline,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Stands in for a gem's deck that was never uploaded — deliberately not a
/// [_SkillGroupTile], since there is no skill behind it yet.
class _MissingGemCard extends StatelessWidget {
  const _MissingGemCard({required this.label, required this.onUpload});

  final String label;
  final VoidCallback onUpload;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      elevation: 0,
      color: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: theme.colorScheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.diamond_outlined, color: theme.colorScheme.outline),
            const SizedBox(height: 4),
            Text(label, style: theme.textTheme.titleSmall),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: onUpload,
              icon: const Icon(Icons.upload_file, size: 18),
              label: const Text('Upload file'),
            ),
          ],
        ),
      ),
    );
  }
}

class _NameDialog extends StatefulWidget {
  const _NameDialog({required this.title});
  final String title;

  @override
  State<_NameDialog> createState() => _NameDialogState();
}

class _NameDialogState extends State<_NameDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(widget.title),
      content: TextField(
        controller: _controller,
        autofocus: true,
        decoration: InputDecoration(hintText: l10n.skillsNameHint),
        onSubmitted: (value) => Navigator.of(context).pop(value),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(_controller.text),
          child: Text(l10n.commonCreate),
        ),
      ],
    );
  }
}
