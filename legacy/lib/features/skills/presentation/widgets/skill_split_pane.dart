import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

/// Below this width there is no room for two panes side by side.
const double skillWideLayoutThreshold = 760;
const double _minPaneWidth = 320;
const double _splitterWidth = 16;

/// The deck | preview layout of every skill deck (`SkillGroupDeck`,
/// `OutreachCardsDeck`). Owns the resize gesture so a drag frame touches
/// only the two pane widths: [deck] and [preview] arrive pre-built, and being
/// the identical widgets each frame, Flutter re-lays them out but never
/// rebuilds them.
class SkillSplitPane extends StatefulWidget {
  const SkillSplitPane({
    super.key,
    required this.fraction,
    required this.showPreview,
    required this.deck,
    required this.preview,
  });

  final ValueNotifier<double> fraction;
  final bool showPreview;
  final Widget deck;
  final Widget preview;

  @override
  State<SkillSplitPane> createState() => _SkillSplitPaneState();
}

class _SkillSplitPaneState extends State<SkillSplitPane> {
  /// Where inside the splitter the pointer took hold, so the bar does not jump
  /// to centre itself under the cursor when a drag starts off-centre.
  double _grabOffset = 0;

  double _clampLeft(double total, double left) {
    final max = total - _minPaneWidth - _splitterWidth;
    return left.clamp(_minPaneWidth, max < _minPaneWidth ? _minPaneWidth : max);
  }

  double _leftWidth(double total, double fraction) =>
      _clampLeft(total, total * fraction - _splitterWidth / 2);

  double get _totalWidth =>
      (context.findRenderObject() as RenderBox).size.width;

  /// The pointer's distance from the leading edge of the pane area — the
  /// absolute position, not an accumulated delta, so the bar stays under the
  /// cursor even after it has been dragged past a limit and back. Mirrored in
  /// right-to-left, where the deck sits on the right.
  double _pointerX(double globalX) {
    final box = context.findRenderObject() as RenderBox;
    final x = box.globalToLocal(Offset(globalX, 0)).dx;
    return Directionality.of(context) == TextDirection.rtl
        ? box.size.width - x
        : x;
  }

  void _onDragStart(double globalX) {
    final barCentre =
        _leftWidth(_totalWidth, widget.fraction.value) + _splitterWidth / 2;
    _grabOffset = _pointerX(globalX) - barCentre;
  }

  void _onDragUpdate(double globalX) {
    final total = _totalWidth;
    final left = _clampLeft(
      total,
      _pointerX(globalX) - _grabOffset - _splitterWidth / 2,
    );
    widget.fraction.value = (left + _splitterWidth / 2) / total;
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (!widget.showPreview) return widget.deck;
        if (constraints.maxWidth < skillWideLayoutThreshold) {
          return widget.preview;
        }

        final total = constraints.maxWidth;
        return ValueListenableBuilder<double>(
          valueListenable: widget.fraction,
          builder: (context, fraction, _) => Row(
            children: [
              SizedBox(width: _leftWidth(total, fraction), child: widget.deck),
              _SkillsSplitter(
                key: const ValueKey('skills-splitter'),
                onDragStart: _onDragStart,
                onDragUpdate: _onDragUpdate,
              ),
              Expanded(child: widget.preview),
            ],
          ),
        );
      },
    );
  }
}

/// The draggable divider between the deck and the preview — same shape as
/// `_PanelSplitter` in `search_screen.dart`, kept local rather than shared
/// since it is a small gesture wrapper, not worth a cross-feature widget.
///
/// Takes hold on pointer-down rather than after the touch-slop, so it follows
/// the cursor from the first pixel instead of lurching once the slop is
/// crossed, and lights up while hovered or dragged so it is clear it is live.
class _SkillsSplitter extends StatefulWidget {
  const _SkillsSplitter({
    super.key,
    required this.onDragStart,
    required this.onDragUpdate,
  });

  final ValueChanged<double> onDragStart;
  final ValueChanged<double> onDragUpdate;

  @override
  State<_SkillsSplitter> createState() => _SkillsSplitterState();
}

class _SkillsSplitterState extends State<_SkillsSplitter> {
  bool _hovering = false;
  bool _dragging = false;

  void _setDragging(bool value) {
    if (_dragging != value) setState(() => _dragging = value);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final active = _hovering || _dragging;
    final color =
        active ? theme.colorScheme.primary : theme.colorScheme.outlineVariant;
    return MouseRegion(
      cursor: SystemMouseCursors.resizeLeftRight,
      onEnter: (_) => setState(() => _hovering = true),
      onExit: (_) => setState(() => _hovering = false),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        dragStartBehavior: DragStartBehavior.down,
        onHorizontalDragStart: (details) {
          _setDragging(true);
          widget.onDragStart(details.globalPosition.dx);
        },
        onHorizontalDragUpdate: (details) =>
            widget.onDragUpdate(details.globalPosition.dx),
        onHorizontalDragEnd: (_) => _setDragging(false),
        onHorizontalDragCancel: () => _setDragging(false),
        child: SizedBox(
          width: _splitterWidth,
          height: double.infinity,
          child: Center(
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 120),
              width: active ? 4 : 3,
              height: active ? 64 : 40,
              decoration: BoxDecoration(
                color: color,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
