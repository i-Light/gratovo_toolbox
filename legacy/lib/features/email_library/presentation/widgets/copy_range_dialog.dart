import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/time/calendar_date_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/timecode.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/data/models/email_tag.dart';
import 'package:gratovo_toolbox/features/email_library/application/email_library_controller.dart';
import 'package:gratovo_toolbox/features/email_library/application/handbook_export.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/email_form_fields.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/video_date_field.dart';

/// Picks a span of video dates and copies everything in it as a handbook
/// brief - see `handbook_export.dart` for what actually lands on the clipboard.
///
/// **English only, deliberately.** Every other string on this page goes through
/// `AppLocalizations`; these do not. The payload this dialog produces is an
/// English prompt to an English-language model, so a translated button sitting
/// above it would promise a localisation that stops at the clipboard.
///
/// The preview is the part worth explaining. It shows the date, the timecode,
/// how long the critique is, when the record was last copied, and the tags -
/// and deliberately **not** the subject, body or context. Those are what gets
/// copied; they are not what you check before copying. The decision being made
/// here is "is this the right batch, and have I already used it?", and a
/// preview full of email bodies buries the two fields that answer it.
class CopyRangeDialog extends ConsumerStatefulWidget {
  const CopyRangeDialog({super.key, required this.audience});

  final EmailAudience audience;

  @override
  ConsumerState<CopyRangeDialog> createState() => _CopyRangeDialogState();
}

class _CopyRangeDialogState extends ConsumerState<CopyRangeDialog> {
  /// The range, once it has been narrowed by hand - null until then.
  ///
  /// Null rather than a guessed window is what opens this dialog wide. A video
  /// date is when the *training video* was published, which for this corpus
  /// runs back years, so "the last 30 days" would open on an empty list for
  /// most libraries and read as broken. Left null, both ends fall back to the
  /// tab's own oldest and newest video date: the widest range with anything in
  /// it, and the same span the wheels stop at - so the range the dialog opens
  /// on and the range it can reach are one thing.
  DateTime? _from;
  DateTime? _to;

  bool _copying = false;

  /// Where the ends sit while the tab's span is still being read, and in a tab
  /// with no dated record at all. Wide, because there is nothing to fit them
  /// to.
  static DateTime get _unboundedFrom => DateTime(2015);

  static DateTime _today() {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }

  /// [date] kept inside [bounds].
  ///
  /// Only ever applied to the end being *dragged along* by the other one. The
  /// end actually being edited is bounded by the field itself, which does it
  /// on settle so a half-typed year survives; dragging its partner past the
  /// corpus in the meantime would leave that field showing a date the tab has
  /// no record anywhere near.
  static DateTime _within(DateTime date, EmailVideoDateBounds? bounds) {
    if (bounds == null) return date;
    if (date.isBefore(bounds.earliest)) return bounds.earliest;
    if (date.isAfter(bounds.latest)) return bounds.latest;
    return date;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bounds =
        ref.watch(emailVideoDateBoundsProvider(widget.audience)).value;
    final from = _from ?? bounds?.earliest ?? _unboundedFrom;
    final to = _to ?? bounds?.latest ?? _today();
    final range = EmailVideoDateRange(
      audience: widget.audience,
      from: from,
      to: to,
    );
    final records = ref.watch(emailRecordsInRangeProvider(range));

    return AlertDialog(
      title: const Text('Copy records for a handbook'),
      content: SizedBox(
        width: 920,
        height: 720,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Copies every ${_audienceWord(widget.audience)} record whose '
              'video date falls in this range, with a prompt at the top asking '
              'Claude to build a handbook out of them. Records with no video '
              'date are not in any range.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 16),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _RangeEnd(
                  key: const ValueKey('copyRange.from'),
                  label: 'From',
                  value: from,
                  bounds: bounds,
                  onChanged: (picked) => setState(() {
                    _from = picked;
                    // Dragging the start past the end would otherwise leave an
                    // empty range that looks like "no records here".
                    if (picked.isAfter(to)) _to = _within(picked, bounds);
                  }),
                ),
                const SizedBox(width: 16),
                _RangeEnd(
                  key: const ValueKey('copyRange.to'),
                  label: 'To',
                  value: to,
                  bounds: bounds,
                  onChanged: (picked) => setState(() {
                    _to = picked;
                    if (picked.isBefore(from)) _from = _within(picked, bounds);
                  }),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Expanded(
              child: records.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, _) => Center(
                  child: Text(
                    'Could not read the library.\n$error',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.error),
                  ),
                ),
                data: (items) => _Preview(items: items),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _copying ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton.icon(
          onPressed: (records.value?.isEmpty ?? true) || _copying
              ? null
              : () => _copy(records.value!, from: from, to: to),
          icon: _copying
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.copy_all_outlined, size: 18),
          label: Text(_copyLabel(records.value)),
        ),
      ],
    );
  }

  static String _copyLabel(List<EmailRecord>? items) {
    if (items == null || items.isEmpty) return 'Copy';
    return items.length == 1 ? 'Copy 1 record' : 'Copy ${items.length} records';
  }

  static String _audienceWord(EmailAudience audience) => switch (audience) {
        EmailAudience.influencer => 'influencer',
        EmailAudience.brand => 'brand',
      };

  Future<void> _copy(
    List<EmailRecord> items, {
    required DateTime from,
    required DateTime to,
  }) async {
    setState(() => _copying = true);
    final navigator = Navigator.of(context);

    try {
      final text = buildHandbookExport(
        records: items,
        tagLabels: _tagLabels(),
        audience: widget.audience,
        from: from,
        to: to,
        generatedAt: DateTime.now(),
      );
      await Clipboard.setData(ClipboardData(text: text));
      // Only after the clipboard write, never before it: a copy that threw did
      // not happen, and stamping it would make the library claim these records
      // have already been used.
      await ref.read(emailLibraryActionsProvider).markCopied(items);

      if (!mounted) return;
      AppToast.success(
        context,
        '${items.length} record${items.length == 1 ? '' : 's'} copied. '
        'Paste into Claude.',
      );
      navigator.pop();
    } catch (error) {
      if (!mounted) return;
      setState(() => _copying = false);
      AppToast.error(context, 'Could not copy: $error');
    }
  }

  /// Both vocabularies as one id -> tag map, resolved once for the whole batch.
  Map<String, EmailTag> _tagLabels() => {
        for (final kind in EmailTagKind.values)
          for (final tag in ref.read(emailTagsProvider(kind)).value ?? const [])
            tag.id: tag,
      };
}

/// One end of the range: the record editor's video-date field, wheels and all.
///
/// The same control as the editor on purpose. The date being set here is a
/// date that was typed there, and the spin boxes are what that typing left
/// behind - a range picked with a different widget than the records were
/// entered with is one more thing to learn for nothing. It keeps the pointing
/// task the same too: three flicks of the wheel, and no second dialog opening
/// on top of this one.
///
/// What it adds is the stop at either end. Handed the tab's [bounds], the
/// wheels will not turn past the oldest or newest video date in it, so
/// scrolling to the end of the range is scrolling to the end of the corpus
/// rather than into years the library has nothing in.
class _RangeEnd extends StatelessWidget {
  const _RangeEnd({
    super.key,
    required this.label,
    required this.value,
    required this.bounds,
    required this.onChanged,
  });

  final String label;
  final DateTime value;

  /// Null while the tab's span is still being read, and in a tab with no dated
  /// record - the wheels then run their full segment ranges, exactly as they
  /// do in the editor.
  final EmailVideoDateBounds? bounds;

  final ValueChanged<DateTime> onChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      // The editor's own width for this field - wider than the digits need,
      // because the month box carries a spelled-out name ("9-September").
      width: 232,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          FieldLabel(label),
          const SizedBox(height: 6),
          VideoDateField(
            value: value,
            firstDate: bounds?.earliest,
            lastDate: bounds?.latest,
            onChanged: (picked) {
              // Null while a segment sits blank mid-edit. A half-typed date is
              // not a new range, so the current one stands until it is whole
              // again.
              if (picked != null) onChanged(picked);
            },
          ),
        ],
      ),
    );
  }
}

/// The batch, as a scrollable list with a one-line summary above it.
class _Preview extends ConsumerWidget {
  const _Preview({required this.items});

  final List<EmailRecord> items;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);

    if (items.isEmpty) {
      return Center(
        child: Text(
          'No records with a video date in this range.',
          style: theme.textTheme.bodySmall
              ?.copyWith(color: theme.colorScheme.outline),
        ),
      );
    }

    final tagLabels = <String, EmailTag>{
      for (final kind in EmailTagKind.values)
        for (final tag in ref.watch(emailTagsProvider(kind)).value ?? const [])
          tag.id: tag,
    };

    // Worth its own line above the list: taking a batch you already took last
    // week is the mistake this dialog exists to catch, and counting the reused
    // ones by eye down a list of forty is not something anybody does.
    final reused = items.where((r) => r.lastCopiedAt != null).length;
    final noCritique =
        items.where((r) => critiqueWordCount(r.critique) == 0).length;

    final summary = <String>[
      '${items.length} record${items.length == 1 ? '' : 's'}',
      if (reused > 0) '$reused copied before',
      if (noCritique > 0) '$noCritique with no critique',
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          summary.join('  ·  '),
          style: theme.textTheme.labelMedium?.copyWith(
            color: reused > 0 || noCritique > 0
                ? theme.colorScheme.tertiary
                : theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 8),
        Expanded(
          child: Material(
            type: MaterialType.transparency,
            // Deliberately no `Scrollbar` around this list. On desktop the
            // scroll behaviour already wraps every vertical scrollable in one,
            // wired to the list's own controller; a second, hand-written one
            // here has no controller to fall back on but the modal route's
            // PrimaryScrollController, which a `primary: false` list never
            // attaches to - and the first scroll then trips
            // "The Scrollbar's ScrollController has no ScrollPosition
            // attached" and takes the dialog down with it.
            child: ListView.separated(
              // The route's primary controller belongs to the page behind the
              // dialog, not to this list.
              primary: false,
              itemCount: items.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, index) => _PreviewRow(
                record: items[index],
                tagLabels: tagLabels,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// One record in the preview: date, timecode, critique length, copy recency,
/// tags.
///
/// No subject, no body, no context - see [CopyRangeDialog] for why.
class _PreviewRow extends StatelessWidget {
  const _PreviewRow({required this.record, required this.tagLabels});

  final EmailRecord record;
  final Map<String, EmailTag> tagLabels;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final locale = Localizations.localeOf(context).toString();

    final words = critiqueWordCount(record.critique);
    final recency = copyRecencyLabel(record.lastCopiedAt);
    final tags = resolveRecordTags(record, tagLabels);

    // The date is the only field guaranteed present - nothing without a video
    // date reaches this list - so it leads, and the timecode joins it when the
    // record has one.
    final provenance = <String>[
      if (record.videoDate != null)
        formatCalendarDate(record.videoDate!, locale),
      if (formatTimecode(record.timecodeSeconds) != null)
        formatTimecode(record.timecodeSeconds)!,
    ].join('  ·  ');

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  provenance,
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(fontWeight: FontWeight.w600),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                recency,
                style: theme.textTheme.labelSmall?.copyWith(
                  // Already-copied is the one state worth a color: it is the
                  // reason somebody would change the range before pressing
                  // copy.
                  color: record.lastCopiedAt == null
                      ? scheme.outline
                      : scheme.tertiary,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            words == 0
                ? 'No critique'
                : '$words word${words == 1 ? '' : 's'} of critique',
            style: theme.textTheme.labelSmall?.copyWith(
              // An empty critique is a record that teaches nothing, so it is
              // flagged rather than quietly reading as "0".
              color: words == 0 ? scheme.error : scheme.onSurfaceVariant,
            ),
          ),
          if (tags.isNotEmpty) ...[
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final tag in tags)
                  _MiniTag(
                    label: tag.label,
                    emphasised: tag.kind == EmailTagKind.stage,
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// Same shape as the card's tag chip, so a record looks the same in the
/// preview as it does in the list behind it.
class _MiniTag extends StatelessWidget {
  const _MiniTag({required this.label, required this.emphasised});

  final String label;
  final bool emphasised;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: emphasised ? scheme.secondaryContainer : null,
        border: emphasised ? null : Border.all(color: scheme.outlineVariant),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: theme.textTheme.labelSmall?.copyWith(
          color: emphasised ? scheme.onSecondaryContainer : scheme.outline,
        ),
      ),
    );
  }
}

/// Opens the dialog for [audience].
Future<void> showCopyRangeDialog(
  BuildContext context, {
  required EmailAudience audience,
}) {
  return showDialog<void>(
    context: context,
    builder: (context) => CopyRangeDialog(audience: audience),
  );
}
