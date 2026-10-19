import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/timecode.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/data/models/email_tag.dart';
import 'package:gratovo_toolbox/features/email_library/application/email_library_controller.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/add_tag_dialog.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/email_form_fields.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/email_verdict_controls.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/mention_text_field.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/tag_selection_grid.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/tag_selection_row.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/video_date_field.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/video_source_row.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Opens the editor for [record] — a new blank one, or an existing row.
///
/// Returns true if anything was saved, so the caller knows whether to show the
/// "saved" confirmation. A dialog rather than a route on purpose: capturing an
/// email is an interruption of reading the list, and the list staying visible
/// behind it is what makes "add another" feel like staying in one place.
Future<bool> showEmailRecordEditor(
  BuildContext context, {
  required EmailRecord record,
  bool isNew = false,
}) async {
  final saved = await showDialog<bool>(
    context: context,
    // The form is long and it is easy to click outside it while scrolling.
    barrierDismissible: false,
    builder: (context) => EmailRecordEditor(record: record, isNew: isNew),
  );
  return saved ?? false;
}

/// The whole capture form for one email record.
///
/// Field order follows the order the information arrives while watching a
/// training video: which video and where in it, then how the email is filed,
/// then the email itself, then what the expert said about it. Typing top to
/// bottom should never require scrolling back up.
class EmailRecordEditor extends ConsumerStatefulWidget {
  const EmailRecordEditor({
    super.key,
    required this.record,
    this.isNew = false,
  });

  final EmailRecord record;
  final bool isNew;

  @override
  ConsumerState<EmailRecordEditor> createState() => _EmailRecordEditorState();
}

class _EmailRecordEditorState extends ConsumerState<EmailRecordEditor> {
  late final TextEditingController _url;
  late final TextEditingController _timecode;
  late final TextEditingController _context;
  late final TextEditingController _subject;
  late final TextEditingController _body;
  late final TextEditingController _critique;
  late final TextEditingController _verdictNote;

  /// A draft's rating, and whether any other record is one of the owner's
  /// own examples — both saved with the rest on Save.
  late EmailVerdict? _verdict;
  late EmailRecordSource _source;

  late DateTime? _videoDate;
  late Set<String> _stageTagIds;
  late Set<String> _nicheTagIds;

  /// The record this editor is currently on. Changes when "save and add
  /// another" swaps a fresh blank record in without closing the dialog.
  late EmailRecord _base;

  /// Whether anything at all has been saved from this dialog — the value
  /// handed back on close, so the caller can refresh and confirm.
  bool _savedAnything = false;

  bool _saving = false;

  /// Where the caret last sat in the context field.
  ///
  /// Kept by hand because the gesture that writes into that field happens
  /// while the *body* has focus: the note is being written in one place and
  /// added to from another, and an excerpt that always landed at the end would
  /// undo the ordering the writer had just chosen. -1 until the field has been
  /// touched at all, which reads as "the end".
  int _contextCaret = -1;

  /// Holds keyboard focus for the dialog as a whole. Left/Right are bound as a
  /// [Shortcuts] mapping above this node, so it has to keep the primary focus
  /// whenever no field or button has it — see [_reclaimFocus].
  final _dialogFocus = FocusNode(debugLabel: 'EmailRecordEditor');

  /// This editor's own route, used to tell "focus is loose in our dialog" from
  /// "a nested dialog on top of us has it" — [_reclaimFocus] must leave the
  /// latter alone.
  ModalRoute<dynamic>? _route;

  @override
  void initState() {
    super.initState();
    _base = widget.record;
    _url = TextEditingController(text: widget.record.videoUrl);
    _timecode = TextEditingController(
      text: formatTimecode(widget.record.timecodeSeconds) ?? '',
    );
    _context = TextEditingController(text: widget.record.context);
    _subject = TextEditingController(text: widget.record.subject);
    _body = TextEditingController(text: widget.record.body);
    _critique = TextEditingController(text: widget.record.critique);
    _verdictNote = TextEditingController(text: widget.record.verdictNote);
    _verdict = widget.record.verdict;
    _source = widget.record.source;
    // A brand-new record with nothing carried over from the last one starts on
    // 1 January of the default year, so the spin field opens showing a whole
    // date to nudge rather than three blank boxes. An existing row keeps
    // whatever it has, "no date" included.
    _videoDate = widget.record.videoDate ??
        (widget.isNew ? DateTime(kVideoDateDefaultYear, 1, 1) : null);
    _stageTagIds = {...widget.record.stageTagIds};
    _nicheTagIds = {...widget.record.nicheTagIds};

    // The URL field feeds the "open at this timecode" button, which lives in
    // another widget and has no other way to learn that the text changed.
    _url.addListener(_onSourceChanged);
    _timecode.addListener(_onSourceChanged);
    _context.addListener(_rememberContextCaret);

    // Take focus back whenever a tap-away drops it onto the bare route scope,
    // so the Left/Right shortcut never degrades into plain focus traversal.
    FocusManager.instance.addListener(_reclaimFocus);
  }

  @override
  void dispose() {
    FocusManager.instance.removeListener(_reclaimFocus);
    _dialogFocus.dispose();
    _url.removeListener(_onSourceChanged);
    _timecode.removeListener(_onSourceChanged);
    _context.removeListener(_rememberContextCaret);
    for (final controller in [
      _url,
      _timecode,
      _context,
      _subject,
      _body,
      _critique,
      _verdictNote,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _route = ModalRoute.of(context);
  }

  void _onSourceChanged() => setState(() {});

  void _rememberContextCaret() {
    final selection = _context.selection;
    // An invalid selection is what a cleared field reports, and it is not a
    // place — leaving the last real one alone is what survives "add another".
    if (selection.isValid) _contextCaret = selection.end;
  }

  /// Drops an excerpt of the email body into the context note as a quote.
  ///
  /// Written straight into the controller rather than through focus: the point
  /// of the gesture is to annotate without leaving the body, so the caret stays
  /// where it was and reading carries on. It does move on past what was just
  /// added, so a run of excerpts lands in the order they were taken.
  void _quoteIntoContext(String excerpt) {
    final token = asQuoteToken(excerpt);
    if (token == null) return;

    final text = _context.text;
    final at = _contextCaret < 0 || _contextCaret > text.length
        ? text.length
        : _contextCaret;
    // A quote butted against a word would read as part of it. Against a space,
    // a newline or an edge, the gap is already there.
    final isSpace = RegExp(r'\s');
    final before = at > 0 && !isSpace.hasMatch(text[at - 1]) ? ' ' : '';
    final after = at < text.length && !isSpace.hasMatch(text[at]) ? ' ' : '';
    final insertion = '$before$token$after';

    _context.value = TextEditingValue(
      text: text.replaceRange(at, at, insertion),
      selection: TextSelection.collapsed(offset: at + insertion.length),
    );
    // The context field is the last one in a long form and is usually scrolled
    // out of sight when the body is being read, so the only evidence the
    // gesture worked has to come from somewhere else.
    AppToast.success(
      context,
      AppLocalizations.of(context).emailLibraryQuotedToContext,
      duration: const Duration(seconds: 2),
    );
  }

  /// True when the timecode box holds something, and that something does not
  /// parse. Empty is valid — most records will not have one.
  bool get _timecodeIsValid {
    final text = _timecode.text.trim();
    return text.isEmpty || parseTimecode(text) != null;
  }

  /// The record as currently typed.
  EmailRecord get _current => _base.copyWith(
        videoDate: _videoDate,
        clearVideoDate: _videoDate == null,
        videoUrl: _url.text,
        timecodeSeconds: parseTimecode(_timecode.text),
        clearTimecode: parseTimecode(_timecode.text) == null,
        stageTagIds: _stageTagIds.toList(),
        nicheTagIds: _nicheTagIds.toList(),
        context: _context.text,
        subject: _subject.text,
        body: _body.text,
        critique: _critique.text,
        updatedAt: DateTime.now().toUtc(),
        source: _source,
        verdict: _verdict,
        clearVerdict: _verdict == null,
        verdictNote: _verdict == null ? '' : _verdictNote.text.trim(),
        // Stamped when the rating changes; an edit to the wording keeps the
        // time it was given.
        verdictAt:
            _verdict != _base.verdict || _verdictNote.text != _base.verdictNote
                ? DateTime.now().toUtc()
                : _base.verdictAt,
      );

  /// The `@` vocabulary the body and subject offer, as plain words.
  ///
  /// Falls back to the built-in list when the library is unavailable (the
  /// non-desktop case), so the mention menu still works on a machine with no
  /// database to read a vocabulary from.
  List<String> _mentionKeywords() {
    final tags = ref.watch(emailTagsProvider(EmailTagKind.placeholder)).value;
    if (tags == null || tags.isEmpty) return kEmailMentionKeywords;
    return [
      for (final tag in tags)
        if (asMentionToken(tag.label) case final token?) token,
    ];
  }

  /// Adds one keyword to that vocabulary from the mention menu's "+".
  ///
  /// Sanitised before it is stored, not after it is read: a label with a space
  /// in it would be a keyword the menu could offer and the text could never
  /// match again.
  Future<String?> _addMentionKeyword(String query) async {
    final label = await showAddTagDialog(
      context,
      kind: EmailTagKind.placeholder,
      initialValue: query,
    );
    if (label == null || !mounted) return null;
    final token = asMentionToken(label);
    if (token == null) return null;

    final tag = await ref
        .read(emailLibraryActionsProvider)
        .addTag(EmailTagKind.placeholder, token);
    return asMentionToken(tag.label);
  }

  Future<void> _addTag(EmailTagKind kind, String initialValue) async {
    final label = await showAddTagDialog(
      context,
      kind: kind,
      initialValue: initialValue,
    );
    if (label == null || !mounted) return;

    final tag = await ref.read(emailLibraryActionsProvider).addTag(kind, label);
    if (!mounted) return;
    // Adding a tag from inside the editor means you want it on this record —
    // otherwise you would have used the manage-tags sheet.
    setState(() {
      if (kind == EmailTagKind.stage) {
        _stageTagIds.add(tag.id);
      } else {
        _nicheTagIds.add(tag.id);
      }
    });
  }

  /// Saves and closes, or saves and starts a fresh record in the same dialog.
  ///
  /// The blank one inherits the date and URL through [EmailDraftDefaults],
  /// which the save itself has just written — so the "carry the video forward"
  /// rule is stated once, in the repository, rather than duplicated here.
  Future<void> _save({required bool andAnother}) async {
    final l10n = AppLocalizations.of(context);
    final navigator = Navigator.of(context);
    final record = _current;

    if (record.isEmpty) {
      AppToast.warning(context, l10n.emailLibraryNothingToSave);
      return;
    }
    if (!_timecodeIsValid) return;

    setState(() => _saving = true);
    try {
      await ref.read(emailLibraryActionsProvider).saveRecord(record);
      _savedAnything = true;
    } catch (_) {
      // A failed write must not throw out of a fire-and-forget button
      // callback, where it becomes an unhandled error and takes the app down.
      // Say so and leave the dialog open with everything still typed in it.
      if (mounted) {
        AppToast.error(context, l10n.emailLibrarySaveFailed);
      }
      return;
    } finally {
      if (mounted) setState(() => _saving = false);
    }
    if (!mounted) return;

    if (!andAnother) {
      navigator.pop(true);
      return;
    }

    AppToast.success(context, l10n.emailLibrarySaved);
    _resetForNextRecord(record);
  }

  /// Clears the per-email fields and keeps the provenance ones.
  ///
  /// The tags stay too, which is the point of the button: a run of emails
  /// pulled from one video is nearly always the same stage and the same niche,
  /// and re-picking them each time is most of the typing. The timecode stays
  /// for the same reason and is the one that has to be *edited* rather than
  /// re-entered: the next email is a little further into the same video, so
  /// the last position is the right place to start spinning from.
  void _resetForNextRecord(EmailRecord saved) {
    setState(() {
      _base = EmailRecord.blank(
        audience: saved.audience,
        defaults: EmailDraftDefaults(
          videoDate: saved.videoDate,
          videoUrl: saved.videoUrl,
          timecodeSeconds: saved.timecodeSeconds,
          stageTagIds: saved.stageTagIds,
        ),
      );
      _timecode.text = formatTimecode(saved.timecodeSeconds) ?? '';
      _context.clear();
      _subject.clear();
      _body.clear();
      _critique.clear();
      _verdictNote.clear();
      _verdict = null;
      _source = _base.source;
    });
  }

  Future<void> _close() async {
    final navigator = Navigator.of(context);

    // Only ask when there is something to lose. A blank form — including the
    // fresh one left behind by "add another" — closes silently.
    if (!_current.isEmpty && !await _confirmDiscard()) return;
    navigator.pop(_savedAnything);
  }

  /// The discard-changes prompt, shared by closing the dialog and by stepping
  /// to another record with Left/Right. Returns true when the caller should go
  /// ahead — the user chose to throw the edits away.
  Future<bool> _confirmDiscard() async {
    final l10n = AppLocalizations.of(context);
    final discard = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.emailLibraryDiscardTitle),
        content: Text(l10n.emailLibraryDiscardBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.commonCancel),
          ),
          FilledButton.tonal(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.emailLibraryDiscard),
          ),
        ],
      ),
    );
    return discard ?? false;
  }

  /// Whether the fields hold anything not yet saved into [_base] — the test
  /// for "ask before leaving this record". Ignores [EmailRecord.updatedAt],
  /// which [_current] always stamps with now.
  bool get _isDirty {
    final base = _base;
    return _subject.text != base.subject ||
        _body.text != base.body ||
        _critique.text != base.critique ||
        _verdict != base.verdict ||
        _verdictNote.text != base.verdictNote ||
        _source != base.source ||
        _context.text != base.context ||
        _url.text != base.videoUrl ||
        parseTimecode(_timecode.text) != base.timecodeSeconds ||
        _videoDate != base.videoDate ||
        !_sameIds(_stageTagIds, base.stageTagIds) ||
        !_sameIds(_nicheTagIds, base.nicheTagIds);
  }

  bool _sameIds(Set<String> selected, List<String> saved) =>
      selected.length == saved.length && selected.containsAll(saved);

  /// Runs on every focus change. When a tap outside the fields has dropped the
  /// primary focus onto a bare [FocusScopeNode] (or nothing at all), pull it
  /// back to [_dialogFocus] so the Left/Right [Shortcuts] stays in the focus
  /// path instead of the app's default arrow-key focus traversal taking over.
  void _reclaimFocus() {
    if (!mounted || _route?.isCurrent != true) return;
    final primary = FocusManager.instance.primaryFocus;
    if (primary == null || primary is FocusScopeNode) {
      _dialogFocus.requestFocus();
    }
  }

  /// Whether the primary focus sits on (or inside) an [EditableText] — the
  /// check behind "only step between records when not inside any field".
  bool get _focusInTextField {
    final focused = FocusManager.instance.primaryFocus?.context;
    return focused != null &&
        (focused.widget is EditableText ||
            focused.findAncestorWidgetOfExactType<EditableText>() != null);
  }

  /// Handles the Left/Right shortcut: step to the adjacent record, unless a
  /// field has focus (its own caret movement wins) or a save is in flight.
  /// [delta] is +1 for Right; RTL flips it so the next record reads leftwards.
  void _onArrowKey(int delta) {
    if (_focusInTextField || _saving) return;
    final rtl = Directionality.of(context) == TextDirection.rtl;
    _navigate(rtl ? -delta : delta);
  }

  /// Steps to the record [delta] places away in the list behind the dialog —
  /// the open tab, filter and sort — without closing the editor. Does nothing
  /// at the ends of the list, or when the open record is not in it: a
  /// brand-new one, or one the filter now excludes.
  Future<void> _navigate(int delta) async {
    if (_saving || _navigating) return;
    final records = ref.read(emailRecordsProvider).value;
    if (records == null) return;
    final index = records.indexWhere((r) => r.id == _base.id);
    if (index < 0) return;
    final target = index + delta;
    if (target < 0 || target >= records.length) return;

    _navigating = true;
    try {
      if (_isDirty && !await _confirmDiscard()) return;
      if (!mounted) return;
      _loadRecord(records[target]);
    } finally {
      _navigating = false;
    }
  }

  /// Guards against a second Left/Right landing while the discard prompt for
  /// the first is still up — the key handler is global and the modal barrier
  /// does not stop it.
  bool _navigating = false;

  /// Rewires every field onto [record]. Mirrors [initState]; the context-caret
  /// memory resets because the note it indexed into belongs to the record
  /// being left.
  void _loadRecord(EmailRecord record) {
    setState(() {
      _base = record;
      _url.text = record.videoUrl;
      _timecode.text = formatTimecode(record.timecodeSeconds) ?? '';
      _context.text = record.context;
      _subject.text = record.subject;
      _body.text = record.body;
      _critique.text = record.critique;
      _verdictNote.text = record.verdictNote;
      _verdict = record.verdict;
      _source = record.source;
      _videoDate = record.videoDate;
      _stageTagIds = {...record.stageTagIds};
      _nicheTagIds = {...record.nicheTagIds};
      _contextCaret = -1;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final stageTags =
        ref.watch(emailTagsProvider(EmailTagKind.stage)).value ?? const [];
    final nicheTags =
        ref.watch(emailTagsProvider(EmailTagKind.niche)).value ?? const [];
    final keywords = _mentionKeywords();

    // Left/Right step between records. Bound as a Shortcuts mapping — closer to
    // the focus than the app's root shortcuts — so it *shadows* the default
    // arrow-key focus traversal rather than racing it; [_dialogFocus] +
    // [_reclaimFocus] keep this subtree in the focus path.
    return Shortcuts(
      shortcuts: const <ShortcutActivator, Intent>{
        SingleActivator(LogicalKeyboardKey.arrowLeft):
            _AdjacentRecordIntent(-1),
        SingleActivator(LogicalKeyboardKey.arrowRight):
            _AdjacentRecordIntent(1),
      },
      child: Actions(
        actions: <Type, Action<Intent>>{
          _AdjacentRecordIntent: CallbackAction<_AdjacentRecordIntent>(
            onInvoke: (intent) {
              _onArrowKey(intent.delta);
              return null;
            },
          ),
        },
        child: Focus(
          focusNode: _dialogFocus,
          autofocus: true,
          skipTraversal: true,
          child: Dialog(
            insetPadding:
                const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
            child: ConstrainedBox(
              // Wide enough for an email body to read at a sane line length,
              // capped so it does not stretch across a 2K monitor.
              constraints: const BoxConstraints(maxWidth: 1220),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _EditorHeader(
                    title: widget.isNew
                        ? l10n.emailLibraryNewRecordTitle
                        : l10n.emailLibraryEditRecordTitle,
                    audience: _base.audience,
                    onClose: _saving ? null : _close,
                  ),
                  const Divider(height: 1),
                  Flexible(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          VideoSourceRow(
                            date: _videoDate,
                            onDateChanged: (value) =>
                                setState(() => _videoDate = value),
                            urlController: _url,
                            timecodeController: _timecode,
                            timecodeIsValid: _timecodeIsValid,
                          ),
                          const SizedBox(height: 20),
                          FieldLabel(l10n.emailLibraryFieldStage),
                          const SizedBox(height: 6),
                          TagSelectionRow(
                            tags: stageTags,
                            selectedIds: _stageTagIds,
                            addTooltip: l10n.emailLibraryAddStageTag,
                            onAdd: () => _addTag(EmailTagKind.stage, ''),
                            onToggle: (tag) => setState(() {
                              if (!_stageTagIds.remove(tag.id)) {
                                _stageTagIds.add(tag.id);
                              }
                            }),
                          ),
                          const SizedBox(height: 20),
                          FieldLabel(l10n.emailLibraryFieldNiche),
                          const SizedBox(height: 6),
                          TagSelectionGrid(
                            tags: nicheTags,
                            selectedIds: _nicheTagIds,
                            searchHint: l10n.emailLibraryNicheSearchHint,
                            addTooltip: l10n.emailLibraryAddNicheTag,
                            emptyLabel: l10n.emailLibraryNoNicheTags,
                            onAdd: (query) =>
                                _addTag(EmailTagKind.niche, query),
                            onToggle: (tag) => setState(() {
                              if (!_nicheTagIds.remove(tag.id)) {
                                _nicheTagIds.add(tag.id);
                              }
                            }),
                          ),
                          const SizedBox(height: 20),
                          FieldLabel(l10n.emailLibraryFieldSubject),
                          const SizedBox(height: 6),
                          MentionTextField(
                            controller: _subject,
                            multiline: false,
                            keywords: keywords,
                            onAddKeyword: _addMentionKeyword,
                          ),
                          const SizedBox(height: 20),
                          FieldLabel(l10n.emailLibraryFieldBody),
                          const SizedBox(height: 6),
                          MentionTextField(
                            controller: _body,
                            minLines: 7,
                            hintText: l10n.emailLibraryBodyHint,
                            keywords: keywords,
                            onAddKeyword: _addMentionKeyword,
                            // Right-clicking a line of the email files it in the
                            // context note below, which is where the "who this was
                            // written to" sentence gets built while reading.
                            onQuoteSelection: _quoteIntoContext,
                            // Monospace-adjacent line height: an email body is read
                            // here as a specimen, not as prose, and generous leading
                            // is what makes a paragraph break visible at a glance.
                            textStyle: theme.textTheme.bodyMedium?.copyWith(
                              height: 1.45,
                            ),
                          ),
                          const SizedBox(height: 20),
                          FieldLabel(l10n.emailLibraryFieldCritique),
                          const SizedBox(height: 6),
                          GrowingTextField(
                            controller: _critique,
                            minLines: 3,
                            hintText: l10n.emailLibraryCritiqueHint,
                          ),
                          const SizedBox(height: 20),
                          if (_source.isDraft) ...[
                            FieldLabel(l10n.emailLibraryFieldVerdict),
                            const SizedBox(height: 6),
                            EmailVerdictChips(
                              keyPrefix: 'editor-verdict',
                              verdict: _verdict,
                              onChanged: (value) =>
                                  setState(() => _verdict = value),
                            ),
                            if (_verdict != null) ...[
                              const SizedBox(height: 8),
                              TextField(
                                key: const ValueKey('editor-verdict-note'),
                                controller: _verdictNote,
                                minLines: 1,
                                maxLines: 4,
                                decoration: InputDecoration(
                                  border: const OutlineInputBorder(),
                                  labelText: _verdict == EmailVerdict.bad
                                      ? l10n.emailLibraryVerdictWhyBad
                                      : l10n.emailLibraryVerdictWhyGood,
                                  helperText: l10n.emailLibraryVerdictWhyHint,
                                  helperMaxLines: 3,
                                ),
                              ),
                            ],
                            const SizedBox(height: 20),
                          ] else ...[
                            SwitchListTile(
                              key: const ValueKey('editor-my-example'),
                              contentPadding: EdgeInsets.zero,
                              title: Text(l10n.emailLibraryMyExample),
                              subtitle: Text(l10n.emailLibraryMyExampleHint),
                              value: _source == EmailRecordSource.mine,
                              onChanged: (mine) => setState(
                                () => _source = mine
                                    ? EmailRecordSource.mine
                                    : EmailRecordSource.video,
                              ),
                            ),
                            const SizedBox(height: 20),
                          ],
                          FieldLabel(l10n.emailLibraryFieldContext),
                          const SizedBox(height: 6),
                          // A mention field with an empty vocabulary: no `@` menu is
                          // wanted here, but the pill layer is — it is what makes an
                          // excerpt quoted out of the body read as a lifted line
                          // rather than as something the writer typed.
                          MentionTextField(
                            controller: _context,
                            minLines: 2,
                            hintText: l10n.emailLibraryContextHint,
                            keywords: const [],
                            highlightQuotes: true,
                          ),
                          const SizedBox(height: 20),
                        ],
                      ),
                    ),
                  ),
                  const Divider(height: 1),
                  _EditorActions(
                    saving: _saving,
                    onCancel: _saving ? null : _close,
                    onSave: _saving ? null : () => _save(andAnother: false),
                    onSaveAndAnother:
                        _saving ? null : () => _save(andAnother: true),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Step to the previous ([delta] -1) or next ([delta] +1) record in the list.
class _AdjacentRecordIntent extends Intent {
  const _AdjacentRecordIntent(this.delta);

  final int delta;
}

class _EditorHeader extends StatelessWidget {
  const _EditorHeader({
    required this.title,
    required this.audience,
    required this.onClose,
  });

  final String title;
  final EmailAudience audience;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 12, 12),
      child: Row(
        children: [
          Text(title, style: theme.textTheme.titleMedium),
          const SizedBox(width: 12),
          // Which tab this belongs to, restated inside the dialog. The tab bar
          // is behind the barrier and easy to forget, and filing a brand email
          // under influencers is a mistake nothing downstream can detect.
          Chip(
            label: Text(
              audience == EmailAudience.influencer
                  ? l10n.emailLibraryTabInfluencers
                  : l10n.emailLibraryTabBrands,
            ),
            visualDensity: VisualDensity.compact,
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
          ),
          const Spacer(),
          IconButton(
            onPressed: onClose,
            tooltip: l10n.commonCancel,
            icon: const Icon(Icons.close),
          ),
        ],
      ),
    );
  }
}

class _EditorActions extends StatelessWidget {
  const _EditorActions({
    required this.saving,
    required this.onCancel,
    required this.onSave,
    required this.onSaveAndAnother,
  });

  final bool saving;
  final VoidCallback? onCancel;
  final VoidCallback? onSave;
  final VoidCallback? onSaveAndAnother;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
      // Tabbing out of the last field lands on "save and add another" first,
      // then "save", then "cancel" — the order someone finishing a record
      // actually wants, not the left-to-right order the buttons sit in.
      child: FocusTraversalGroup(
        policy: OrderedTraversalPolicy(),
        child: Row(
          children: [
            if (saving)
              const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            const Spacer(),
            FocusTraversalOrder(
              order: const NumericFocusOrder(3),
              child: TextButton(
                onPressed: onCancel,
                child: Text(l10n.commonCancel),
              ),
            ),
            const SizedBox(width: 8),
            // The primary action for the way this page is actually used: one
            // training video yields a run of emails, and closing the dialog
            // between each of them is the friction worth removing.
            FocusTraversalOrder(
              order: const NumericFocusOrder(1),
              child: FilledButton.tonal(
                onPressed: onSaveAndAnother,
                child: Text(l10n.emailLibrarySaveAndAnother),
              ),
            ),
            const SizedBox(width: 8),
            FocusTraversalOrder(
              order: const NumericFocusOrder(2),
              child: FilledButton(
                onPressed: onSave,
                child: Text(l10n.commonSave),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
