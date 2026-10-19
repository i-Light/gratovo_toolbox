import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/scroll/smooth_wheel_scroll.dart';
import 'package:gratovo_toolbox/data/models/skill_gem_setup.dart';
import 'package:gratovo_toolbox/data/models/skill_group.dart';
import 'package:gratovo_toolbox/data/models/skill_section.dart';
import 'package:gratovo_toolbox/features/skills/application/skill_gem_setup_controller.dart';
import 'package:gratovo_toolbox/features/skills/application/skill_group_controller.dart';
import 'package:gratovo_toolbox/features/skills/application/skill_markdown.dart';
import 'package:gratovo_toolbox/features/skills/application/skills_library_snapshot.dart';
import 'package:gratovo_toolbox/features/skills/presentation/widgets/markdown_preview.dart';
import 'package:gratovo_toolbox/features/skills/presentation/widgets/skill_gem_labels.dart';
import 'package:gratovo_toolbox/features/skills/presentation/widgets/skill_gem_setup_cards.dart';
import 'package:gratovo_toolbox/features/skills/presentation/widgets/skill_section_card.dart';
import 'package:gratovo_toolbox/features/skills/presentation/widgets/skill_section_colors.dart';
import 'package:gratovo_toolbox/features/skills/presentation/widgets/skill_split_pane.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// One skill's deck: a resizable two-pane layout — cards on the left, the
/// whole document's rendered preview on the right — modelled on the search
/// page's draggable split (`_PanelSplitter` in `search_screen.dart`; shared
/// with the Outreach deck as [SkillSplitPane]). Below its wide-layout width
/// there is no room to split, so the preview toggle swaps the pane shown
/// instead of narrowing both.
class SkillGroupDeck extends ConsumerStatefulWidget {
  const SkillGroupDeck({super.key, required this.group, required this.onBack});

  final SkillGroup group;
  final VoidCallback onBack;

  @override
  ConsumerState<SkillGroupDeck> createState() => _SkillGroupDeckState();
}

class _SkillGroupDeckState extends ConsumerState<SkillGroupDeck> {
  final Set<String> _expandedIds = {};
  String? _focusNewId;
  bool _showPreview = true;

  /// Drag-resize state lives in a notifier so a drag frame rebuilds only the
  /// pane layout — never the cards or the preview, which are far costlier than
  /// the two widths that actually changed.
  final ValueNotifier<double> _leftFraction = ValueNotifier(0.55);

  // The library snapshot's reference index and every section's resolved body,
  // kept between builds: both were recomputed for the whole deck on each
  // keystroke and each pane-resize frame.
  Map<SkillGroup, List<SkillSection>>? _snapshotSeen;
  Map<String, SkillReferenceTarget> _index = const {};
  List<String> _tokens = const [];
  final Map<String, ({String body, Object index, String resolved})> _resolved =
      {};

  void _refreshIndex(Map<SkillGroup, List<SkillSection>> snapshot) {
    if (identical(snapshot, _snapshotSeen)) return;
    _snapshotSeen = snapshot;
    _index = buildReferenceIndex(snapshot);
    _tokens = _index.keys.toList()..sort();
  }

  String _resolveBody(SkillSection section) {
    final hit = _resolved[section.id];
    if (hit != null &&
        identical(hit.index, _index) &&
        hit.body == section.body) {
      return hit.resolved;
    }
    final resolved = resolveSkillReferences(section.body, _index);
    _resolved[section.id] =
        (body: section.body, index: _index, resolved: resolved);
    return resolved;
  }

  /// The deck as it was when opened — what undo puts back.
  List<SkillSection>? _snapshot;
  SkillGemSetup? _gemSnapshot;
  bool _gemSnapshotTaken = false;

  /// Bumped by undo so cards rebuild their text fields from the restored state.
  int _epoch = 0;

  bool _searching = false;
  String _query = '';

  /// Leaves team-only (hidden) cards out of both panes.
  bool _hideTeamOnly = false;

  /// Whether the panes show less than the whole deck — reordering a partial
  /// list would drop the cards left out of it.
  bool get _isFiltered =>
      _hideTeamOnly || (_searching && _query.trim().isNotEmpty);

  List<SkillSection> _filter(List<SkillSection> sections) {
    final q = _query.trim().toLowerCase();
    final searching = _searching && q.isNotEmpty;
    if (!searching && !_hideTeamOnly) return sections;
    return [
      for (final s in sections)
        if (!(_hideTeamOnly && s.teamOnly) &&
            (!searching ||
                s.heading.toLowerCase().contains(q) ||
                s.body.toLowerCase().contains(q)))
          s,
    ];
  }

  final _leftScroll = ScrollController();
  final _rightScroll = ScrollController();

  @override
  void dispose() {
    _leftScroll.dispose();
    _rightScroll.dispose();
    _leftFraction.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final controllerProvider = skillGroupControllerProvider(widget.group.id);
    final async = ref.watch(controllerProvider);
    final notifier = ref.read(controllerProvider.notifier);
    final sections = async.value ?? const <SkillSection>[];
    final allExpanded = sections.isNotEmpty &&
        sections.every((s) => _expandedIds.contains(s.id));
    final hiddenCount = sections.where((s) => s.teamOnly).length;

    _refreshIndex(ref.watch(skillsLibrarySnapshotProvider).value ?? const {});

    final gemProvider = skillGemSetupControllerProvider(widget.group.id);
    final gemLoaded = ref.watch(gemProvider);
    final hasGem = gemLoaded.value != null;
    if (async.hasValue) _snapshot ??= async.value;
    if (gemLoaded.hasValue && !_gemSnapshotTaken) {
      _gemSnapshotTaken = true;
      _gemSnapshot = gemLoaded.value;
    }
    final changed = _hasChanges(sections, gemLoaded.value);

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            notifier.flush();
            ref.read(gemProvider.notifier).flush();
            widget.onBack();
          },
        ),
        title: Text(widget.group.name),
        actions: [
          IconButton(
            tooltip: 'Refresh preview',
            icon: const Icon(Icons.refresh),
            onPressed: () async {
              // Save what is still debouncing first, then re-read the deck.
              await notifier.flush();
              ref.invalidate(skillsLibrarySnapshotProvider);
              ref.invalidate(controllerProvider);
            },
          ),
          IconButton(
            tooltip: 'Search this skill',
            icon: Icon(_searching ? Icons.search_off : Icons.search),
            onPressed: () => setState(() {
              _searching = !_searching;
              _query = '';
            }),
          ),
          IconButton(
            isSelected: _hideTeamOnly,
            tooltip: _hideTeamOnly ? 'Show hidden cards' : 'Hide hidden cards',
            icon: const Icon(Icons.filter_alt_outlined),
            selectedIcon: Badge.count(
              count: hiddenCount,
              isLabelVisible: hiddenCount > 0,
              child: const Icon(Icons.filter_alt),
            ),
            onPressed: () => setState(() => _hideTeamOnly = !_hideTeamOnly),
          ),
          IconButton(
            tooltip: 'Undo changes',
            icon: const Icon(Icons.undo),
            onPressed: changed ? () => _undo(notifier) : null,
          ),
          // Only a deck the name-to-role table does not know needs this: every
          // other one already has its gem cards.
          if (!hasGem && gemLoaded.hasValue)
            IconButton(
              tooltip: l10n.skillsGemAddAction,
              icon: const Icon(Icons.diamond_outlined),
              onPressed: () => _addGemSetup(context),
            ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: Center(
              child: Chip(
                  label: Text(l10n.skillsWordCount(totalWordCount(sections)))),
            ),
          ),
          IconButton(
            tooltip:
                allExpanded ? l10n.skillsCollapseAll : l10n.skillsExpandAll,
            icon: Icon(allExpanded ? Icons.unfold_less : Icons.unfold_more),
            onPressed: sections.isEmpty
                ? null
                : () => setState(() {
                      if (allExpanded) {
                        _expandedIds.clear();
                      } else {
                        _expandedIds
                          ..clear()
                          ..addAll(sections.map((s) => s.id));
                      }
                    }),
          ),
          IconButton(
            isSelected: _showPreview,
            tooltip: l10n.skillsTogglePreview,
            icon: const Icon(Icons.visibility_outlined),
            selectedIcon: const Icon(Icons.visibility),
            onPressed: () => setState(() => _showPreview = !_showPreview),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final id = await notifier.addSection();
          if (!mounted) return;
          setState(() {
            _expandedIds.add(id);
            _focusNewId = id;
          });
        },
        icon: const Icon(Icons.add),
        label: Text(l10n.skillsAddCard),
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text('$error')),
        data: (allSections) {
          final sections = _filter(allSections);
          // Both panes take the wheel with the default per-notch jump, not the
          // app-wide glide, so they scroll the same way side by side.
          final deck = NoSmoothWheelScroll(
            child: RepaintBoundary(
              child: _buildDeck(context, notifier, sections, hasGem),
            ),
          );
          final preview = NoSmoothWheelScroll(
            child: RepaintBoundary(
              child: _buildPreview(context, sections),
            ),
          );

          final content = SkillSplitPane(
            fraction: _leftFraction,
            showPreview: _showPreview,
            deck: deck,
            preview: preview,
          );
          if (!_searching) return content;
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
                child: TextField(
                  autofocus: true,
                  onChanged: (value) => setState(() => _query = value),
                  decoration: InputDecoration(
                    prefixIcon: const Icon(Icons.search),
                    hintText: 'Search "${widget.group.name}"',
                    isDense: true,
                    border: const OutlineInputBorder(),
                  ),
                ),
              ),
              Expanded(child: content),
            ],
          );
        },
      ),
    );
  }

  bool _hasChanges(List<SkillSection> sections, SkillGemSetup? gem) {
    final snap = _snapshot;
    if (snap == null) return false;
    if (snap.length != sections.length) return true;
    for (var i = 0; i < snap.length; i++) {
      if (snap[i].id != sections[i].id ||
          snap[i].updatedAt != sections[i].updatedAt ||
          snap[i].position != sections[i].position) {
        return true;
      }
    }
    final g = _gemSnapshot;
    return g != null && gem != null && g.updatedAt != gem.updatedAt;
  }

  Future<void> _undo(SkillGroupController notifier) async {
    await notifier.restore(_snapshot ?? const []);
    await ref
        .read(skillGemSetupControllerProvider(widget.group.id).notifier)
        .restore(_gemSnapshot);
    if (!mounted) return;
    setState(() {
      _epoch++;
      _expandedIds.clear();
    });
  }

  Widget _buildDeck(
    BuildContext context,
    SkillGroupController notifier,
    List<SkillSection> sections,
    bool hasGem,
  ) {
    final l10n = AppLocalizations.of(context);
    if (sections.isEmpty && !hasGem) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(l10n.skillsDeckEmpty, textAlign: TextAlign.center),
        ),
      );
    }

    return ReorderableListView.builder(
      buildDefaultDragHandles: false,
      scrollController: _leftScroll,
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
      // The gem cards are the header, outside the reorderable items: that is
      // what keeps them first and undraggable.
      header: hasGem
          ? SkillGemSetupCards(
              key: ValueKey('gem-$_epoch'),
              groupId: widget.group.id,
            )
          : null,
      footer: sections.isEmpty
          ? Padding(
              padding: const EdgeInsets.all(24),
              child: Text(l10n.skillsDeckEmpty, textAlign: TextAlign.center),
            )
          : null,
      itemCount: sections.length,
      onReorderItem: (oldIndex, newIndex) {
        // A filtered list is not the whole deck; reordering it would drop cards.
        if (_isFiltered) return;
        final ids = [for (final s in sections) s.id];
        final id = ids.removeAt(oldIndex);
        ids.insert(newIndex, id);
        notifier.reorder(ids);
      },
      itemBuilder: (context, i) {
        final section = sections[i];
        final focusNew = _focusNewId == section.id;
        if (focusNew) {
          // Consumed once — a rebuild after this must not re-focus a card the
          // team member has since clicked away from.
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted && _focusNewId == section.id) {
              setState(() => _focusNewId = null);
            }
          });
        }
        return Padding(
          key: ValueKey('${section.id}-$_epoch'),
          padding: const EdgeInsets.only(bottom: 10),
          child: RepaintBoundary(
            child: SkillSectionCard(
              groupId: widget.group.id,
              section: section,
              reorderIndex: i,
              color: SkillSectionPalette.forPosition(i),
              expanded: _expandedIds.contains(section.id),
              autofocusHeading: focusNew,
              onToggleExpanded: (value) => setState(() {
                if (value) {
                  _expandedIds.add(section.id);
                } else {
                  _expandedIds.remove(section.id);
                }
              }),
              onDelete: () => _confirmDelete(context, notifier, section),
              mentionTokens: _tokens,
              ownMentionToken: mentionTokenFor(widget.group, section),
            ),
          ),
        );
      },
    );
  }

  /// The opt-in for a deck the name-to-role table does not know: pick which gem
  /// it configures, and it gets the same two cards as any other.
  Future<void> _addGemSetup(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final role = await showDialog<SkillGemRole>(
      context: context,
      builder: (context) => SimpleDialog(
        title: Text(l10n.skillsGemAddDialogTitle),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 0, 24, 8),
            child: Text(l10n.skillsGemAddDialogBody),
          ),
          for (final option in SkillGemRole.values)
            SimpleDialogOption(
              onPressed: () => Navigator.of(context).pop(option),
              child: Text(skillGemRoleLabel(l10n, option)),
            ),
        ],
      ),
    );
    if (role == null) return;
    await ref
        .read(skillGemSetupControllerProvider(widget.group.id).notifier)
        .enable(role);
  }

  Future<void> _confirmDelete(
    BuildContext context,
    SkillGroupController notifier,
    SkillSection section,
  ) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.skillsDeleteCard),
        content: Text(
          l10n.skillsDeleteCardConfirm(
            section.heading.trim().isEmpty
                ? l10n.skillsCardUntitled
                : section.heading,
          ),
        ),
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
    if (confirmed ?? false) await notifier.deleteSection(section.id);
  }

  Widget _buildPreview(
    BuildContext context,
    List<SkillSection> sections,
  ) {
    final l10n = AppLocalizations.of(context);
    if (sections.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(l10n.skillsDeckEmpty, textAlign: TextAlign.center),
        ),
      );
    }
    return SingleChildScrollView(
      controller: _rightScroll,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < sections.length; i++)
            Padding(
              key: ValueKey(sections[i].id),
              padding: const EdgeInsets.only(bottom: 10),
              // Each block is its own layer: typing in one card repaints that
              // block only, and scrolling just moves the cached layers.
              child: RepaintBoundary(
                child: _PreviewSection(
                  section: sections[i],
                  color: SkillSectionPalette.forPosition(i),
                  resolvedBody: _resolveBody(sections[i]),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _PreviewSection extends StatelessWidget {
  const _PreviewSection({
    required this.section,
    required this.color,
    required this.resolvedBody,
  });

  final SkillSection section;
  final SkillSectionPalette color;
  final String resolvedBody;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);

    return Opacity(
      opacity: section.teamOnly ? 0.6 : 1,
      child: Container(
        width: double.infinity,
        decoration: BoxDecoration(
          color: color.previewTint(context, dimmed: section.teamOnly),
          borderRadius: BorderRadius.circular(10),
          border:
              Border.all(color: color.accent(context).withValues(alpha: 0.5)),
        ),
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    section.heading.trim().isEmpty
                        ? l10n.skillsCardUntitled
                        : section.heading,
                    // Same as a `# ` heading in the exported markdown.
                    style: theme.textTheme.headlineSmall,
                  ),
                ),
                if (section.teamOnly)
                  Chip(
                    label: Text(l10n.skillsTeamOnlyBadge),
                    visualDensity: VisualDensity.compact,
                  ),
              ],
            ),
            const SizedBox(height: 8),
            MarkdownPreview(source: resolvedBody),
          ],
        ),
      ),
    );
  }
}
