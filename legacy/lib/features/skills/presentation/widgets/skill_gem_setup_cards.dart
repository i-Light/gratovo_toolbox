import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/skill_gem_setup.dart';
import 'package:gratovo_toolbox/features/skills/application/skill_gem_setup_controller.dart';
import 'package:gratovo_toolbox/features/skills/presentation/widgets/skill_gem_labels.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The two permanent Gemini gem cards at the top of a skill deck: "Gem · name &
/// description" and "Gem · instructions".
///
/// Permanent because they sit outside the deck's reorderable list — no drag
/// handle, no delete, always first. And never part of the skill: they are read
/// from `skill_gem_setup`, not from the deck's cards, so none of the export,
/// the word count, the `@` menu or the preview can see them (see
/// [SkillGemSetup]). Renders nothing for a deck with no gem.
class SkillGemSetupCards extends ConsumerStatefulWidget {
  const SkillGemSetupCards({super.key, required this.groupId});

  final String groupId;

  @override
  ConsumerState<SkillGemSetupCards> createState() => _SkillGemSetupCardsState();
}

class _SkillGemSetupCardsState extends ConsumerState<SkillGemSetupCards> {
  // Collapsed to a one-line summary by default: the deck's own cards are what
  // this page is for, and two open text areas above them would push them off
  // the screen.
  bool _nameOpen = false;
  bool _instructionsOpen = false;

  @override
  Widget build(BuildContext context) {
    final provider = skillGemSetupControllerProvider(widget.groupId);
    final setup = ref.watch(provider).value;
    if (setup == null) return const SizedBox.shrink();

    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final controller = ref.read(provider.notifier);
    final accent = theme.colorScheme.tertiary;

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: accent.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: accent.withValues(alpha: 0.45)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Icon(Icons.diamond_outlined, size: 18, color: accent),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      l10n.skillsGemBlockTitle,
                      style: theme.textTheme.titleSmall,
                    ),
                  ),
                  _RoleMenu(
                    role: setup.role,
                    onSelected: controller.setRole,
                  ),
                ],
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(26, 2, 0, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.skillsGemBlockNote,
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.outline,
                      ),
                    ),
                    Text(
                      _syncLabel(l10n, setup),
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: accent,
                      ),
                    ),
                  ],
                ),
              ),
              _GemCard(
                accent: accent,
                title: l10n.skillsGemNameCardTitle,
                summary: setup.name,
                expanded: _nameOpen,
                onToggle: () => setState(() => _nameOpen = !_nameOpen),
                child: Column(
                  children: [
                    _GemTextField(
                      value: setup.name,
                      label: l10n.skillsGemNameLabel,
                      onChanged: (value) => controller.edit(name: value),
                    ),
                    const SizedBox(height: 10),
                    _GemTextField(
                      value: setup.description,
                      label: l10n.skillsGemDescriptionLabel,
                      minLines: 2,
                      maxLines: 4,
                      onChanged: (value) => controller.edit(description: value),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              _GemCard(
                accent: accent,
                title: l10n.skillsGemInstructionsCardTitle,
                summary: l10n.skillsGemInstructionsWords(
                  _wordCount(setup.instructions),
                ),
                expanded: _instructionsOpen,
                onToggle: () =>
                    setState(() => _instructionsOpen = !_instructionsOpen),
                child: _GemTextField(
                  value: setup.instructions,
                  label: l10n.skillsGemInstructionsLabel,
                  hint: l10n.skillsGemInstructionsHint,
                  minLines: 6,
                  maxLines: 24,
                  onChanged: (value) => controller.edit(instructions: value),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Where the gem stands against Gemini — pushed by `GemAutoSync`, so this
  /// says what will happen rather than offering a button.
  static String _syncLabel(AppLocalizations l10n, SkillGemSetup setup) {
    if (setup.hasUrl) {
      return setup.needsSync
          ? l10n.skillsGemSyncPending
          : l10n.skillsGemSyncUpToDate;
    }
    return setup.isEdited
        ? l10n.skillsGemSyncWillCreate
        : l10n.skillsGemSyncDefaults;
  }

  static int _wordCount(String text) {
    final trimmed = text.trim();
    return trimmed.isEmpty ? 0 : trimmed.split(RegExp(r'\s+')).length;
  }
}

/// One of the two gem cards: a header that toggles it (title, a one-line
/// summary while collapsed, and the badge that says it is not exported) and the
/// fields underneath when open.
class _GemCard extends StatelessWidget {
  const _GemCard({
    required this.accent,
    required this.title,
    required this.summary,
    required this.expanded,
    required this.onToggle,
    required this.child,
  });

  final Color accent;
  final String title;
  final String summary;
  final bool expanded;
  final VoidCallback onToggle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);

    return Card(
      clipBehavior: Clip.antiAlias,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: accent.withValues(alpha: 0.55)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: onToggle,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
              child: Row(
                children: [
                  Icon(expanded ? Icons.expand_less : Icons.expand_more),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title, style: theme.textTheme.titleSmall),
                        if (!expanded && summary.trim().isNotEmpty)
                          Text(
                            summary,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: theme.colorScheme.outline,
                            ),
                          ),
                      ],
                    ),
                  ),
                  Tooltip(
                    message: l10n.skillsGemNotExportedTooltip,
                    child: Chip(
                      avatar:
                          const Icon(Icons.visibility_off_outlined, size: 14),
                      label: Text(l10n.skillsGemNotExportedBadge),
                      visualDensity: VisualDensity.compact,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (expanded)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: child,
            ),
        ],
      ),
    );
  }
}

/// A text field that follows [value] from outside and reports what is typed.
///
/// Follows it only while it does not have focus — the same rule
/// `SkillSectionCard` uses for its heading — so a save landing mid-keystroke
/// cannot move the caret out from under whoever is typing, while a value set
/// from outside (a read from Gemini) still shows up.
class _GemTextField extends StatefulWidget {
  const _GemTextField({
    required this.value,
    required this.label,
    required this.onChanged,
    this.hint,
    this.minLines = 1,
    this.maxLines = 1,
  });

  final String value;
  final String label;
  final String? hint;
  final int minLines;
  final int maxLines;
  final ValueChanged<String> onChanged;

  @override
  State<_GemTextField> createState() => _GemTextFieldState();
}

class _GemTextFieldState extends State<_GemTextField> {
  late final TextEditingController _controller;
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.value);
  }

  @override
  void didUpdateWidget(_GemTextField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_focus.hasFocus && widget.value != _controller.text) {
      _controller.text = widget.value;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      focusNode: _focus,
      minLines: widget.minLines,
      maxLines: widget.maxLines,
      onChanged: widget.onChanged,
      decoration: InputDecoration(
        labelText: widget.label,
        hintText: widget.hint,
        alignLabelWithHint: widget.minLines > 1,
        isDense: true,
      ),
    );
  }
}

/// "Used for: Email drafter ▾" — which gem this deck configures, and so which
/// gem-URL setting a created gem's link is written to.
class _RoleMenu extends StatelessWidget {
  const _RoleMenu({required this.role, required this.onSelected});

  final SkillGemRole role;
  final ValueChanged<SkillGemRole> onSelected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);

    return PopupMenuButton<SkillGemRole>(
      tooltip: l10n.skillsGemRoleTooltip,
      initialValue: role,
      onSelected: onSelected,
      itemBuilder: (context) => [
        for (final option in SkillGemRole.values)
          PopupMenuItem(
            value: option,
            child: Text(skillGemRoleLabel(l10n, option)),
          ),
      ],
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              l10n.skillsGemRoleLabel(skillGemRoleLabel(l10n, role)),
              style: theme.textTheme.labelMedium,
            ),
            const Icon(Icons.arrow_drop_down, size: 18),
          ],
        ),
      ),
    );
  }
}
