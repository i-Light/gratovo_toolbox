import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/data/models/skill_section.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/mention_text_field.dart';
import 'package:gratovo_toolbox/features/skills/application/skill_group_controller.dart';
import 'package:gratovo_toolbox/features/skills/presentation/widgets/skill_section_colors.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// One card in a skill's deck, inline and expandable — there is no separate
/// editor page any more. Collapsed, it is a single row: color band, drag
/// handle, heading, team-only toggle, word count, delete. Expanded, its body
/// opens directly beneath that row within the same scrollable deck.
class SkillSectionCard extends ConsumerStatefulWidget {
  const SkillSectionCard({
    super.key,
    required this.groupId,
    required this.section,
    required this.reorderIndex,
    required this.color,
    required this.expanded,
    required this.onToggleExpanded,
    required this.onDelete,
    required this.mentionTokens,
    required this.ownMentionToken,
    required this.autofocusHeading,
  });

  final String groupId;
  final SkillSection section;

  /// This card's index in the enclosing `ReorderableListView` — required by
  /// `ReorderableDragStartListener`, which only the drag handle wears so a
  /// tap elsewhere on the row toggles expansion instead of starting a drag.
  final int reorderIndex;

  final SkillSectionPalette color;
  final bool expanded;

  /// Asked to change expansion. The card itself, not the caller, is what
  /// refuses to collapse while [SkillSection.isUnnamed] is true — see
  /// [_requestCollapse].
  final ValueChanged<bool> onToggleExpanded;

  final VoidCallback onDelete;

  /// Every card's `@` token, sorted, shared by the whole deck. This card drops
  /// [ownMentionToken] from it only when its body is open (see
  /// `mentionSuggestionsExcluding` for why a card is never offered itself), so
  /// a collapsed card costs nothing per keystroke elsewhere in the deck.
  final List<String> mentionTokens;
  final String ownMentionToken;

  final bool autofocusHeading;

  @override
  ConsumerState<SkillSectionCard> createState() => _SkillSectionCardState();
}

class _SkillSectionCardState extends ConsumerState<SkillSectionCard> {
  late final TextEditingController _heading;
  late final TextEditingController _body;
  final _headingFocus = FocusNode();
  bool _unnamed = false;

  // The last text each field reported. A `TextEditingController` also notifies
  // on caret and selection moves; without this every click into a card looked
  // like an edit — bumping its `updatedAt`, lighting up undo and queueing a
  // save and export.
  late String _lastHeading;
  late String _lastBody;

  @override
  void initState() {
    super.initState();
    _heading = TextEditingController(text: widget.section.heading);
    _body = TextEditingController(text: widget.section.body);
    _unnamed = widget.section.isUnnamed;
    _lastHeading = _heading.text;
    _lastBody = _body.text;
    _heading.addListener(_onHeadingChanged);
    _body.addListener(_onBodyChanged);
    if (widget.autofocusHeading) {
      SchedulerBinding.instance
          .addPostFrameCallback((_) => _headingFocus.requestFocus());
    }
  }

  @override
  void didUpdateWidget(SkillSectionCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Only overwrite a controller from the provider's copy when this field
    // does not have focus — otherwise a debounced save landing mid-keystroke
    // would move the caret out from under whoever is typing.
    if (!_headingFocus.hasFocus && widget.section.heading != _heading.text) {
      // Adopting the provider's copy is not an edit, so it must not echo back.
      _lastHeading = widget.section.heading;
      _heading.text = widget.section.heading;
    }
  }

  void _onHeadingChanged() {
    if (_heading.text == _lastHeading) return;
    _lastHeading = _heading.text;
    ref
        .read(skillGroupControllerProvider(widget.groupId).notifier)
        .edit(widget.section.id, heading: _heading.text);
    final unnamed = _heading.text.trim().isEmpty;
    if (unnamed != _unnamed) setState(() => _unnamed = unnamed);
  }

  void _onBodyChanged() {
    if (_body.text == _lastBody) return;
    _lastBody = _body.text;
    ref
        .read(skillGroupControllerProvider(widget.groupId).notifier)
        .edit(widget.section.id, body: _body.text);
  }

  @override
  void dispose() {
    _heading.removeListener(_onHeadingChanged);
    _body.removeListener(_onBodyChanged);
    _heading.dispose();
    _body.dispose();
    _headingFocus.dispose();
    super.dispose();
  }

  void _requestCollapse() {
    if (!widget.expanded) {
      widget.onToggleExpanded(true);
      return;
    }
    if (_unnamed) {
      final l10n = AppLocalizations.of(context);
      AppToast.warning(context, l10n.skillsNameRequired);
      _headingFocus.requestFocus();
      return;
    }
    widget.onToggleExpanded(false);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final section = widget.section;

    final headerRow = Row(
      children: [
        ReorderableDragStartListener(
          index: widget.reorderIndex,
          child: const Padding(
            padding: EdgeInsets.symmetric(horizontal: 6),
            child: Icon(Icons.drag_indicator, size: 20),
          ),
        ),
        // A dedicated button rather than a tap-anywhere-in-the-row InkWell:
        // the row also holds the heading `TextField` and several
        // `IconButton`s, and a `TextField` nested inside an `InkWell` does
        // not cleanly cede the tap to it — both end up handling the same
        // touch, so tapping into the heading to type would also toggle the
        // card closed.
        IconButton(
          tooltip:
              widget.expanded ? l10n.skillsCollapseAll : l10n.skillsExpandAll,
          icon: Icon(
            widget.expanded ? Icons.expand_less : Icons.expand_more,
          ),
          onPressed: _requestCollapse,
        ),
        Expanded(
          child: TextField(
            controller: _heading,
            focusNode: _headingFocus,
            style: theme.textTheme.titleLarge,
            decoration: InputDecoration(
              isDense: true,
              border: InputBorder.none,
              // The card is a top-level `# ` section of the exported file.
              hintText: l10n.skillsCardHeadingHint,
              errorText: _unnamed ? l10n.skillsNameRequired : null,
              errorStyle: theme.textTheme.labelSmall?.copyWith(
                color: theme.colorScheme.error,
              ),
            ),
          ),
        ),
        IconButton(
          isSelected: section.teamOnly,
          tooltip: l10n.skillsTeamOnlyToggle,
          icon: const Icon(Icons.visibility),
          selectedIcon: const Icon(Icons.visibility_off_outlined),
          onPressed: () => ref
              .read(skillGroupControllerProvider(widget.groupId).notifier)
              .setTeamOnly(section.id, !section.teamOnly),
        ),
        Text(
          l10n.skillsWordCount(section.wordCount),
          style: theme.textTheme.labelSmall
              ?.copyWith(color: theme.colorScheme.outline),
        ),
        IconButton(
          icon: const Icon(Icons.close, size: 18),
          tooltip: l10n.skillsDeleteCard,
          onPressed: widget.onDelete,
        ),
      ],
    );

    return Card(
      clipBehavior: Clip.antiAlias,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(
          color: widget.color.accent(context).withValues(alpha: 0.55),
        ),
      ),
      child: Container(
        color: widget.color.fill(context, dimmed: section.teamOnly),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 4, 4, 4),
              child: headerRow,
            ),
            if (widget.expanded)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: MentionTextField(
                  controller: _body,
                  keywords: [
                    for (final token in widget.mentionTokens)
                      if (token != widget.ownMentionToken) token,
                  ],
                  minLines: 6,
                  multiline: true,
                  hintText: l10n.skillsCardBodyHint,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
