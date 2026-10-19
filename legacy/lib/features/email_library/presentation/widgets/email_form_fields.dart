import 'package:flutter/material.dart';

/// The small caption above each control in the editor.
///
/// A label of our own rather than [InputDecoration.labelText], because half
/// the "fields" in this editor are not text inputs at all — they are chip rows
/// and a date button — and those have no decoration to hang a label on. One
/// label widget over everything is what keeps the column reading as one form.
class FieldLabel extends StatelessWidget {
  const FieldLabel(this.text, {super.key, this.trailing});

  final String text;

  /// An affordance that belongs to the field rather than to the form — the
  /// "open at this timecode" link, for instance.
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final label = Text(
      text.toUpperCase(),
      style: theme.textTheme.labelSmall?.copyWith(
        color: theme.colorScheme.outline,
        letterSpacing: 0.6,
      ),
    );
    if (trailing == null) return label;
    return Row(
      children: [
        label,
        const Spacer(),
        trailing!,
      ],
    );
  }
}

/// A text field that grows with its content and never scrolls inside itself.
///
/// This is the whole reason the editor's body sits in a page-level scroll view:
/// an email body has to be readable as one block, and a fixed-height box with
/// its own scrollbar makes reading twelve lines a two-handed operation. With
/// `maxLines: null` the field has no height of its own to scroll within — it
/// simply becomes as tall as the text, and the page scrolls.
///
/// [minLines] only sets how much empty space the field claims before anything
/// is typed, so a blank form still looks like it expects a paragraph.
class GrowingTextField extends StatelessWidget {
  const GrowingTextField({
    super.key,
    required this.controller,
    this.minLines = 1,
    this.hintText,
    this.textStyle,
    this.autofocus = false,
    this.focusNode,
    this.textInputAction,
    this.onSubmitted,
  });

  final TextEditingController controller;
  final int minLines;
  final String? hintText;
  final TextStyle? textStyle;
  final bool autofocus;
  final FocusNode? focusNode;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      focusNode: focusNode,
      autofocus: autofocus,
      minLines: minLines,
      // The property that makes this widget what it is. Do not set a maxLines.
      maxLines: null,
      style: textStyle,
      textInputAction: textInputAction,
      onSubmitted: onSubmitted,
      // Belt and braces: with maxLines null there is no viewport to scroll, but
      // this guarantees a stray gesture cannot produce one.
      scrollPhysics: const NeverScrollableScrollPhysics(),
      decoration: InputDecoration(
        hintText: hintText,
        isDense: true,
        border: const OutlineInputBorder(),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      ),
    );
  }
}
