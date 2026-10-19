import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Good / Bad on a draft, with "Not rated" until one is picked.
///
/// Tapping the verdict already chosen takes it off again. What a tap means —
/// ask why first, save at once — is the caller's: the card saves straight
/// away, the editor waits for Save.
class EmailVerdictChips extends StatelessWidget {
  const EmailVerdictChips({
    super.key,
    required this.verdict,
    required this.onChanged,
    this.keyPrefix = 'email-verdict',
  });

  final EmailVerdict? verdict;

  /// Null while a change is in flight.
  final ValueChanged<EmailVerdict?>? onChanged;

  /// Distinguishes several sets on one screen in tests (one per card).
  final String keyPrefix;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    Widget chip(EmailVerdict value, String label, IconData icon, Color color) {
      final selected = verdict == value;
      return FilterChip(
        key: ValueKey('$keyPrefix-${value.storageValue}'),
        visualDensity: VisualDensity.compact,
        showCheckmark: false,
        avatar: Icon(icon, size: 16, color: selected ? color : scheme.outline),
        label: Text(label),
        selected: selected,
        onSelected: onChanged == null
            ? null
            : (_) => onChanged!(selected ? null : value),
      );
    }

    return Wrap(
      spacing: 6,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (verdict == null)
          Text(
            l10n.emailLibraryUnrated,
            key: ValueKey('$keyPrefix-unrated'),
            style: theme.textTheme.labelSmall?.copyWith(
              color: scheme.tertiary,
              fontWeight: FontWeight.w600,
            ),
          ),
        chip(EmailVerdict.good, l10n.emailLibraryVerdictGood,
            Icons.thumb_up_alt_outlined, Colors.green.shade700),
        chip(EmailVerdict.bad, l10n.emailLibraryVerdictBad,
            Icons.thumb_down_alt_outlined, scheme.error),
      ],
    );
  }
}

/// Asks why a draft got [verdict]. Returns the text (possibly empty for a
/// good one), or null when the person cancelled.
///
/// A bad verdict needs its reason: it becomes a regression case, and the
/// factory's judge is told to look for exactly that fault, so Save stays off
/// until something is typed.
Future<String?> showVerdictNoteDialog(
  BuildContext context, {
  required EmailVerdict verdict,
  String initial = '',
}) {
  return showDialog<String>(
    context: context,
    builder: (context) =>
        _VerdictNoteDialog(verdict: verdict, initial: initial),
  );
}

class _VerdictNoteDialog extends StatefulWidget {
  const _VerdictNoteDialog({required this.verdict, required this.initial});

  final EmailVerdict verdict;
  final String initial;

  @override
  State<_VerdictNoteDialog> createState() => _VerdictNoteDialogState();
}

class _VerdictNoteDialogState extends State<_VerdictNoteDialog> {
  late final _note = TextEditingController(text: widget.initial);

  bool get _required => widget.verdict == EmailVerdict.bad;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  void _save() {
    if (_required && _note.text.trim().isEmpty) return;
    Navigator.of(context).pop(_note.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return AlertDialog(
      title: Text(
        _required
            ? l10n.emailLibraryVerdictWhyBad
            : l10n.emailLibraryVerdictWhyGood,
      ),
      content: SizedBox(
        width: 480,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.emailLibraryVerdictWhyHint,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('email-verdict-note'),
              controller: _note,
              autofocus: true,
              minLines: 2,
              maxLines: 6,
              decoration: InputDecoration(
                border: const OutlineInputBorder(),
                helperText:
                    _required ? l10n.emailLibraryVerdictWhyRequired : null,
                helperMaxLines: 2,
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
        ListenableBuilder(
          listenable: _note,
          builder: (context, _) => FilledButton(
            key: const ValueKey('email-verdict-save'),
            onPressed: _required && _note.text.trim().isEmpty ? null : _save,
            child: Text(l10n.commonSave),
          ),
        ),
      ],
    );
  }
}

/// The source's badge on a card, or null for a video record — the library's
/// original kind needs no label.
String? emailSourceBadge(AppLocalizations l10n, EmailRecordSource source) =>
    switch (source) {
      EmailRecordSource.video => null,
      EmailRecordSource.testDraft => l10n.emailLibraryBadgeTestDraft,
      EmailRecordSource.appDraft => l10n.emailLibraryBadgeAppDraft,
      EmailRecordSource.mine => l10n.emailLibraryBadgeMine,
    };
