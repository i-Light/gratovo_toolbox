import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// A bounded integer field for the analytics filters: type a number, spin it
/// with the mouse wheel over the field, or nudge it with the up/down arrows
/// inside it. An empty field means "no limit on this side" — the same
/// vocabulary the rest of the filter uses.
///
/// **The commit model is deliberately split.** Typed input commits on submit
/// and on focus loss, not per keystroke: "1000" typed a digit at a time would
/// otherwise fire four aggregates over the whole channel table, three of them
/// for a bound nobody meant. The wheel and the arrows are discrete, deliberate
/// actions, so they commit immediately — one aggregate each, the same as
/// changing a dropdown.
///
/// Stateful because it owns a controller: rebuilding a [TextField] with a fresh
/// controller every time the query changes would move the caret to the start
/// mid-typing.
class SteppedNumberField extends StatefulWidget {
  const SteppedNumberField({
    super.key,
    required this.label,
    required this.value,
    required this.onCommitted,
    this.step = 1,
    this.width = 172,
    this.clearBelowZero = false,
    this.activeColor,
  });

  final String label;
  final int? value;

  /// Non-null when this bound is actually constraining — the outline and label
  /// take this color so the control shows it is in effect. Cleared, or (for a
  /// lower bound) zero, means no effect and no tint: the caller decides which.
  final Color? activeColor;

  /// Called with the new bound, or `null` when the field is cleared.
  final ValueChanged<int?> onCommitted;

  /// When set, nudging down past zero clears the field instead of stopping at
  /// zero. For upper bounds, where a max of zero would hide everything and so
  /// is never what the person wants — "below zero" reads as "no upper bound".
  final bool clearBelowZero;

  /// One wheel notch, or one arrow tap. Holding Shift multiplies it by ten.
  final int step;

  final double width;

  @override
  State<SteppedNumberField> createState() => _SteppedNumberFieldState();
}

class _SteppedNumberFieldState extends State<SteppedNumberField> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.value?.toString() ?? '');

  @override
  void didUpdateWidget(SteppedNumberField old) {
    super.didUpdateWidget(old);
    // Only when the query changed under us — clearing all the filters, say.
    // Writing the controller on every rebuild would fight the person typing.
    if (widget.value != old.value &&
        widget.value?.toString() != _controller.text) {
      _controller.text = widget.value?.toString() ?? '';
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _commitText() {
    final text = _controller.text.trim();
    widget.onCommitted(text.isEmpty ? null : int.tryParse(text));
  }

  /// Move the value by [direction] (+1 up, -1 down) steps. Clamps at zero — a
  /// negative subscriber bound is not a question anyone is asking — and leaves
  /// an already-empty field empty on a downward nudge rather than filling it
  /// with a zero the person never typed.
  void _nudge(int direction) {
    final text = _controller.text.trim();
    if (text.isEmpty && direction < 0) return;
    final current = int.tryParse(text) ?? 0;
    final multiplier = HardwareKeyboard.instance.isShiftPressed ? 10 : 1;
    final next = current + direction * widget.step * multiplier;
    if (next < 0 && widget.clearBelowZero) {
      _controller.clear();
      widget.onCommitted(null);
      return;
    }
    final clamped = next < 0 ? 0 : next;
    _controller.text = clamped.toString();
    widget.onCommitted(clamped);
  }

  @override
  Widget build(BuildContext context) {
    final tint = widget.activeColor;
    return SizedBox(
      width: widget.width,
      child: Listener(
        onPointerSignal: (event) {
          if (event is PointerScrollEvent) {
            // Register with the resolver rather than acting inline, so the
            // enclosing scroll view does not ALSO consume the same notch and
            // scroll the page out from under the field. This is the pattern
            // the framework's own Slider uses.
            GestureBinding.instance.pointerSignalResolver.register(
              event,
              (resolved) => _nudge(
                (resolved as PointerScrollEvent).scrollDelta.dy < 0 ? 1 : -1,
              ),
            );
          }
        },
        child: Focus(
          // Committing on focus loss as well as on submit: tabbing or clicking
          // out of a box you just typed a number into is the same intent as
          // pressing enter.
          onFocusChange: (hasFocus) {
            if (!hasFocus) _commitText();
          },
          child: TextField(
            controller: _controller,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            textInputAction: TextInputAction.done,
            decoration: InputDecoration(
              labelText: widget.label,
              isDense: true,
              border: const OutlineInputBorder(),
              enabledBorder: tint == null
                  ? null
                  : OutlineInputBorder(borderSide: BorderSide(color: tint)),
              focusedBorder: tint == null
                  ? null
                  : OutlineInputBorder(
                      borderSide: BorderSide(color: tint, width: 2)),
              labelStyle: tint == null ? null : TextStyle(color: tint),
              floatingLabelStyle: tint == null ? null : TextStyle(color: tint),
              suffixIconConstraints:
                  const BoxConstraints(minWidth: 28, minHeight: 40),
              suffixIcon: _Steppers(
                onUp: () => _nudge(1),
                onDown: () => _nudge(-1),
              ),
            ),
            onSubmitted: (_) => _commitText(),
          ),
        ),
      ),
    );
  }
}

/// The up/down chevrons stacked inside the field's trailing edge.
class _Steppers extends StatelessWidget {
  const _Steppers({required this.onUp, required this.onDown});

  final VoidCallback onUp;
  final VoidCallback onDown;

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.onSurfaceVariant;
    Widget arrow(IconData icon, VoidCallback onTap) => InkResponse(
          onTap: onTap,
          radius: 14,
          canRequestFocus: false,
          child: Icon(icon, size: 15, color: color),
        );

    return Column(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        arrow(Icons.keyboard_arrow_up, onUp),
        arrow(Icons.keyboard_arrow_down, onDown),
      ],
    );
  }
}
