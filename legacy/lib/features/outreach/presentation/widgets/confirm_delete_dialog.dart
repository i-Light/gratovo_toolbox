import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The one confirmation shape every outreach delete uses: a plain question,
/// and a destructive-colored confirm.
///
/// Returns false when the dialog is dismissed any other way, so a barrier tap
/// can never delete anything. Shared rather than copied because the two
/// callers — a whole conversation, one recorded message — now live in
/// different files, and a confirm dialog that drifts between them is a confirm
/// dialog people stop reading.
Future<bool> confirmDelete(
  BuildContext context, {
  required String title,
  required String body,
}) async {
  final l10n = AppLocalizations.of(context);
  final answer = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(title),
      content: Text(body),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: Text(l10n.commonCancel),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: Theme.of(dialogContext).colorScheme.error,
            foregroundColor: Theme.of(dialogContext).colorScheme.onError,
          ),
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: Text(l10n.commonDelete),
        ),
      ],
    ),
  );
  return answer ?? false;
}
