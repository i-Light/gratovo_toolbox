import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/data/models/email_tag.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/tag_ordering.dart';

/// A one-line, horizontally scrollable vocabulary — the stage tags.
///
/// Two deliberate properties, both about never having to hunt for what you
/// just chose:
///
///  * **Selected tags sort to the front**, in vocabulary order among
///    themselves; everything else keeps its normal order behind them. The tags
///    that are on are always the leading ones, whatever you have scrolled to.
///  * **Unselected tags are faded**, so on and off read at a glance instead of
///    needing one chip's fill to be compared against its neighbour's.
///
/// The add button is pinned outside the scroll view rather than being the
/// first chip inside it. As a chip it would scroll away, and a control you
/// have to scroll back to is not one that is always at the beginning.
class TagSelectionRow extends StatelessWidget {
  const TagSelectionRow({
    super.key,
    required this.tags,
    required this.selectedIds,
    required this.onToggle,
    required this.onAdd,
    this.addTooltip,
  });

  final List<EmailTag> tags;
  final Set<String> selectedIds;
  final ValueChanged<EmailTag> onToggle;
  final VoidCallback onAdd;
  final String? addTooltip;

  @override
  Widget build(BuildContext context) {
    final ordered = orderSelectedFirst(tags, selectedIds);

    return Row(
      children: [
        AddTagButton(onPressed: onAdd, tooltip: addTooltip),
        const SizedBox(width: 8),
        Expanded(
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            // Clamping rather than the platform default: an overscroll glow at
            // the end of a 4-chip row reads as a glitch, not as a boundary.
            physics: const ClampingScrollPhysics(),
            child: Row(
              children: [
                for (final tag in ordered)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: TagChip(
                      label: tag.label,
                      selected: selectedIds.contains(tag.id),
                      onTap: () => onToggle(tag),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// One tag, on or off.
///
/// A [FilterChip] rather than a [ChoiceChip] because these are genuinely
/// multi-select: an email can be both a follow-up and a close. The fade on the
/// unselected state covers the whole chip — label and outline together — so a
/// long row reads as "these few are on" rather than as a wall of chips.
class TagChip extends StatelessWidget {
  const TagChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final chip = FilterChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) => onTap(),
      showCheckmark: false,
      visualDensity: VisualDensity.compact,
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
    );
    // 0.55 rather than something fainter: an unselected tag still has to be
    // readable enough to pick, it is only being pushed behind the selected ones.
    return selected ? chip : Opacity(opacity: 0.55, child: chip);
  }
}

/// The "+" that opens the add-a-tag dialog.
///
/// Shared by both selection controls so they cannot drift apart visually, and
/// sized to a chip's height so it sits on the same line as one.
class AddTagButton extends StatelessWidget {
  const AddTagButton({super.key, required this.onPressed, this.tooltip});

  final VoidCallback onPressed;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    return IconButton.filledTonal(
      onPressed: onPressed,
      tooltip: tooltip,
      visualDensity: VisualDensity.compact,
      constraints: const BoxConstraints.tightFor(width: 32, height: 32),
      padding: EdgeInsets.zero,
      iconSize: 18,
      icon: const Icon(Icons.add),
    );
  }
}
