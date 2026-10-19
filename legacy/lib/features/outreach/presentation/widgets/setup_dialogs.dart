import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/template_library_card.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/writing_rules_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The two page-level Outreach settings — the template library and the shared
/// writing rules — as dialogs opened from the app bar.
///
/// They used to be two collapsed cards stacked above the conversation list,
/// which cost a strip of every visit to a page whose actual job is reading and
/// answering messages. Neither is edited more than occasionally, and both are
/// about the page as a whole rather than about the open conversation, which is
/// what makes an app-bar icon the right shape for them.

Future<void> showTemplateLibraryDialog(BuildContext context) {
  return _showSetupDialog(
    context,
    title: AppLocalizations.of(context).outreachTemplatesTitle,
    child: const TemplateLibraryCard(),
  );
}

Future<void> showWritingRulesDialog(BuildContext context) {
  return _showSetupDialog(
    context,
    title: AppLocalizations.of(context).outreachWritingRulesTitle,
    child: const WritingRulesCard(),
  );
}

/// A fixed-width, height-capped dialog for both.
///
/// The cap matters more than it looks: the template library grows with the
/// team's templates, and an `AlertDialog` whose content outgrows the window
/// does not scroll, it overflows. The [ConstrainedBox] plus the scroll view is
/// what keeps a twenty-template library usable on a laptop.
Future<void> _showSetupDialog(
  BuildContext context, {
  required String title,
  required Widget child,
}) {
  return showDialog<void>(
    context: context,
    builder: (dialogContext) {
      final l10n = AppLocalizations.of(dialogContext);
      final maxHeight = MediaQuery.sizeOf(dialogContext).height * 0.7;
      return AlertDialog(
        title: Text(title),
        content: SizedBox(
          width: 520,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: maxHeight),
            child: SingleChildScrollView(child: child),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(l10n.commonClose),
          ),
        ],
      );
    },
  );
}
