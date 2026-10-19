import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The redaction marker the server sends in place of a withheld value.
///
/// Matches what `email_feed()` substitutes for a field it strips. Declared
/// here so the UI recognises it deliberately rather than by a magic string
/// scattered through widgets — if the server's marker ever changes, this is
/// the one place that has to follow.
const kRedactionMarker = '•••';

/// Explains, at the top of the Emails page, what this account can see.
///
/// The whole point of the redaction being server-side is that a `basic` user
/// gets real data with the sensitive parts genuinely absent. Without this
/// banner that is indistinguishable from a broken page — rows of "•••" where
/// names should be reads as a bug, and the natural response is to file one.
/// Saying it plainly turns the same screen from broken into limited.
class AccessLevelNotice extends StatelessWidget {
  const AccessLevelNotice({super.key, required this.accessLevel});

  final AccessLevel accessLevel;

  @override
  Widget build(BuildContext context) {
    // Full access needs no explanation: everything shown is everything there
    // is, which is what a user already assumes.
    if (accessLevel == AccessLevel.full) return const SizedBox.shrink();

    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final denied = !accessLevel.isAuthorized;
    final color = denied ? theme.colorScheme.error : theme.colorScheme.tertiary;

    return Card(
      color: color.withValues(alpha: 0.08),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              denied ? Icons.lock_outline : Icons.visibility_off_outlined,
              size: 18,
              color: color,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    denied
                        ? l10n.emailsAccessDeniedTitle
                        : l10n.emailsAccessLevelTitle,
                    style: theme.textTheme.labelLarge?.copyWith(color: color),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    denied
                        ? l10n.emailsAccessDeniedBody
                        : l10n.emailsAccessLevelBasic,
                    style: theme.textTheme.bodySmall,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Replaces the whole page for an account with no access at all.
///
/// A full-page refusal rather than an empty list, because the server refuses
/// this read outright: `email_feed()` raises instead of returning nothing.
/// Showing "no conversations yet" here would be a lie in the one direction
/// that matters — it would tell someone the agency has done no outreach.
class EmailsAccessDenied extends StatelessWidget {
  const EmailsAccessDenied({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 460),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.lock_outline,
                size: 40,
                color: theme.colorScheme.error,
              ),
              const SizedBox(height: 16),
              Text(
                l10n.emailsAccessDeniedTitle,
                style: theme.textTheme.titleMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                l10n.emailsAccessDeniedBody,
                style: theme.textTheme.bodyMedium,
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Renders text that may be a server redaction marker.
///
/// A redacted value is styled differently from real text — dimmed, italic, and
/// carrying a tooltip that says why — so it reads as a deliberate omission at
/// a glance rather than as a rendering failure or an empty database field.
/// Text that is not redacted renders exactly as normal, so this can be used
/// unconditionally at any call site that *might* receive a redacted value.
class RedactableText extends StatelessWidget {
  const RedactableText(
    this.text, {
    super.key,
    this.style,
    this.maxLines,
    this.overflow,
  });

  final String text;
  final TextStyle? style;
  final int? maxLines;
  final TextOverflow? overflow;

  /// True when this exact value came back withheld. An exact match, not a
  /// `contains`: a real email body that happens to include an ellipsis of
  /// dots is not redacted, and dimming it would misrepresent it.
  bool get isRedacted => text.trim() == kRedactionMarker;

  @override
  Widget build(BuildContext context) {
    if (!isRedacted) {
      return Text(text, style: style, maxLines: maxLines, overflow: overflow);
    }

    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Tooltip(
      message: l10n.emailsRedactedFieldTooltip,
      child: Text(
        kRedactionMarker,
        style: (style ?? theme.textTheme.bodyMedium)?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
          fontStyle: FontStyle.italic,
          letterSpacing: 2,
        ),
      ),
    );
  }
}
