import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/data/models/email_tag.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Asks for one new tag label. Returns the trimmed text, or null if cancelled.
///
/// Deliberately does not write anything itself: the caller adds the tag through
/// [EmailLibraryActions] so that "who is allowed to change the library" stays
/// one answer. [initialValue] carries whatever was already typed into the niche
/// search box, so "search for a niche, find nothing, press +" does not mean
/// typing it a second time.
Future<String?> showAddTagDialog(
  BuildContext context, {
  required EmailTagKind kind,
  String initialValue = '',
}) {
  return showDialog<String>(
    context: context,
    builder: (context) => _AddTagDialog(kind: kind, initialValue: initialValue),
  );
}

class _AddTagDialog extends StatefulWidget {
  const _AddTagDialog({required this.kind, required this.initialValue});

  final EmailTagKind kind;
  final String initialValue;

  @override
  State<_AddTagDialog> createState() => _AddTagDialogState();
}

class _AddTagDialogState extends State<_AddTagDialog> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.initialValue);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final value = _controller.text.trim();
    if (value.isEmpty) return;
    Navigator.of(context).pop(value);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return AlertDialog(
      title: Text(
        switch (widget.kind) {
          EmailTagKind.stage => l10n.emailLibraryAddStageTag,
          EmailTagKind.niche => l10n.emailLibraryAddNicheTag,
          EmailTagKind.placeholder => l10n.emailLibraryAddPlaceholderTag,
        },
      ),
      content: TextField(
        controller: _controller,
        autofocus: true,
        // Placeholders are lowercase tokens, not prose, and an auto-capitalised
        // `@Receiver` is a second spelling of a keyword that already exists.
        textCapitalization: widget.kind == EmailTagKind.placeholder
            ? TextCapitalization.none
            : TextCapitalization.sentences,
        // Enter commits — this dialog exists in the middle of typing a record,
        // and reaching for the mouse to confirm one word is the friction the
        // whole page is built to avoid.
        textInputAction: TextInputAction.done,
        onSubmitted: (_) => _submit(),
        decoration: InputDecoration(
          labelText: l10n.emailLibraryTagLabel,
          // A placeholder has a shape the other two do not — it has to survive
          // being read back out of an email body as `@word`.
          helperText: widget.kind == EmailTagKind.placeholder
              ? l10n.emailLibraryPlaceholderHelp
              : l10n.emailLibraryTagLabelHelp,
          border: const OutlineInputBorder(),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
        FilledButton(
          onPressed: _submit,
          child: Text(l10n.emailLibraryAddTag),
        ),
      ],
    );
  }
}
