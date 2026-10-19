import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/time/calendar_date_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/timecode.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/data/models/email_tag.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/email_verdict_controls.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:url_launcher/url_launcher.dart';

/// One row in the library list.
///
/// Shows the subject, the tags, the provenance line, and the first lines of
/// the critique — not of the body. The body is what was written; the critique
/// is what was learned, and the list is for finding a lesson again.
class EmailRecordCard extends StatelessWidget {
  const EmailRecordCard({
    super.key,
    required this.record,
    required this.tagLabels,
    required this.onTap,
    required this.onDelete,
    this.onVerdict,
  });

  final EmailRecord record;

  /// Tag id to label, for every vocabulary — resolved once by the screen
  /// rather than by each card, since a list of 200 would otherwise do the same
  /// lookup 200 times.
  final Map<String, EmailTag> tagLabels;

  final VoidCallback onTap;
  final VoidCallback onDelete;

  /// Rates a draft from the list. The card shows Good / Bad only on drafts
  /// ([EmailRecordSource.isDraft]) and only when this is given.
  final ValueChanged<EmailVerdict?>? onVerdict;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final locale = Localizations.localeOf(context).toString();

    final tags = [
      for (final id in [...record.stageTagIds, ...record.nicheTagIds])
        if (tagLabels[id] != null) tagLabels[id]!,
    ];
    final badge = emailSourceBadge(l10n, record.source);

    // String _body = record.body;
    String getEmailBody() {
      var body = record.body.trim();

      // 1. Remove the first line if it contains the receiver tag
      final firstNewline = body.indexOf('\n');
      final firstLine =
          firstNewline == -1 ? body : body.substring(0, firstNewline);

      if (firstLine.contains('@receiver') || firstLine.contains('@reciver')) {
        body = (firstNewline == -1 ? '' : body.substring(firstNewline + 1))
            .trimLeft();
      }

      // 2. Remove @sender from the tail end
      const senderTag = '@sender';
      if (body.endsWith(senderTag)) {
        body = body.substring(0, body.length - senderTag.length).trimRight();
      }

      // 3. Remove the outro line (e.g., "Best", "Regards", etc.)
      final lastNewline = body.lastIndexOf('\n');
      if (lastNewline != -1) {
        body = body.substring(0, lastNewline).trimRight();
      }

      return body;
    }

    return Card(
      clipBehavior: Clip.antiAlias,
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      record.subject.trim().isEmpty
                          ? l10n.emailLibraryNoSubject
                          : record.subject.trim(),
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                        fontStyle: record.subject.trim().isEmpty
                            ? FontStyle.italic
                            : null,
                        color: record.subject.trim().isEmpty
                            ? scheme.outline
                            : null,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  _OpenSourceButton(record: record),
                  IconButton(
                    onPressed: onDelete,
                    tooltip: l10n.commonDelete,
                    visualDensity: VisualDensity.compact,
                    iconSize: 18,
                    icon: const Icon(Icons.delete_outline),
                  ),
                ],
              ),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [Text(getEmailBody())],
              ),
              if (tags.isNotEmpty || badge != null) ...[
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    if (badge != null)
                      _MiniTag(
                        key: ValueKey('email-source-badge-${record.id}'),
                        label: badge,
                        emphasised: true,
                        tertiary: true,
                      ),
                    for (final tag in tags)
                      _MiniTag(
                        label: tag.label,
                        emphasised: tag.kind == EmailTagKind.stage,
                      ),
                  ],
                ),
              ],
              if (record.knobs.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(
                  l10n.emailLibraryKnobs(record.knobs.values.join(' · ')),
                  style: theme.textTheme.labelSmall
                      ?.copyWith(color: scheme.outline),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
              const SizedBox(height: 8),
              _ProvenanceLine(record: record, locale: locale),
              if (record.source.isDraft && onVerdict != null) ...[
                const SizedBox(height: 8),
                EmailVerdictChips(
                  keyPrefix: 'email-verdict-${record.id}',
                  verdict: record.verdict,
                  onChanged: onVerdict,
                ),
                if (record.verdictNote.trim().isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    record.verdictNote.trim(),
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontStyle: FontStyle.italic,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
              if (record.critique.trim().isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  record.critique.trim(),
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: scheme.onSurfaceVariant),
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Opens the source video for this record — at the recorded timecode when
/// there is one — without first opening the editor.
///
/// Always present next to the delete button so the row's controls do not
/// shift about from card to card; greyed out, like the editor's equivalent,
/// when the record has no openable URL.
class _OpenSourceButton extends StatelessWidget {
  const _OpenSourceButton({required this.record});

  final EmailRecord record;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final target = timecodedVideoUrl(record.videoUrl, record.timecodeSeconds);
    final enabled =
        target != null && (Uri.tryParse(target)?.hasScheme ?? false);

    return IconButton(
      onPressed: enabled ? () => _open(context, target) : null,
      tooltip: l10n.emailLibraryOpenVideo,
      visualDensity: VisualDensity.compact,
      iconSize: 18,
      icon: const Icon(Icons.open_in_new),
    );
  }

  Future<void> _open(BuildContext context, String target) async {
    final l10n = AppLocalizations.of(context);
    // Guarded like every other launch in this app: a refusal must say so
    // rather than doing nothing.
    final launched = await launchUrl(
      Uri.parse(target),
      mode: LaunchMode.externalApplication,
    );
    if (!launched) {
      if (!context.mounted) return;
      AppToast.error(context, l10n.emailLibraryOpenFailed);
    }
  }
}

/// A tag as it appears on a card: read-only, and small enough that six of them
/// still leave room for the critique.
///
/// Stage tags are filled and niche tags outlined, so the sequence position —
/// the thing you scan a list for — is visible without reading the labels.
class _MiniTag extends StatelessWidget {
  const _MiniTag({
    super.key,
    required this.label,
    required this.emphasised,
    this.tertiary = false,
  });

  final String label;
  final bool emphasised;

  /// The record's kind ("Test draft") rather than a tag: its own color, so it
  /// never reads as a stage.
  final bool tertiary;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: tertiary
            ? scheme.tertiaryContainer
            : emphasised
                ? scheme.secondaryContainer
                : null,
        border: emphasised ? null : Border.all(color: scheme.outlineVariant),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: theme.textTheme.labelSmall?.copyWith(
          color: tertiary
              ? scheme.onTertiaryContainer
              : emphasised
                  ? scheme.onSecondaryContainer
                  : scheme.outline,
        ),
      ),
    );
  }
}

/// "12 Mar 2025 · 41:02 · youtube.com" — where this email was found, in one
/// line, with the parts that are missing simply absent rather than shown as
/// placeholders.
class _ProvenanceLine extends StatelessWidget {
  const _ProvenanceLine({required this.record, required this.locale});

  final EmailRecord record;
  final String locale;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final parts = <String>[
      if (record.videoDate != null)
        formatCalendarDate(record.videoDate!, locale),
      if (formatTimecode(record.timecodeSeconds) != null)
        formatTimecode(record.timecodeSeconds)!,
      if (record.videoUrl.trim().isNotEmpty)
        Uri.tryParse(record.videoUrl.trim())?.host.replaceFirst('www.', '') ??
            record.videoUrl.trim(),
    ];
    if (parts.isEmpty) return const SizedBox.shrink();

    return Text(
      parts.join('  ·  '),
      style: theme.textTheme.labelSmall
          ?.copyWith(color: theme.colorScheme.outline),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
    );
  }
}
