import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gratovo_toolbox/core/utils/timecode.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The timecode control: three number boxes you can spin with the mouse wheel.
///
/// A timecode is read off a paused video player and typed while looking at
/// something else, so the cost that matters is not keystrokes — it is the
/// glance back at the keyboard to find the colon. Three separate segments with
/// a wheel over each one turn the whole field into a pointing task.
///
/// The parent still owns a plain [TextEditingController] holding `h:mm:ss`,
/// which is what the record is built from and what the "open at this timecode"
/// button reads. This widget is a view onto that text: it parses it into
/// segments on the way in and writes the whole thing back on every change, so
/// nothing upstream has to know the field is segmented.
class TimecodeField extends StatefulWidget {
  const TimecodeField({
    super.key,
    required this.controller,
    this.isValid = true,
  });

  final TextEditingController controller;

  /// False while the held text cannot be parsed. Segments make that all but
  /// impossible to type, but the parent still decides what is valid and the
  /// field has to be able to say so.
  final bool isValid;

  @override
  State<TimecodeField> createState() => _TimecodeFieldState();
}

/// Exclusive upper bound per segment: hours 0-23, minutes and seconds 0-59.
///
/// Wrapping is what makes the wheel worth using — 0 is one notch down from 59,
/// not fifty-nine notches — so these are moduli, not clamps.
const List<int> _segmentLimits = [24, 60, 60];

class _TimecodeFieldState extends State<TimecodeField> {
  final _controllers = List.generate(3, (_) => TextEditingController());
  final _focusNodes = List.generate(3, (_) => FocusNode());

  /// Set while this widget is the one writing to [TimecodeField.controller], so
  /// the listener below does not tear the segments apart mid-edit by parsing
  /// back the text it just produced.
  bool _writingBack = false;

  @override
  void initState() {
    super.initState();
    _readFromController();
    widget.controller.addListener(_readFromController);
    for (final node in _focusNodes) {
      // A segment left half-typed ("5" in the minutes box) is padded on the
      // way out, so the field never shows a shape it would not accept.
      node.addListener(_onFocusChanged);
    }
  }

  @override
  void didUpdateWidget(TimecodeField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_readFromController);
      widget.controller.addListener(_readFromController);
      _readFromController();
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_readFromController);
    for (final node in _focusNodes) {
      node.removeListener(_onFocusChanged);
      node.dispose();
    }
    for (final controller in _controllers) {
      controller.dispose();
    }
    super.dispose();
  }

  /// Pulls `h:mm:ss` out of the parent controller and into the three boxes.
  ///
  /// Runs whenever the parent's text changes from the outside — which in this
  /// editor means "save and add another" clearing the field for the next
  /// record, and the dialog opening on an existing row.
  void _readFromController() {
    if (_writingBack) return;
    final seconds = parseTimecode(widget.controller.text);
    final next = seconds == null
        ? const ['', '', '']
        : [
            _pad(seconds ~/ 3600),
            _pad((seconds % 3600) ~/ 60),
            _pad(seconds % 60),
          ];
    for (var i = 0; i < 3; i++) {
      if (_controllers[i].text != next[i]) _controllers[i].text = next[i];
    }
  }

  /// Composes the three boxes back into the text the record is saved from.
  ///
  /// Always written in full `h:mm:ss` form even when the hour is zero: this is
  /// machine-facing text, and [formatTimecode]'s habit of dropping an empty
  /// hour is a reading convenience that would only cost a parse here.
  void _writeToController() {
    final values = _controllers.map((c) => c.text.trim()).toList();
    final text = values.every((value) => value.isEmpty)
        ? ''
        : '${int.tryParse(values[0]) ?? 0}:'
            '${_pad(int.tryParse(values[1]) ?? 0)}:'
            '${_pad(int.tryParse(values[2]) ?? 0)}';
    if (widget.controller.text == text) return;
    _writingBack = true;
    widget.controller.text = text;
    _writingBack = false;
  }

  void _onFocusChanged() {
    var changed = false;
    for (var i = 0; i < 3; i++) {
      if (_focusNodes[i].hasFocus) continue;
      final text = _controllers[i].text;
      if (text.isEmpty || text.length == 2) continue;
      _controllers[i].text = _pad(int.tryParse(text) ?? 0);
      changed = true;
    }
    if (changed) _writeToController();
  }

  void _onSegmentChanged(int index, String value) {
    _writeToController();
    // Two digits is the whole segment, so the caret has nothing left to do
    // here. Advancing means h-m-s can be typed as six uninterrupted digits.
    if (value.length == 2 && index < 2) {
      _focusNodes[index + 1].requestFocus();
      _controllers[index + 1].selection = TextSelection(
        baseOffset: 0,
        extentOffset: _controllers[index + 1].text.length,
      );
    }
  }

  /// Moves one segment by [delta] notches, wrapping at both ends.
  void _bump(int index, int delta) {
    final limit = _segmentLimits[index];
    final current = int.tryParse(_controllers[index].text) ?? 0;
    final next = (current + delta) % limit;
    _controllers[index].text = _pad(next < 0 ? next + limit : next);
    // Spinning one segment of an empty field means a timecode is being
    // entered, so the other two stop being blank and become zeroes — a
    // half-filled `:30:` would otherwise save as something it does not show.
    for (final controller in _controllers) {
      if (controller.text.isEmpty) controller.text = '00';
    }
    _writeToController();
  }

  static String _pad(int value) => value.toString().padLeft(2, '0');

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final labels = [
      l10n.emailLibraryTimecodeHours,
      l10n.emailLibraryTimecodeMinutes,
      l10n.emailLibraryTimecodeSeconds,
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Tooltip(
          message: l10n.emailLibraryTimecodeScrollHint,
          waitDuration: const Duration(milliseconds: 700),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (var i = 0; i < 3; i++) ...[
                if (i > 0) const _Colon(),
                Flexible(
                  child: _Segment(
                    controller: _controllers[i],
                    focusNode: _focusNodes[i],
                    limit: _segmentLimits[i],
                    semanticsLabel: labels[i],
                    onChanged: (value) => _onSegmentChanged(i, value),
                    onBump: (delta) => _bump(i, delta),
                  ),
                ),
              ],
            ],
          ),
        ),
        if (!widget.isValid)
          Padding(
            padding: const EdgeInsets.only(top: 6, left: 4),
            child: Text(
              l10n.emailLibraryTimecodeInvalid,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.error),
            ),
          ),
      ],
    );
  }
}

class _Colon extends StatelessWidget {
  const _Colon();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 3),
      child: Text(
        ':',
        style: theme.textTheme.titleMedium?.copyWith(
          color: theme.colorScheme.outline,
        ),
      ),
    );
  }
}

/// One number box: typed like a text field, spun like a wheel.
class _Segment extends StatelessWidget {
  const _Segment({
    required this.controller,
    required this.focusNode,
    required this.limit,
    required this.semanticsLabel,
    required this.onChanged,
    required this.onBump,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final int limit;
  final String semanticsLabel;
  final ValueChanged<String> onChanged;
  final ValueChanged<int> onBump;

  /// Claims the wheel event for this box instead of letting it fall through.
  ///
  /// The editor is one tall scroll view, so without the resolver a spin over
  /// the field would both change the number and scroll the form out from under
  /// the pointer. Registering with the resolver is how a widget says "this
  /// signal is mine" — the [Scrollable] registers for the same event and the
  /// innermost claimant wins.
  void _onPointerSignal(PointerSignalEvent event) {
    if (event is! PointerScrollEvent) return;
    final dy = event.scrollDelta.dy;
    if (dy == 0) return;
    GestureBinding.instance.pointerSignalResolver.register(
      event,
      // Wheel up counts up, which is the direction every other spinner on the
      // desktop moves. The wrap at each end is in [_TimecodeFieldState._bump].
      (_) => onBump(dy < 0 ? 1 : -1),
    );
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    // Arrow keys do the same job as the wheel here. In a one-line box of two
    // digits they have no caret movement worth preserving, and a keyboard-only
    // pass over the form should not be the slow way to enter a timecode.
    if (event.logicalKey == LogicalKeyboardKey.arrowUp) {
      onBump(1);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowDown) {
      onBump(-1);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      onPointerSignal: _onPointerSignal,
      child: Focus(
        onKeyEvent: _onKey,
        // A key handler in the tree, not a focus stop of its own — the segment
        // it wraps is the thing that takes focus.
        canRequestFocus: false,
        skipTraversal: true,
        child: Semantics(
          label: semanticsLabel,
          child: TextField(
            controller: controller,
            focusNode: focusNode,
            textAlign: TextAlign.center,
            keyboardType: TextInputType.number,
            inputFormatters: [_SegmentFormatter(limit)],
            onChanged: onChanged,
            // Landing in a full box and typing should replace the number, not
            // append a third digit the formatter would then refuse.
            onTap: () => controller.selection = TextSelection(
              baseOffset: 0,
              extentOffset: controller.text.length,
            ),
            decoration: const InputDecoration(
              isDense: true,
              hintText: '00',
              border: OutlineInputBorder(),
              contentPadding: EdgeInsets.symmetric(horizontal: 4, vertical: 12),
            ),
          ),
        ),
      ),
    );
  }
}

/// Keeps a segment to at most two digits and below its limit.
///
/// Rejecting the keystroke rather than clamping the result is the difference
/// between "65 is not a number of minutes" and a field that silently rewrites
/// what was typed into something else. Nothing out of range ever lands in the
/// box, which is why the error line above it is close to unreachable.
class _SegmentFormatter extends TextInputFormatter {
  const _SegmentFormatter(this.limit);

  final int limit;

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final text = newValue.text;
    if (text.isEmpty) return newValue;
    if (text.length > 2) return oldValue;
    if (!RegExp(r'^\d+$').hasMatch(text)) return oldValue;
    return int.parse(text) >= limit ? oldValue : newValue;
  }
}
