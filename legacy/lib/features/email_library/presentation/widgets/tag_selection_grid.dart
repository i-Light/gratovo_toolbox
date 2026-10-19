import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/scroll/smooth_wheel_scroll.dart';
import 'package:gratovo_toolbox/data/models/email_tag.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/tag_ordering.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/tag_selection_row.dart';

/// A searchable, wrapping vocabulary that grows to [maxRows] and then scrolls
/// — the niche tags.
///
/// Same two rules as [TagSelectionRow] (selected first, unselected faded), plus
/// the two things a vocabulary that runs to hundreds of entries needs and a
/// four-entry one does not:
///
///  * **a search box**, because scanning 300 chips is not finding a tag; and
///  * **a height ceiling**, because a control that grows without limit pushes
///    every field under it off the screen as the vocabulary fills up.
///
/// The ceiling is three rows of chips. Past that the area scrolls, and the
/// selected-first ordering is what makes that safe: whatever is currently on is
/// in the first row, so scrolling never hides the current answer.
class TagSelectionGrid extends StatefulWidget {
  const TagSelectionGrid({
    super.key,
    required this.tags,
    required this.selectedIds,
    required this.onToggle,
    required this.onAdd,
    required this.searchHint,
    this.addTooltip,
    this.emptyLabel,
    this.maxRows = 3,
  });

  final List<EmailTag> tags;
  final Set<String> selectedIds;
  final ValueChanged<EmailTag> onToggle;

  /// Given the text currently in the search box, so "type a niche that does
  /// not exist yet, press +" pre-fills the dialog instead of retyping it.
  final ValueChanged<String> onAdd;

  final String searchHint;
  final String? addTooltip;

  /// Shown when the vocabulary is empty or the search matches nothing.
  final String? emptyLabel;

  final int maxRows;

  @override
  State<TagSelectionGrid> createState() => _TagSelectionGridState();
}

class _TagSelectionGridState extends State<TagSelectionGrid> {
  /// Search text lives here, not in the caller's state.
  ///
  /// It is a way of looking at the vocabulary, not part of the record being
  /// edited: it must not survive the editor closing, must not mark the form
  /// dirty, and nothing outside this widget has any use for it.
  final _searchController = TextEditingController();

  /// Where focus parks while niche tags are being picked.
  ///
  /// The chips themselves are outside the traversal order (see below), so a
  /// chip tap has to leave focus somewhere sensible: the search box is the one
  /// control in this area that a keystroke has an obvious meaning for, and it
  /// sits immediately before the next field, so Tab after a tap lands there.
  final _searchFocus = FocusNode();

  static const _spacing = 12.0;

  /// A compact chip's height at text scale 1.0. Multiplied by the viewer's
  /// text scale below, so the ceiling stays three rows rather than three rows
  /// worth of pixels at somebody else's font size.
  static const _chipHeight = 32.0;

  @override
  void dispose() {
    _searchFocus.dispose();
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final query = _searchController.text;
    final visible = orderSelectedFirst(
      filterTagsByQuery(widget.tags, query),
      widget.selectedIds,
    );

    final scaledChip = MediaQuery.textScalerOf(context).scale(_chipHeight);
    final maxHeight =
        scaledChip * widget.maxRows + _spacing * (widget.maxRows - 1);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            AddTagButton(
              onPressed: () => widget.onAdd(query.trim()),
              tooltip: widget.addTooltip,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: _searchController,
                focusNode: _searchFocus,
                onChanged: (_) => setState(() {}),
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  isDense: true,
                  prefixIcon: const Icon(Icons.search, size: 18),
                  prefixIconConstraints:
                      const BoxConstraints.tightFor(width: 34, height: 28),
                  hintText: widget.searchHint,
                  border: const OutlineInputBorder(),
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                  suffixIcon: query.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.close, size: 16),
                          onPressed: () {
                            _searchController.clear();
                            setState(() {});
                          },
                        ),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: _spacing),
        if (visible.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Text(
              widget.emptyLabel ?? '',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.outline),
            ),
          )
        else
          ConstrainedBox(
            constraints: BoxConstraints(maxHeight: maxHeight),
            // The app-wide wheel glide reads as lag in an area this short, so
            // the chips take the plain per-notch scroll instead.
            child: NoSmoothWheelScroll(
              // Deliberately no `Scrollbar` here. On desktop the scroll
              // behaviour already wraps this in one, wired to the scroll
              // view's own controller. A hand-written one has no controller of
              // its own to use, falls back to the enclosing route's
              // PrimaryScrollController — which a desktop scroll view never
              // attaches to — and brings the editor down on the first scroll
              // with "The Scrollbar's ScrollController has no ScrollPosition
              // attached".
              child: SingleChildScrollView(
                // The vocabulary runs to hundreds of chips. Tabbing through
                // them to reach the next field is not navigation, so the chips
                // are kept out of the traversal order entirely: Tab from the
                // search box goes straight to the field after this control.
                // Taps are unaffected — ExcludeFocus only removes focus, not
                // hit testing.
                child: ExcludeFocus(
                  child: Wrap(
                    spacing: _spacing,
                    runSpacing: _spacing,
                    children: [
                      for (final tag in visible)
                        TagChip(
                          label: tag.label,
                          selected: widget.selectedIds.contains(tag.id),
                          onTap: () {
                            widget.onToggle(tag);
                            _searchFocus.requestFocus();
                          },
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
