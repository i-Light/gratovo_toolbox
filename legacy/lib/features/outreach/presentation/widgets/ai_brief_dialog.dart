import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/features/outreach/application/ai_brief_builder.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Shows the AI brief for one channel: the same facts that just went to the
/// clipboard, laid out to be read.
///
/// Copying used to be the whole interaction — press the button, get a snackbar,
/// and the only way to find out what had been handed over was to paste it and
/// read JSON. That is fine for the model and useless for the person, who is the
/// one who has to decide whether the draft that comes back is any good and what
/// to change in it. Seeing the material first is what makes that judgement
/// possible: a thin brief explains a thin draft, and a wrong hook is obvious
/// here in a way it never is in the finished email.
Future<void> showOutreachBriefDialog(
  BuildContext context, {
  required String brief,
  required List<BriefSection> sections,
}) {
  return showDialog<void>(
    context: context,
    builder: (_) => OutreachBriefDialog(brief: brief, sections: sections),
  );
}

class OutreachBriefDialog extends ConsumerWidget {
  const OutreachBriefDialog({
    super.key,
    required this.brief,
    required this.sections,
  });

  /// The full clipboard payload — instructions plus JSON.
  final String brief;

  /// The same payload regrouped for reading. See [outreachBriefSections].
  final List<BriefSection> sections;

  /// Below this the brief has nothing in it but the channel's name and handle,
  /// which is worth saying out loud rather than leaving somebody to wonder why
  /// the draft came back generic.
  static const _thinBriefSections = 2;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Dialog(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 680, maxHeight: 760),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 20, 12, 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          l10n.outreachBriefDialogTitle,
                          style: theme.textTheme.titleLarge,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          l10n.outreachBriefDialogSubtitle,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: l10n.outreachBriefCopyAgain,
                    icon: const Icon(Icons.copy_all_outlined),
                    onPressed: () => _copyAgain(context, l10n),
                  ),
                  IconButton(
                    tooltip: l10n.commonClose,
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Flexible(
              // Selectable throughout: the point of showing the material is
              // that somebody can lift a line out of it into the draft they
              // are editing.
              child: SelectionArea(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
                  children: [
                    if (sections.length <= _thinBriefSections)
                      _ThinBriefNotice(message: l10n.outreachBriefThin),
                    for (final section in sections)
                      _SectionCard(section: section),
                    const SizedBox(height: 8),
                    // The instructions last and folded away: they are the same
                    // every time, so they are reference rather than reading,
                    // but they are also the half that decides what comes back —
                    // worth being able to check without pasting the brief
                    // somewhere first.
                    _PromptTile(
                      title: l10n.outreachBriefPromptSection,
                      body: outreachBriefInstructions.trim(),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _copyAgain(BuildContext context, AppLocalizations l10n) async {
    await Clipboard.setData(ClipboardData(text: brief));
    if (!context.mounted) return;
    AppToast.success(context, l10n.outreachAiBriefCopied);
  }
}

class _ThinBriefNotice extends StatelessWidget {
  const _ThinBriefNotice({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.info_outline,
            size: 18,
            color: theme.colorScheme.onSurfaceVariant,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(message, style: theme.textTheme.bodySmall),
          ),
        ],
      ),
    );
  }
}

/// One group of facts, headed by what the group is.
class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.section});

  final BriefSection section;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _sectionTitle(section.id, l10n),
            style: theme.textTheme.labelLarge?.copyWith(
              color: theme.colorScheme.primary,
            ),
          ),
          const SizedBox(height: 2),
          const Divider(),
          for (final field in section.fields) _FieldRow(field: field),
        ],
      ),
    );
  }
}

class _FieldRow extends ConsumerWidget {
  const _FieldRow({required this.field});

  final BriefField field;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final label = _fieldLabel(field.key, l10n);

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 2),
          _FieldValue(field: field),
        ],
      ),
    );
  }
}

class _FieldValue extends ConsumerWidget {
  const _FieldValue({required this.field});

  final BriefField field;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final value = field.value;

    if (value is Iterable) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final item in value)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Text('•  $item', style: theme.textTheme.bodyMedium),
            ),
        ],
      );
    }

    final fmt = ref.watch(instantFormatterProvider);
    if (value is num) {
      return Text(
        formatCount(value, locale: fmt.locale),
        style: theme.textTheme.bodyMedium,
      );
    }

    // Dates arrive as the ISO string the payload carries. Shown in the
    // display zone like every other timestamp in the app, so "published" here
    // matches "published" on the channel's own page.
    if (field.key.endsWith('_at') && value is String) {
      final parsed = DateTime.tryParse(value);
      if (parsed != null) {
        return Text(fmt.dateTime(parsed), style: theme.textTheme.bodyMedium);
      }
    }

    return Text('$value', style: theme.textTheme.bodyMedium);
  }
}

/// The instruction block, collapsed.
class _PromptTile extends StatelessWidget {
  const _PromptTile({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: ExpansionTile(
        title: Text(title, style: theme.textTheme.labelLarge),
        shape: const Border(),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        children: [
          Text(
            body,
            style: theme.textTheme.bodySmall?.copyWith(
              fontFamily: 'monospace',
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

String _sectionTitle(String id, AppLocalizations l10n) => switch (id) {
      briefSectionChannel => l10n.outreachBriefSectionChannel,
      briefSectionAudience => l10n.outreachBriefSectionAudience,
      briefSectionLatestUpload => l10n.outreachBriefSectionLatestUpload,
      briefSectionRecentUploads => l10n.outreachBriefSectionRecentUploads,
      briefSectionFit => l10n.outreachBriefSectionFit,
      briefSectionDraft => l10n.outreachBriefSectionDraft,
      _ => l10n.outreachBriefSectionOther,
    };

/// The label for one payload key.
///
/// A key with no label falls back to the raw key rather than to nothing — the
/// brief is allowed to grow a field before this list learns about it, and a
/// row reading `some_new_field` is still readable, where a blank one is a
/// silent hole in what the model was told.
String _fieldLabel(String key, AppLocalizations l10n) => switch (key) {
      'channel_name' => l10n.outreachBriefFieldChannelName,
      'channel_handle' => l10n.outreachBriefFieldChannelHandle,
      'contact_name' => l10n.outreachBriefFieldContactName,
      'country' => l10n.outreachBriefFieldCountry,
      'channel_url' => l10n.outreachBriefFieldChannelUrl,
      'channel_description' => l10n.outreachBriefFieldChannelDescription,
      'subscriber_count' => l10n.outreachBriefFieldSubscriberCount,
      'median_views' => l10n.outreachBriefFieldMedianViews,
      'last_video_title' => l10n.outreachBriefFieldLastVideoTitle,
      'last_video_published_at' => l10n.outreachBriefFieldLastVideoPublishedAt,
      'last_video_views' => l10n.outreachBriefFieldLastVideoViews,
      'last_video_url' => l10n.outreachBriefFieldLastVideoUrl,
      'last_video_description' => l10n.outreachBriefFieldLastVideoDescription,
      'recent_video_titles' => l10n.outreachBriefFieldRecentVideoTitles,
      'relevance_criteria' => l10n.outreachBriefFieldRelevanceCriteria,
      'notes' => l10n.outreachBriefFieldNotes,
      'sender_name' => l10n.outreachBriefFieldSenderName,
      'writing_rules' => l10n.outreachBriefFieldWritingRules,
      'template_name' => l10n.outreachBriefFieldTemplateName,
      'template_subject' => l10n.outreachBriefFieldTemplateSubject,
      'template_body' => l10n.outreachBriefFieldTemplateBody,
      _ => key,
    };
