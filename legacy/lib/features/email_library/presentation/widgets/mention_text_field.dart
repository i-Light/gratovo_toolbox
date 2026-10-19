import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gratovo_toolbox/core/scroll/smooth_wheel_scroll.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The placeholders an email in this library is written against.
///
/// They are the parts of a template that change per send — who it goes to, who
/// it comes from, and what it is about — and they are deliberately not
/// localised: the token is data that travels with the record into whatever
/// tool eventually merges it, not a word anyone reads as prose.
const List<String> kEmailMentionKeywords = [
  'receiver',
  'sender',
  'creator',
  'brand',
  'product',
];

/// A character that can be part of a keyword being typed after the `@`.
///
/// Anything else — a space, a newline, punctuation — ends the mention, which is
/// what closes the list when you type past it and never reopens it in the
/// middle of an email address.
bool _isWordChar(String ch) => RegExp('[A-Za-z0-9_]').hasMatch(ch);

final _mentionPattern = RegExp('@[A-Za-z0-9_]+');

/// Turns whatever was typed into the "+" dialog into something that can
/// actually be a mention, or null if nothing usable is left.
///
/// A keyword is read back out of the text by [_mentionPattern], so a label
/// with a space in it could be stored but never recognised again. Folding the
/// spaces into underscores here means "reply to" becomes `@reply_to` rather
/// than a keyword that silently never matches.
String? asMentionToken(String raw) {
  final token = raw
      .trim()
      .replaceAll(RegExp('[^A-Za-z0-9_]+'), '_')
      .replaceAll(RegExp(r'^_+|_+$'), '');
  return token.isEmpty ? null : token;
}

/// Every finished mention in [text] — the ranges that get drawn as pills.
///
/// A half-typed `@rec` is deliberately not one: the pill appearing only once
/// the word is a real keyword is what tells you the token was recognised,
/// rather than that you typed an at-sign.
List<TextRange> mentionRangesIn(String text, List<String> keywords) {
  final lowered = keywords.map((keyword) => keyword.toLowerCase()).toSet();
  final ranges = <TextRange>[];
  for (final match in _mentionPattern.allMatches(text)) {
    // Same rule as the trigger: `sam@brand` is an address, not a mention.
    if (match.start > 0 && _isWordChar(text[match.start - 1])) continue;
    if (!lowered.contains(match.group(0)!.substring(1).toLowerCase())) continue;
    ranges.add(TextRange(start: match.start, end: match.end));
  }
  return ranges;
}

/// The marks an excerpt lifted out of one field wears in another.
///
/// Guillemets rather than plain quotes because the pair has to be found again
/// in text nobody is stopping from containing `"` — a typed straight quote is
/// ordinary punctuation in an email, and one of these is not.
const String kQuoteOpen = '«';
const String kQuoteClose = '»';

final _quotePattern =
    RegExp('$kQuoteOpen[^$kQuoteOpen$kQuoteClose]*$kQuoteClose');

/// Every finished quote in [text] — the ranges that get drawn as pills.
///
/// Unclosed marks are not one, for the same reason a half-typed `@rec` is not
/// a mention: the pill is what says the token was recognised.
List<TextRange> quoteRangesIn(String text) => [
      for (final match in _quotePattern.allMatches(text))
        TextRange(start: match.start, end: match.end),
    ];

/// Wraps [raw] as one quote token, or null if there is nothing left to quote.
///
/// The excerpt is flattened onto one line: a quote pulled out of an email body
/// carries that body's line breaks, and pasted into a note they turn a single
/// remark into a stanza. Any guillemets already inside it are dropped, since a
/// nested pair would end the token early and leave the rest unhighlighted.
String? asQuoteToken(String raw) {
  final flattened = raw
      .replaceAll(kQuoteOpen, '')
      .replaceAll(kQuoteClose, '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  return flattened.isEmpty ? null : '$kQuoteOpen$flattened$kQuoteClose';
}

/// A text field where typing `@` opens a filtered list of [keywords] under the
/// caret, and Tab drops the highlighted one into the text.
///
/// Written as a real field rather than a wrapper around an arbitrary child
/// because the popup has to sit *at the caret*, and finding the caret means
/// laying the text out a second time with exactly the style and padding the
/// field itself uses. Owning both halves is what keeps those two in step; a
/// builder-shaped API would let them drift and put the popup a line off.
class MentionTextField extends StatefulWidget {
  const MentionTextField({
    super.key,
    required this.controller,
    this.focusNode,
    this.keywords = kEmailMentionKeywords,
    this.minLines = 1,
    this.multiline = true,
    this.hintText,
    this.textStyle,
    this.autofocus = false,
    this.textInputAction,
    this.onSubmitted,
    this.onAddKeyword,
    this.highlightQuotes = false,
    this.onQuoteSelection,
  });

  final TextEditingController controller;
  final FocusNode? focusNode;
  final List<String> keywords;

  /// How much empty space the field claims before anything is typed.
  final int minLines;

  /// True for a body that grows with its content, false for a one-line field
  /// like the subject, where Enter should submit rather than add a line.
  final bool multiline;

  final String? hintText;
  final TextStyle? textStyle;
  final bool autofocus;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;

  /// Asked for one more keyword when the menu's "+" is taken, carrying
  /// whatever had been typed after the `@` so it does not have to be typed
  /// again. Returns the keyword to insert, or null if nothing was added.
  ///
  /// A callback rather than a list this widget appends to: where the
  /// vocabulary is stored, and who is allowed to grow it, is the caller's
  /// business — the same split the tag "+" in the editor already uses. With no
  /// callback the row is simply not offered.
  final Future<String?> Function(String query)? onAddKeyword;

  /// Whether `«…»` excerpts are drawn with the same pill a mention wears.
  ///
  /// Off by default: the field an excerpt is *taken from* has no reason to
  /// highlight one, and the marks would only read as noise there.
  final bool highlightQuotes;

  /// Called with the selected text when the field is right-clicked while
  /// something is selected — the gesture that lifts a line out of this field
  /// and into another one.
  ///
  /// Right-click keeps its usual menu whenever the selection is empty, so
  /// pasting into the field is untouched; it is only a selection that turns the
  /// gesture into "send this over there". With no callback nothing changes at
  /// all.
  final ValueChanged<String>? onQuoteSelection;

  @override
  State<MentionTextField> createState() => _MentionTextFieldState();
}

/// Horizontal and vertical padding inside the field, and the border it sits
/// in. The caret maths below adds these back by hand, so they are stated once
/// here and read from both places.
const double _padH = 12;
const double _padV = 12;
const double _borderWidth = 1;

/// The pill drawn behind a recognised mention, and how far it is grown past
/// the glyphs so the text does not touch its edge.
const double _pillPaddingX = 4;
const double _pillInsetY = 25.5;
const double _pillRadius = 6;
const double _pillpadxl = 10;
const double _pillpadxr = 0;
const double _pillpadyt = 3;
const double _pillpadyb = 3;

const double _menuWidth = 240;
const double _menuItemHeight = 38;
const double _menuMaxHeight = 220;

class _MentionTextFieldState extends State<MentionTextField> {
  final _link = LayerLink();
  final _fieldKey = GlobalKey();

  /// Read by the pill painter. A one-line field scrolls sideways once the text
  /// outruns it, and pills painted at unscrolled positions would slide out from
  /// under their words.
  final _scroll = ScrollController();

  late FocusNode _focusNode;
  bool _ownsFocusNode = false;

  OverlayEntry? _entry;

  /// Index of the `@` that opened the current suggestion list, or -1 when no
  /// list is open. Everything from here to the caret is what gets replaced.
  int _triggerIndex = -1;
  List<String> _matches = const [];
  int _highlighted = 0;

  /// What has been typed after the `@` so far. Carried into the "+" dialog so
  /// a keyword that turned out not to exist is not typed twice.
  String _query = '';

  /// Set when the last right-click was answered by handing the selection to
  /// [MentionTextField.onQuoteSelection], so the selection toolbar that the
  /// same click is about to raise can be suppressed. The gesture did something
  /// already; a menu on top of it would be a second thing to dismiss.
  bool _quotedLastSecondaryTap = false;

  bool get _isOpen => _entry != null;

  /// Whether the menu offers a row for adding a keyword, and therefore whether
  /// the highlight has one more stop than it has matches.
  bool get _canAdd => widget.onAddKeyword != null;

  int get _rowCount => _matches.length + (_canAdd ? 1 : 0);

  @override
  void initState() {
    super.initState();
    _focusNode = widget.focusNode ?? FocusNode();
    _ownsFocusNode = widget.focusNode == null;
    widget.controller.addListener(_syncSuggestions);
    _focusNode.addListener(_onFocusChanged);
  }

  @override
  void didUpdateWidget(MentionTextField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_syncSuggestions);
      widget.controller.addListener(_syncSuggestions);
    }
    if (oldWidget.focusNode != widget.focusNode) {
      _focusNode.removeListener(_onFocusChanged);
      if (_ownsFocusNode) _focusNode.dispose();
      _focusNode = widget.focusNode ?? FocusNode();
      _ownsFocusNode = widget.focusNode == null;
      _focusNode.addListener(_onFocusChanged);
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_syncSuggestions);
    _focusNode.removeListener(_onFocusChanged);
    _removeOverlay();
    if (_ownsFocusNode) _focusNode.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _onFocusChanged() {
    if (!_focusNode.hasFocus) _close();
  }

  /// Decides, after every edit, whether a suggestion list should be open and
  /// what should be in it.
  ///
  /// Driven entirely off the current text and caret rather than off keystrokes,
  /// so it behaves the same when the caret is moved back into a half-typed
  /// mention, or text is pasted, as it does while typing forwards.
  void _syncSuggestions() {
    final selection = widget.controller.selection;
    final text = widget.controller.text;
    if (!selection.isValid || !selection.isCollapsed) return _close();

    final caret = selection.baseOffset;
    if (caret < 0 || caret > text.length) return _close();

    var index = caret - 1;
    while (index >= 0 && text[index] != '@') {
      if (!_isWordChar(text[index])) return _close();
      index--;
    }
    if (index < 0) return _close();
    // `foo@bar` is an email address, not a mention. A trigger only counts at
    // the start of a word.
    if (index > 0 && _isWordChar(text[index - 1])) return _close();

    final query = text.substring(index + 1, caret);
    final lowered = query.toLowerCase();
    final matches = widget.keywords
        .where((keyword) => keyword.toLowerCase().startsWith(lowered))
        .toList();
    // With nothing matching, the menu stays open only because it can still
    // offer to add what was typed — which is the case the "+" exists for.
    if (matches.isEmpty && !(_canAdd && query.isNotEmpty)) return _close();

    // Keep the highlight on the same keyword across a keystroke that narrows
    // the list, so typing one more letter does not move the selection out from
    // under a Tab that was already on its way.
    final previous =
        _highlighted < _matches.length ? _matches[_highlighted] : null;
    _triggerIndex = index;
    _query = query;
    _matches = matches;
    _highlighted = math.max(0, matches.indexOf(previous ?? ''));

    if (_isOpen) {
      _entry!.markNeedsBuild();
    } else {
      _open();
    }
  }

  void _open() {
    final overlay = Overlay.maybeOf(context);
    if (overlay == null) return;
    _entry = OverlayEntry(builder: _buildMenu);
    overlay.insert(_entry!);
  }

  void _close() {
    _triggerIndex = -1;
    _matches = const [];
    _query = '';
    _highlighted = 0;
    _removeOverlay();
  }

  void _removeOverlay() {
    _entry?.remove();
    _entry = null;
  }

  void _move(int delta) {
    if (_rowCount == 0) return;
    _highlighted = (_highlighted + delta) % _rowCount;
    if (_highlighted < 0) _highlighted += _rowCount;
    _entry?.markNeedsBuild();
  }

  /// Takes row [index] of the menu: a keyword, or the "+" row after them.
  void _take(int index) {
    if (index == _matches.length) return unawaited(_addKeyword());
    if (index < _matches.length) _accept(_matches[index]);
  }

  /// Replaces the typed `@frag` with the chosen keyword.
  void _accept(String keyword) {
    _replaceMention(
      _triggerIndex,
      widget.controller.selection.baseOffset,
      keyword,
    );
  }

  /// Asks the caller for a new keyword, then drops it in like any other.
  ///
  /// The range is captured before the await because the dialog takes focus,
  /// and losing focus closes the menu and forgets it — the mention has to be
  /// completed where it was started, not wherever the caret ends up.
  Future<void> _addKeyword() async {
    final add = widget.onAddKeyword;
    if (add == null) return;
    final start = _triggerIndex;
    final end = widget.controller.selection.baseOffset;
    final query = _query;
    _close();

    final keyword = await add(query);
    if (!mounted || keyword == null) return;
    // Back to where the sentence was left off, so the new keyword lands in the
    // text rather than only in the vocabulary.
    _focusNode.requestFocus();
    _replaceMention(start, end, keyword);
  }

  /// Writes `@keyword ` over the range the mention was typed in.
  ///
  /// The trailing space is what makes the list close on its own and lets the
  /// sentence carry on without a second keystroke.
  void _replaceMention(int start, int end, String keyword) {
    final text = widget.controller.text;
    if (start < 0 || end < start || end > text.length) return _close();
    final insertion = '@$keyword ';
    final offset = start + insertion.length;
    _close();
    widget.controller.value = TextEditingValue(
      text: text.replaceRange(start, end, insertion),
      selection: TextSelection.collapsed(offset: offset),
    );
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (!_isOpen) return KeyEventResult.ignored;
    // Only the press acts. Key-up is left alone: nothing downstream turns a
    // release into traversal or a newline, so there is nothing to swallow.
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.escape) {
      _close();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowDown) {
      _move(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp) {
      _move(-1);
      return KeyEventResult.handled;
    }
    // Tab is the asked-for accept key; Enter is here because every list that
    // opens under a caret answers to it and it costs nothing to honour. Both
    // are intercepted only while the list is open, so traversal and newlines
    // are untouched the rest of the time.
    if (key == LogicalKeyboardKey.tab ||
        key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      if (_highlighted < _rowCount) _take(_highlighted);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  /// Where the popup goes, in the field's own coordinates.
  ///
  /// Laid out with the same style, width and padding as the field, then asked
  /// for the caret's rectangle — the only way to land under the caret in a
  /// field that wraps, since Flutter's own render object for it is not exposed.
  Offset? _caretAnchor() {
    final box = _fieldKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize) return null;
    final caret = widget.controller.selection.baseOffset;
    if (caret < 0) return null;

    final painter = TextPainter(
      text: TextSpan(text: widget.controller.text, style: _effectiveStyle()),
      textDirection: Directionality.of(context),
      textScaler: MediaQuery.textScalerOf(context),
    )..layout(
        maxWidth: math.max(
          0,
          box.size.width - _padH * 2 - _borderWidth * 2,
        ),
      );
    final offset = painter.getOffsetForCaret(
      TextPosition(offset: math.min(caret, widget.controller.text.length)),
      Rect.zero,
    );
    final lineHeight = painter.preferredLineHeight;
    painter.dispose();

    return Offset(
      _padH + _borderWidth + offset.dx,
      _padV + _borderWidth + offset.dy + lineHeight,
    );
  }

  /// The fill the field would have painted for itself, moved down a layer.
  ///
  /// Read off the theme rather than hard-coded so this widget still looks like
  /// every other input in the app, including when the theme changes.
  Color? _fillColor(BuildContext context) {
    final decoration = Theme.of(context).inputDecorationTheme;
    return decoration.filled ? decoration.fillColor : null;
  }

  /// The corner radius of that fill, taken from the border the field draws on
  /// top of it, so the two edges line up.
  BorderRadius _fillRadius(BuildContext context) {
    final decoration = Theme.of(context).inputDecorationTheme;
    final border = decoration.enabledBorder ?? decoration.border;
    return border is OutlineInputBorder
        ? border.borderRadius.resolve(Directionality.of(context))
        : BorderRadius.circular(4);
  }

  TextStyle _effectiveStyle() {
    final base = Theme.of(context).textTheme.bodyLarge ?? const TextStyle();
    return base.merge(widget.textStyle);
  }

  Widget _buildMenu(BuildContext overlayContext) {
    final anchor = _caretAnchor();
    final box = _fieldKey.currentContext?.findRenderObject() as RenderBox?;
    if (anchor == null || box == null || _rowCount == 0) {
      return const SizedBox.shrink();
    }

    final height = math.min(_menuMaxHeight, _rowCount * _menuItemHeight + 8);
    // Kept inside the field's own width, so a caret near the right margin does
    // not push the list off the dialog.
    final dx = math.max(
      0.0,
      math.min(anchor.dx, box.size.width - _menuWidth),
    );

    // Flip above the line when there is no room below — near the bottom of the
    // editor the list would otherwise open off-screen, which reads as the
    // feature not working at all.
    final screenHeight = MediaQuery.of(overlayContext).size.height;
    final globalTop = box.localToGlobal(Offset(0, anchor.dy)).dy;
    final flip = globalTop + height + 16 > screenHeight;
    final dy = flip
        ? anchor.dy - height - (_effectiveStyle().fontSize ?? 16) - 8
        : anchor.dy + 4;

    return Positioned(
      width: _menuWidth,
      child: CompositedTransformFollower(
        link: _link,
        showWhenUnlinked: false,
        offset: Offset(dx, dy),
        child: _SuggestionList(
          matches: _matches,
          highlighted: _highlighted,
          height: height,
          query: _query,
          canAdd: _canAdd,
          onSelected: _take,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return CompositedTransformTarget(
      link: _link,
      child: Focus(
        onKeyEvent: _onKey,
        canRequestFocus: false,
        skipTraversal: true,
        child: Stack(
          children: [
            // Behind the field, inset by exactly the padding the text sits in,
            // and laid out with the same style — so the pills land under their
            // words instead of near them. Repainted off the controller, which
            // is the only thing that moves them.
            //
            // This layer also carries the field's own fill, because the field
            // above it has been told not to paint one: an opaque `filled: true`
            // decoration — which is what this app's theme asks for — would
            // otherwise cover the pills completely.
            Positioned.fill(
              child: IgnorePointer(
                child: Container(
                  decoration: BoxDecoration(
                    color: _fillColor(context),
                    borderRadius: _fillRadius(context),
                  ),
                  padding: const EdgeInsets.symmetric(
                    horizontal: _padH + _borderWidth,
                    vertical: _padV + _borderWidth,
                  ),
                  child: AnimatedBuilder(
                    animation: Listenable.merge([widget.controller, _scroll]),
                    builder: (context, _) => CustomPaint(
                      painter: _MentionPillPainter(
                        text: widget.controller.text,
                        style: _effectiveStyle(),
                        keywords: widget.keywords,
                        highlightQuotes: widget.highlightQuotes,
                        textDirection: Directionality.of(context),
                        textScaler: MediaQuery.textScalerOf(context),
                        multiline: widget.multiline,
                        scrollOffset: _scroll.hasClients ? _scroll.offset : 0,
                        color: Theme.of(context)
                            .colorScheme
                            .primary
                            .withValues(alpha: 0.05),
                        borderColor: Theme.of(context)
                            .colorScheme
                            .primary
                            .withValues(alpha: 0.30),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            _buildField(),
          ],
        ),
      ),
    );
  }

  /// Answers a right-click on a selection by handing that text to the caller.
  ///
  /// Read at pointer-down rather than on the tap, because the field's own
  /// secondary-tap handling runs on the release and, on a field that does not
  /// yet have focus, collapses the selection to the caret before anyone can
  /// look at it. Focus is required for the same reason: an unfocused field
  /// paints no selection, so acting on one nobody can see would be a gesture
  /// with an invisible target.
  void _onPointerDown(PointerDownEvent event) {
    _quotedLastSecondaryTap = false;
    final quote = widget.onQuoteSelection;
    if (quote == null || event.buttons != kSecondaryButton) return;
    if (!_focusNode.hasFocus) return;

    final selection = widget.controller.selection;
    final text = widget.controller.text;
    if (!selection.isValid || selection.isCollapsed) return;
    if (selection.end > text.length) return;

    final excerpt = text.substring(selection.start, selection.end);
    if (excerpt.trim().isEmpty) return;
    _quotedLastSecondaryTap = true;
    quote(excerpt);
  }

  Widget _buildField() {
    return Listener(
      onPointerDown: _onPointerDown,
      child: _buildTextField(),
    );
  }

  Widget _buildTextField() {
    return TextField(
      key: _fieldKey,
      scrollController: _scroll,
      controller: widget.controller,
      focusNode: _focusNode,
      autofocus: widget.autofocus,
      minLines: widget.minLines,
      maxLines: widget.multiline ? null : 1,
      style: widget.textStyle,
      textInputAction: widget.textInputAction,
      onSubmitted: widget.onSubmitted,
      // Same rule as [GrowingTextField]: the page scrolls, the field does
      // not — a body has to be readable as one block, and a box with its
      // own scrollbar would also drag the popup away from its caret.
      scrollPhysics:
          widget.multiline ? const NeverScrollableScrollPhysics() : null,
      // The right-click that quoted a selection has already done its work, so
      // the toolbar that same click raises is dropped. Every other case —
      // right-clicking with nothing selected, most of all to paste — gets the
      // menu the platform would have shown.
      contextMenuBuilder: (context, editableTextState) =>
          _quotedLastSecondaryTap
              ? const SizedBox.shrink()
              : AdaptiveTextSelectionToolbar.editableText(
                  editableTextState: editableTextState,
                ),
      decoration: InputDecoration(
        hintText: widget.hintText,
        isDense: true,
        // The fill is painted by the layer underneath instead; left on, it
        // would sit between the pills and the words they belong to.
        filled: false,
        border: const OutlineInputBorder(),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: _padH,
          vertical: _padV,
        ),
      ),
    );
  }
}

/// Draws the rounded pill behind every recognised `@keyword`.
///
/// Painted rather than styled because Flutter's [TextStyle.background] is the
/// only way to put a color behind a run of editable text, and it paints a
/// square box per glyph run — no radius, and a visible seam between runs. A
/// layer underneath, laid out with the field's own style and width, gets one
/// rounded shape per token and leaves the text itself entirely alone.
class _MentionPillPainter extends CustomPainter {
  const _MentionPillPainter({
    required this.text,
    required this.style,
    required this.keywords,
    required this.highlightQuotes,
    required this.textDirection,
    required this.textScaler,
    required this.multiline,
    required this.scrollOffset,
    required this.color,
    required this.borderColor,
  });

  final String text;
  final TextStyle style;
  final List<String> keywords;
  final bool highlightQuotes;
  final TextDirection textDirection;
  final TextScaler textScaler;
  final bool multiline;
  final double scrollOffset;
  final Color color;

  /// A hairline around the fill. Alone, a wash this pale reads as a smudge on
  /// the card behind it; the outline is what makes it a token.
  final Color borderColor;

  @override
  void paint(Canvas canvas, Size size) {
    final ranges = [
      ...mentionRangesIn(text, keywords),
      if (highlightQuotes) ...quoteRangesIn(text),
    ];
    if (ranges.isEmpty) return;

    final painter = TextPainter(
      text: TextSpan(text: text, style: style),
      textDirection: textDirection,
      textScaler: textScaler,
    )..layout(maxWidth: multiline ? size.width : double.infinity);

    // A wrapping field never scrolls (the page does), so its offset is always
    // zero; a one-line field only ever scrolls sideways.
    final shift =
        multiline ? Offset(0, -scrollOffset) : Offset(-scrollOffset, 0);
    final fill = Paint()..color = color;
    final stroke = Paint()
      ..color = borderColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;

    for (final range in ranges) {
      final boxes = painter.getBoxesForSelection(
        TextSelection(baseOffset: range.start, extentOffset: range.end),
      );
      for (final box in boxes) {
        // One box per line: a mention that wraps gets a pill on each half
        // rather than one shape spanning the gap.
        final rect = Rect.fromLTRB(
          box.left - _pillPaddingX + _pillpadxl,
          box.top + _pillInsetY - _pillpadyb,
          box.right + _pillPaddingX + _pillpadxr,
          box.bottom - _pillInsetY - _pillpadyt,
        ).shift(shift);
        final pill = RRect.fromRectAndRadius(
          rect,
          const Radius.circular(_pillRadius),
        );
        canvas.drawRRect(pill, fill);
        canvas.drawRRect(pill.deflate(0.5), stroke);
      }
    }
    painter.dispose();
  }

  @override
  bool shouldRepaint(_MentionPillPainter old) =>
      old.text != text ||
      old.style != style ||
      old.highlightQuotes != highlightQuotes ||
      old.scrollOffset != scrollOffset ||
      old.color != color ||
      old.borderColor != borderColor ||
      old.textScaler != textScaler;
}

/// The floating list itself.
class _SuggestionList extends StatelessWidget {
  const _SuggestionList({
    required this.matches,
    required this.highlighted,
    required this.height,
    required this.query,
    required this.canAdd,
    required this.onSelected,
  });

  final List<String> matches;
  final int highlighted;
  final double height;

  /// What was typed after the `@`, shown on the "+" row so it is obvious what
  /// pressing it would add.
  final String query;

  final bool canAdd;

  /// Called with the row index — the keywords, then the "+" row after them.
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final rowCount = matches.length + (canAdd ? 1 : 0);

    return Material(
      elevation: 8,
      borderRadius: BorderRadius.circular(8),
      clipBehavior: Clip.antiAlias,
      color: theme.colorScheme.surfaceContainerHigh,
      child: SizedBox(
        height: height,
        // A menu this short reads as lagging under the app-wide wheel glide,
        // so its rows take the plain per-notch scroll instead.
        child: NoSmoothWheelScroll(
          child: ListView.builder(
            padding: const EdgeInsets.symmetric(vertical: 4),
            itemCount: rowCount,
            itemExtent: _menuItemHeight,
            itemBuilder: (context, index) {
              final selected = index == highlighted;
              // The "+" sits after the matches rather than pinned to the menu,
              // so Tab reaches it by carrying on down the list instead of being
              // a separate thing to aim at with the mouse.
              final isAddRow = index == matches.length;
              return _SuggestionRow(
                selected: selected,
                onTap: () => onSelected(index),
                child: isAddRow
                    ? _AddKeywordRow(query: query, selected: selected)
                    : _KeywordRow(keyword: matches[index], selected: selected),
              );
            },
          ),
        ),
      ),
    );
  }
}

/// The shared frame every menu row sits in: a rounded highlight and the hint
/// that Tab is what takes it.
class _SuggestionRow extends StatelessWidget {
  const _SuggestionRow({
    required this.selected,
    required this.onTap,
    required this.child,
  });

  final bool selected;
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return InkWell(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
        decoration: BoxDecoration(
          color: selected
              ? theme.colorScheme.primary.withValues(alpha: 0.12)
              : null,
          borderRadius: BorderRadius.circular(_pillRadius),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 8),
        alignment: AlignmentDirectional.centerStart,
        child: Row(
          children: [
            Flexible(child: child),
            const Spacer(),
            // Shown on the highlighted row only: the key that takes it is the
            // one thing about this list that is not obvious.
            if (selected)
              Text(
                'Tab',
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.outline,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// One offered keyword, wearing the pill it will wear once it is in the text —
/// so the list is a preview of the result rather than a differently-dressed
/// menu of words.
class _KeywordRow extends StatelessWidget {
  const _KeywordRow({required this.keyword, required this.selected});

  final String keyword;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: theme.colorScheme.primary.withValues(alpha: 0.16),
        border: Border.all(
          color: theme.colorScheme.primary.withValues(alpha: 0.40),
        ),
        borderRadius: BorderRadius.circular(_pillRadius),
      ),
      child: Text(
        '@$keyword',
        style: theme.textTheme.bodyMedium?.copyWith(
          fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
        ),
        overflow: TextOverflow.ellipsis,
      ),
    );
  }
}

/// The "+" row: adds a keyword the vocabulary does not have yet.
///
/// Deliberately dressed differently from the keywords above it — an outline
/// icon and plain text rather than a pill — because it is the one row that
/// does not insert what it shows.
class _AddKeywordRow extends StatelessWidget {
  const _AddKeywordRow({required this.query, required this.selected});

  final String query;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final token = asMentionToken(query);

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.add, size: 16, color: theme.colorScheme.primary),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            // Naming the keyword it would add is what stops this reading as a
            // second way to dismiss the menu.
            token == null
                ? l10n.emailLibraryAddKeyword
                : l10n.emailLibraryAddKeywordNamed(token),
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.primary,
              fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
