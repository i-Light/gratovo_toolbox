import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';

/// A [Card] whose body can be folded away, with the title row as the control.
///
/// Written rather than reached for from Material's [ExpansionTile] for two
/// reasons that both matter on the Influencer Profile page. First, the header
/// needs to carry its own controls — a view-mode toggle, a refresh button — and
/// an ExpansionTile's title is not a place where a tappable control can live
/// without fighting the tile's own tap target. Second, the collapsed state has
/// to be able to say something ("based on 12 uploads"), because a card that
/// folds to nothing but its title gives no reason to open it.
///
/// The whole header is the toggle, not just the chevron: a 24-pixel target for
/// something the user opens and closes constantly is needless precision work.
class CollapsibleCard extends StatefulWidget {
  const CollapsibleCard({
    super.key,
    this.title,
    this.titleWidget,
    required this.child,
    this.initiallyExpanded = true,
    this.subtitle,
    this.headerTrailing,
    this.collapsedSummary,
    this.leadingIcon,
    this.gradientBackground = false,
  }) : assert(
          title != null || titleWidget != null,
          'CollapsibleCard needs either title or titleWidget',
        );

  final String? title;

  /// Replaces the default title [Text] outright — for headers that carry
  /// their own styling or status chips (a [Wrap] of a gradient label plus
  /// connection-state chips, as the settings account cards use). Takes over
  /// the whole title row when set; [title] is ignored.
  final Widget? titleWidget;

  /// Always visible, under the title — what the section is for.
  final String? subtitle;

  /// Controls that belong to the section and stay reachable in both states
  /// (a refresh button, a list/card toggle). Kept out of the tap target, so
  /// pressing one does not also fold the card.
  final Widget? headerTrailing;

  /// Shown INSTEAD of [child] while collapsed. The point of a collapsed card
  /// is to take less room, not to become opaque — a one-line answer here is
  /// what makes folding it a saving rather than a loss.
  final Widget? collapsedSummary;

  /// Shown at the start of the header, before the title. Optional — when
  /// omitted, the title starts flush with the header's edge.
  final Widget? leadingIcon;

  /// Renders the card on a [GratovoCard] brand-gradient wash instead of a
  /// plain [Card]. Off by default — reach for it only on a card that
  /// deserves the extra weight, the way [GratovoCard] itself asks for.
  final bool gradientBackground;

  final Widget child;

  /// Cards that carry the page's primary content start open; cards that are a
  /// tool you reach for start closed.
  final bool initiallyExpanded;

  @override
  State<CollapsibleCard> createState() => _CollapsibleCardState();
}

class _CollapsibleCardState extends State<CollapsibleCard> {
  late bool _expanded = widget.initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: InkWell(
                onTap: () => setState(() => _expanded = !_expanded),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 8, 14),
                  child: Row(
                    spacing: 4,
                    children: [
                      // Rotates rather than swapping icons, so the state
                      // change reads as one thing opening instead of two
                      // different glyphs alternating.
                      AnimatedRotation(
                        turns: _expanded ? 0.25 : 0,
                        duration: const Duration(milliseconds: 150),
                        child: Icon(
                          Icons.chevron_right,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(width: 8),
                      if (widget.leadingIcon != null) ...[
                        widget.leadingIcon!,
                        const SizedBox(width: 8),
                      ],
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          // mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            widget.titleWidget ??
                                GradientText(
                                  widget.title!,
                                  style: theme.textTheme.titleMedium,
                                ),
                            if (widget.subtitle != null)
                              Text(
                                widget.subtitle!,
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (widget.headerTrailing != null)
              Padding(
                padding: const EdgeInsetsDirectional.only(end: 8),
                child: widget.headerTrailing,
              ),
          ],
        ),
        if (_expanded)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
            child: widget.child,
          )
        else if (widget.collapsedSummary != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
            child: DefaultTextStyle.merge(
              style: theme.textTheme.bodySmall!.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
              child: widget.collapsedSummary!,
            ),
          ),
      ],
    );

    return widget.gradientBackground
        ? GratovoCard(clipBehavior: Clip.antiAlias, child: content)
        : Card(clipBehavior: Clip.antiAlias, child: content);
  }
}
