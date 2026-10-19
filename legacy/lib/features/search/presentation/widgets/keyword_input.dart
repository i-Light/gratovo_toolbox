import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/native/all_keywords_export.dart';
import 'package:gratovo_toolbox/core/native/local_pipeline_db.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/core/native/url_launcher_provider.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/features/search/application/search_keywords_controller.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/generate_keywords_dialog.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The keyword textarea — one keyword per line, live count, and (while a run
/// is going) showing which line the pipeline is on.
///
/// Three deliberate behaviours:
///
/// * **Always left-to-right.** YouTube search keywords are typed in Latin
///   script even by an Arabic-speaking team, and inheriting the app's RTL
///   direction under the Arabic locale put the caret on the wrong side and
///   scrambled mixed-script lines. The `Directionality` override here is
///   scoped to the field itself, so the surrounding labels still follow the
///   app locale.
///
/// * **Reopen a finished keyword.** Finished keywords are struck through and
///   skipped by the next Start. The `N done` button in the header puts any one
///   of them (or all) back in the queue — before this the only way back was
///   "Start from the top", which throws away the whole list's progress.
///
/// * **Read-only off desktop.** See [AppCapabilities.canEditSearchInputs] —
///   the field stays visible and scrollable on a phone so the team can read
///   the list, it just cannot be edited there.
///
/// * **Live position while running.** The keyword being worked gets a pill
///   behind it and the box scrolls to follow, finished keywords are dimmed
///   and ticked, and the header count switches to `3/12 keywords`. This is
///   the same layered technique the email editor's `@mention` pills use (see
///   `mention_text_field.dart`): a `CustomPaint` under the field, laid out
///   with the field's own style and padding, because `TextStyle.background`
///   is the only way to color editable text and it paints a hard-edged box
///   per glyph run with a visible seam between runs.
///
/// Size is handed down rather than owned here — see `search_screen.dart`,
/// which wraps this in a `SizedBox` sized to whatever split of the page's own
/// (fixed, unscrollable) height and width the keyword box has been given.
class KeywordInput extends ConsumerStatefulWidget {
  const KeywordInput({
    super.key,
    required this.controller,
    required this.keywordCount,
    this.currentKeyword,
    this.completedCount = 0,
    this.isRunning = false,
    this.onStartAtIndex,
  });

  final KeywordListController controller;
  final int keywordCount;

  /// The keyword the pipeline is working right now, or null between keywords
  /// and outside a run.
  final String? currentKeyword;

  /// How many keywords of [keywordCount] are finished — the `3` in `3/12`.
  final int completedCount;

  final bool isRunning;

  /// Manually begin a run at the given 1-based position in the box, skipping
  /// everything before it for this run only — a raw position, independent of
  /// which keywords are marked done (see `search_screen.dart`'s `_startSearch`
  /// doc comment on `startAtIndex`). Null hides the control that offers this.
  final ValueChanged<int>? onStartAtIndex;

  @override
  ConsumerState<KeywordInput> createState() => _KeywordInputState();
}

class _KeywordInputState extends ConsumerState<KeywordInput> {
  /// The field's own content padding, stated explicitly rather than left to
  /// `InputDecoration`'s defaults, because the highlight layer underneath has
  /// to inset by exactly the same amount — a default that changes with the
  /// border type or text density would silently slide the pills off their
  /// words.
  static const _contentPadding = EdgeInsets.symmetric(
    horizontal: 12,
    vertical: 12,
  );
  static const _borderWidth = 1.0;

  final _scroll = ScrollController();

  /// The keyword the box has already scrolled to, so following the run does
  /// not fight the user scrolling back to read something.
  String? _scrolledTo;

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(KeywordInput oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.currentKeyword != oldWidget.currentKeyword) {
      _scrollToCurrent();
    }
  }

  /// Brings the keyword now being worked into view.
  ///
  /// Only ever scrolls when the keyword actually changed (guarded by
  /// [_scrolledTo]) and only far enough to put the line a third of the way
  /// down the visible box — a run of forty keywords otherwise yanks the view
  /// once a minute, and pinning the line to the very top hides everything
  /// already done.
  void _scrollToCurrent() {
    final keyword = widget.currentKeyword;
    if (keyword == null || keyword == _scrolledTo) return;
    _scrolledTo = keyword;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients) return;
      final range = keywordLineRange(widget.controller.text, keyword);
      if (range == null) return;
      final width = _lastTextWidth;
      if (width == null || width <= 0) return;

      final painter = TextPainter(
        text: TextSpan(text: widget.controller.text, style: _lastTextStyle),
        textDirection: TextDirection.ltr,
        textScaler: MediaQuery.textScalerOf(context),
      )..layout(maxWidth: width);
      final lineTop = painter
          .getOffsetForCaret(TextPosition(offset: range.start), Rect.zero)
          .dy;
      painter.dispose();

      final viewport = _scroll.position.viewportDimension;
      final target =
          (lineTop - viewport / 3).clamp(0.0, _scroll.position.maxScrollExtent);
      if ((target - _scroll.offset).abs() < 4) return;
      _scroll.animateTo(
        target,
        duration: const Duration(milliseconds: 260),
        curve: Curves.easeOutCubic,
      );
    });
  }

  /// Captured during build so [_scrollToCurrent] can lay text out the same
  /// way the field does without re-deriving either from a different context.
  double? _lastTextWidth;
  TextStyle? _lastTextStyle;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final canEdit = ref.watch(capabilitiesProvider).canEditSearchInputs;
    final textStyle = theme.textTheme.bodyLarge ?? const TextStyle();
    _lastTextStyle = textStyle;

    return Card(
      color: AppColors.darkCardBright.withAlpha(50),
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.searchKeywordsLabel,
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                // Only between runs, like reopening: a run rewrites this
                // list wholesale as each keyword finishes.
                if (!widget.isRunning && canEdit)
                  GenerateKeywordsButton(controller: widget.controller),
                if (canEdit) const _SaveAllKeywordsButton(),
                Text(
                  // While a run is going the count becomes a position: "3/12
                  // keywords". It goes back to a plain total the moment the
                  // run ends, however it ended — a stopped or crashed run
                  // leaving a frozen "3/12" on screen would read as the run
                  // still being somewhere in the middle of the list.
                  widget.isRunning
                      ? l10n.searchKeywordsProgressCount(
                          formatCount(widget.completedCount),
                          formatCount(widget.keywordCount),
                        )
                      // Grouped so a 1,200-keyword list doesn't read as "1200".
                      : l10n.searchKeywordsCount(
                          formatCount(widget.keywordCount)),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: widget.isRunning ? theme.colorScheme.primary : null,
                    fontWeight: widget.isRunning ? FontWeight.w600 : null,
                  ),
                ),
                // Only between runs: reopening a keyword mid-run would race
                // the run's own progress writes, which overwrite this list
                // wholesale every time a keyword finishes.
                if (!widget.isRunning && canEdit) const _ReopenDoneButton(),
                if (!widget.isRunning &&
                    canEdit &&
                    widget.onStartAtIndex != null &&
                    widget.keywordCount > 0)
                  _StartAtIndexButton(
                    keywordCount: widget.keywordCount,
                    onStartAtIndex: widget.onStartAtIndex!,
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Expanded(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: theme.cardTheme.color,
                  borderRadius: BorderRadius.circular(12),
                ),
                // The field itself is forced LTR regardless of app locale.
                child: Directionality(
                  textDirection: TextDirection.ltr,
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      _lastTextWidth = constraints.maxWidth -
                          _contentPadding.horizontal -
                          _borderWidth * 2;
                      return Stack(
                        children: [
                          // Under the field, inset by exactly the padding the
                          // text sits in and laid out with the same style, so
                          // the pill lands on its line rather than near it.
                          // Repainted off the controller and the scroll offset,
                          // which are the only two things that move it.
                          Positioned.fill(
                            child: IgnorePointer(
                              child: Padding(
                                padding: _contentPadding +
                                    const EdgeInsets.all(_borderWidth),
                                child: AnimatedBuilder(
                                  animation: Listenable.merge(
                                      [widget.controller, _scroll]),
                                  builder: (context, _) => CustomPaint(
                                    painter: _KeywordHighlightPainter(
                                      text: widget.controller.text,
                                      style: textStyle,
                                      currentKeyword: widget.currentKeyword,
                                      textScaler:
                                          MediaQuery.textScalerOf(context),
                                      scrollOffset: _scroll.hasClients
                                          ? _scroll.offset
                                          : 0,
                                      color: theme.colorScheme.primary
                                          .withValues(alpha: 0.13),
                                      borderColor: theme.colorScheme.primary
                                          .withValues(alpha: 0.28),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                          TextField(
                            controller: widget.controller,
                            scrollController: _scroll,
                            readOnly: !canEdit,
                            expands: true,
                            maxLines: null,
                            minLines: null,
                            style: textStyle,
                            textAlign: TextAlign.left,
                            textAlignVertical: TextAlignVertical.top,
                            keyboardType: TextInputType.multiline,
                            decoration: InputDecoration(
                              hintText: canEdit
                                  ? l10n.searchKeywordsHint
                                  : l10n.searchInputsReadOnlyHint,
                              alignLabelWithHint: true,
                              border: const OutlineInputBorder(),
                              contentPadding: _contentPadding,
                              // The fill would paint over the pill layer
                              // underneath. The read-only tint that used to
                              // come from it is carried by the dimmed text
                              // instead.
                              filled: false,
                            ),
                          ),
                        ],
                      );
                    },
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}

/// Manually begin a run partway through the list — the door out of "start
/// over from #1 or nothing" for a long list where only the back half still
/// needs (re-)running. A raw position, not tied to which keywords are marked
/// done (see `search_screen.dart`'s `_startSearch` doc on `startAtIndex`) —
/// this is a "skip ahead just this once," not a record of anything.
class _StartAtIndexButton extends StatelessWidget {
  const _StartAtIndexButton({
    required this.keywordCount,
    required this.onStartAtIndex,
  });

  final int keywordCount;
  final ValueChanged<int> onStartAtIndex;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Tooltip(
      message: l10n.searchKeywordsStartAtTooltip,
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: () => showDialog<void>(
          context: context,
          builder: (_) => _StartAtIndexDialog(
            keywordCount: keywordCount,
            onStartAtIndex: onStartAtIndex,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
          child:
              Icon(Icons.skip_next, size: 18, color: theme.colorScheme.primary),
        ),
      ),
    );
  }
}

/// The "start at #" dialog: one bounded number field, since the whole point
/// is skipping the part of the list already known not to need it — no
/// separate confirm step beyond entering a valid number.
class _StartAtIndexDialog extends StatefulWidget {
  const _StartAtIndexDialog({
    required this.keywordCount,
    required this.onStartAtIndex,
  });

  final int keywordCount;
  final ValueChanged<int> onStartAtIndex;

  @override
  State<_StartAtIndexDialog> createState() => _StartAtIndexDialogState();
}

class _StartAtIndexDialogState extends State<_StartAtIndexDialog> {
  final _controller = TextEditingController();
  int? _parsed;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final value = _parsed;
    if (value == null) return;
    Navigator.of(context).pop();
    widget.onStartAtIndex(value);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(l10n.searchKeywordsStartAtTitle),
      content: SizedBox(
        width: 320,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.searchKeywordsStartAtHint,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _controller,
              autofocus: true,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: InputDecoration(
                labelText: l10n.searchKeywordsStartAtLabel(
                    formatCount(widget.keywordCount)),
                isDense: true,
                border: const OutlineInputBorder(),
              ),
              onChanged: (text) {
                final n = int.tryParse(text.trim());
                setState(() {
                  _parsed = (n != null && n >= 1 && n <= widget.keywordCount)
                      ? n
                      : null;
                });
              },
              onSubmitted: (_) => _submit(),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonClose),
        ),
        FilledButton(
          onPressed: _parsed == null ? null : _submit,
          child: Text(l10n.searchKeywordsStartAtAction),
        ),
      ],
    );
  }
}

/// Appends every keyword this machine can see anywhere -- the box (queued or
/// already done), plus every row `store.py`'s `keywords` table holds, which
/// after a sync is every keyword any teammate has ever queued, not just this
/// machine's own -- to `data/all_keywords.txt`, skipping any line already in
/// that file.
///
/// Deliberately dumb: it never removes or reorders what is already in the
/// file, it only adds what it found that the file doesn't already have. That
/// file is a running tally across the whole project, kept separate from
/// `keywords.json` (which `search.py` rewrites fresh on every Start and only
/// ever holds one run's worth) so the history survives runs being started,
/// finished and started again with a different list.
class _SaveAllKeywordsButton extends ConsumerWidget {
  const _SaveAllKeywordsButton();

  Future<void> _save(BuildContext context, WidgetRef ref) async {
    final projectRootOverride =
        ref.read(pythonEnvironmentProvider).projectRootOverride.trim();
    final paths = ScraperProcess.resolvePaths(
      projectRootOverride:
          projectRootOverride.isEmpty ? null : projectRootOverride,
    );
    if (paths == null) {
      AppToast.error(context, 'Could not find the app\'s data folder.');
      return;
    }
    final keywords = [
      ...ref.read(searchKeywordsProvider).keywords,
      ...LocalPipelineDb.readAllKeywords(paths.dbPath),
    ];
    if (keywords.isEmpty) {
      AppToast.info(context, 'No keywords found anywhere to save.');
      return;
    }
    try {
      final added = await appendUniqueKeywords(
        dataDir: paths.dataDir,
        keywords: keywords,
      );
      await ref.read(urlLauncherProvider)(Uri.file(paths.dataDir));
      if (!context.mounted) return;
      AppToast.success(
        context,
        added == 0
            ? 'all_keywords.txt is already up to date.'
            : 'Added $added new keyword${added == 1 ? '' : 's'} to all_keywords.txt.',
      );
    } catch (error) {
      if (!context.mounted) return;
      AppToast.error(context, 'Could not save all_keywords.txt: $error');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Tooltip(
      message:
          'Save all keywords (including queued) to all_keywords.txt and open its folder',
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: () => _save(context, ref),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
          child:
              Icon(Icons.save_alt, size: 18, color: theme.colorScheme.primary),
        ),
      ),
    );
  }
}

/// The `N done` button in the keyword box header: opens the redo sheet.
///
/// Finishing a keyword is sticky by design — that is what lets a run pick up
/// where a crash left it. The cost was that there was no way *out* of finished
/// except "Start from the top", which drops every keyword's progress; wanting
/// to re-run one keyword whose results looked thin meant re-scraping the whole
/// list. This is that missing door, and it is one click from the box the
/// struck-through keyword is sitting in.
class _ReopenDoneButton extends ConsumerWidget {
  const _ReopenDoneButton();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final completed = ref.watch(searchKeywordsProvider).completed;
    // Shown even at zero, greyed out. Hiding it was worse: the one moment
    // somebody goes looking for "how do I run that keyword again" is a moment
    // they have no finished keywords in front of them to prove the control
    // exists, so an absent button reads as a missing feature rather than as an
    // empty one. At zero it is also the answer to the question — nothing has
    // finished yet.
    final enabled = completed.isNotEmpty;
    final color =
        enabled ? theme.colorScheme.primary : theme.colorScheme.outline;

    return Tooltip(
      message: l10n.searchKeywordsReopenTooltip,
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: enabled
            ? () => showDialog<void>(
                  context: context,
                  builder: (_) => const _ReopenDialog(),
                )
            : null,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.replay, size: 15, color: color),
              const SizedBox(width: 4),
              Text(
                l10n.searchKeywordsDoneCount(formatCount(completed.length)),
                style: theme.textTheme.bodySmall?.copyWith(color: color),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The redo sheet: every finished keyword, one tap each to put it back in the
/// queue, and a Redo all for the whole lot.
///
/// A dropdown menu was the first shape this took and it was the wrong one. A
/// real run is thirty to fifty keywords, so the thing being browsed is a list
/// long enough to need scanning and scrolling — and a menu that closes the
/// moment you pick something makes reopening three keywords three round trips
/// through a button you have to find again each time. This stays open instead:
/// pick as many as you like, watch the count fall, close when done. It closes
/// itself only when the list empties, since an empty sheet has nothing to say.
///
/// Reads the saved progress directly rather than taking it as a parameter: the
/// list it offers and the list it mutates have to be the same one, and the
/// live progress of a running run is a different (transient) thing that must
/// not be editable — which is also why the button that opens this is hidden
/// mid-run.
class _ReopenDialog extends ConsumerWidget {
  const _ReopenDialog();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final completed = ref.watch(searchKeywordsProvider).completed;
    final notifier = ref.read(searchKeywordsProvider.notifier);

    // Reopening the last one leaves nothing to show. Popped after the frame,
    // not during it: this is a build, and `Navigator` may not be mutated from
    // inside one.
    if (completed.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (context.mounted) Navigator.of(context).maybePop();
      });
    }

    // Big, but not edge to edge on a 4K monitor — a 1,200px-wide list of
    // one-word keywords is harder to read than a 520px one, and the sheet has
    // to stay usable on a laptop screen too.
    final screen = MediaQuery.sizeOf(context);
    final width = screen.width * 0.9 < 520.0 ? screen.width * 0.9 : 520.0;
    final height = screen.height * 0.7 < 560.0 ? screen.height * 0.7 : 560.0;

    return AlertDialog(
      title: Text(l10n.searchKeywordsReopenTitle),
      contentPadding: const EdgeInsets.fromLTRB(0, 12, 0, 16),
      content: SizedBox(
        width: width,
        height: height,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 8),
              child: Text(
                l10n.searchKeywordsReopenHeader,
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ),
            const Divider(height: 1),
            Expanded(
              // Lazily built: fifty keywords is an ordinary run and there is
              // no reason to lay out the forty that are scrolled past.
              child: ListView.builder(
                padding: EdgeInsets.zero,
                itemCount: completed.length,
                itemBuilder: (context, index) {
                  final keyword = completed[index];
                  return ListTile(
                    dense: true,
                    leading: Icon(Icons.replay,
                        size: 18, color: theme.colorScheme.primary),
                    // Keywords are Latin-script even under the Arabic locale,
                    // the same reason the field itself is forced LTR.
                    title: Text(
                      keyword,
                      textDirection: TextDirection.ltr,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    onTap: () => notifier.reopenKeyword(keyword),
                  );
                },
              ),
            ),
            const Divider(height: 1),
          ],
        ),
      ),
      actions: [
        // Empties the list, which closes the sheet on the next frame — so this
        // reads as one action rather than leaving an empty panel behind.
        TextButton.icon(
          onPressed: notifier.clearProgress,
          icon: const Icon(Icons.restart_alt, size: 18),
          label: Text(l10n.searchKeywordsReopenAll),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonClose),
        ),
      ],
    );
  }
}

/// A [TextEditingController] that knows which of its lines are done and which
/// one is being worked, and dims the finished ones.
///
/// color goes through `buildTextSpan` rather than the painter underneath
/// because it is a property of the text itself, and Flutter re-runs this on
/// every controller notification — so [setProgress] is all it takes to
/// restyle. The *pill* behind the live keyword stays in the painter, where a
/// rounded shape is possible; `TextStyle.background` can only give a
/// hard-edged box per glyph run.
class KeywordListController extends TextEditingController {
  KeywordListController({super.text});

  Set<String> _completed = const {};
  String? _current;

  Set<String> get completedKeywords => _completed;

  void setProgress({required Set<String> completed, String? current}) {
    if (setEquals(_completed, completed) && _current == current) return;
    _completed = completed;
    _current = current;
    notifyListeners();
  }

  @override
  TextSpan buildTextSpan({
    required BuildContext context,
    TextStyle? style,
    required bool withComposing,
  }) {
    // Nothing to show, or the IME is mid-composition — the base class handles
    // the composing underline and getting that wrong is worse than skipping
    // the dimming for the moment somebody is typing a composed character.
    final composing = value.composing;
    if (_completed.isEmpty ||
        (withComposing && composing.isValid && !composing.isCollapsed)) {
      return super.buildTextSpan(
        context: context,
        style: style,
        withComposing: withComposing,
      );
    }

    final dim = (style ?? const TextStyle()).copyWith(
      color: (style?.color ?? Theme.of(context).colorScheme.onSurface)
          .withValues(alpha: 0.45),
      decoration: TextDecoration.lineThrough,
      decorationColor:
          Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.35),
    );

    final spans = <TextSpan>[];
    final lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      final line = lines[i];
      final suffix = i == lines.length - 1 ? '' : '\n';
      spans.add(
        TextSpan(
          text: '$line$suffix',
          style: _completed.contains(line.trim()) && line.trim().isNotEmpty
              ? dim
              : style,
        ),
      );
    }
    return TextSpan(style: style, children: spans);
  }
}

/// The character range of the line holding [keyword], or null if no line
/// matches. Compares trimmed, because that is how the keyword was sent to the
/// pipeline in the first place.
TextRange? keywordLineRange(String text, String keyword) {
  final target = keyword.trim();
  if (target.isEmpty) return null;
  var offset = 0;
  for (final line in text.split('\n')) {
    if (line.trim() == target) {
      // The trimmed span, not the whole line: a pill drawn over the trailing
      // spaces of a copy-pasted list would run off past the last word.
      final leading = line.length - line.trimLeft().length;
      return TextRange(
        start: offset + leading,
        end: offset + leading + target.length,
      );
    }
    offset += line.length + 1;
  }
  return null;
}

/// Draws the rounded pill behind the keyword currently being worked.
class _KeywordHighlightPainter extends CustomPainter {
  const _KeywordHighlightPainter({
    required this.text,
    required this.style,
    required this.currentKeyword,
    required this.textScaler,
    required this.scrollOffset,
    required this.color,
    required this.borderColor,
  });

  final String text;
  final TextStyle style;
  final String? currentKeyword;
  final TextScaler textScaler;
  final double scrollOffset;
  final Color color;
  final Color borderColor;

  static const _padXL = 7.0;
  static const _padXR = 12.0;
  static const _insetYU = 3.0;
  static const _insetYD = -1.0;
  static const _radius = 10.0;

  @override
  void paint(Canvas canvas, Size size) {
    final keyword = currentKeyword;
    if (keyword == null) return;
    final range = keywordLineRange(text, keyword);
    if (range == null) return;

    final painter = TextPainter(
      text: TextSpan(text: text, style: style),
      textDirection: TextDirection.ltr,
      textScaler: textScaler,
    )..layout(maxWidth: size.width);

    final boxes = painter.getBoxesForSelection(
      TextSelection(baseOffset: range.start, extentOffset: range.end),
    );
    painter.dispose();

    final fill = Paint()..color = color;
    final stroke = Paint()
      ..color = borderColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;

    for (final box in boxes) {
      // One box per line: a keyword long enough to wrap gets a pill on each
      // half rather than one shape spanning the gap.
      final rect = Rect.fromLTRB(
        box.left - _padXL,
        box.top - _insetYU,
        box.right + _padXR,
        box.bottom + _insetYD,
      ).shift(Offset(0, -scrollOffset));
      final pill =
          RRect.fromRectAndRadius(rect, const Radius.circular(_radius));
      canvas.drawRRect(pill, fill);
      canvas.drawRRect(pill.deflate(0.5), stroke);
    }
  }

  @override
  bool shouldRepaint(_KeywordHighlightPainter old) =>
      old.text != text ||
      old.style != style ||
      old.currentKeyword != currentKeyword ||
      old.scrollOffset != scrollOffset ||
      old.color != color ||
      old.borderColor != borderColor ||
      old.textScaler != textScaler;
}
