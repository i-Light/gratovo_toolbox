import 'package:flutter/material.dart';

/// A small, dependency-free markdown renderer for the Skills page's live
/// preview.
///
/// Deliberately not a full CommonMark implementation — a skill card is a
/// prompt fragment, not an arbitrary document, so this covers exactly what
/// the existing hand-written skill files use (see `data/gemini skills/`):
/// headings, `---` rules, fenced code, bullet/numbered lists, blockquotes,
/// and inline bold/italic/code. Anything else renders as plain text rather
/// than failing, since the point of the preview is "what will this read
/// like", not strict validation.
class MarkdownPreview extends StatefulWidget {
  const MarkdownPreview({super.key, required this.source});

  final String source;

  @override
  State<MarkdownPreview> createState() => _MarkdownPreviewState();
}

/// Parses and builds only when the source or the theme changes. The parent
/// (the deck) rebuilds on every keystroke and on every pane-resize frame; a
/// section nobody touched hands back the identical widget, so Flutter skips
/// its whole subtree instead of re-parsing and re-laying-out the markdown.
class _MarkdownPreviewState extends State<MarkdownPreview> {
  Widget? _built;
  String? _builtSource;
  ThemeData? _builtTheme;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cached = _built;
    if (cached != null &&
        _builtSource == widget.source &&
        identical(_builtTheme, theme)) {
      return cached;
    }
    final built = _buildAll(theme);
    _built = built;
    _builtSource = widget.source;
    _builtTheme = theme;
    return built;
  }

  Widget _buildAll(ThemeData theme) {
    final blocks = _parseBlocks(widget.source);
    if (blocks.isEmpty) {
      return Text(
        '',
        style: theme.textTheme.bodyMedium?.copyWith(
          color: theme.colorScheme.outline,
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final block in blocks)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: _buildBlock(theme, block),
          ),
      ],
    );
  }

  Widget _buildBlock(ThemeData theme, _Block block) {
    switch (block.type) {
      case _BlockType.heading:
        final style = switch (block.level) {
          1 => theme.textTheme.headlineSmall,
          2 => theme.textTheme.titleLarge,
          3 => theme.textTheme.titleMedium,
          _ => theme.textTheme.titleSmall,
        };
        return Text.rich(_inline(theme, block.text, style));
      case _BlockType.rule:
        return const Divider(height: 24);
      case _BlockType.code:
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainerLowest.withAlpha(125),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            block.text,
            style: theme.textTheme.bodyMedium?.copyWith(
              fontFamily: 'monospace',
            ),
          ),
        );
      case _BlockType.quote:
        return Container(
          padding: const EdgeInsets.only(left: 12),
          decoration: BoxDecoration(
            border: Border(
              left: BorderSide(color: _quoteColor(theme), width: 3),
            ),
          ),
          child: Text.rich(
            // A zero-width space keeps an empty quote one line tall.
            _inline(
              theme,
              block.text.isEmpty ? '​' : block.text,
              theme.textTheme.bodyMedium,
            ),
          ),
        );
      case _BlockType.listItem:
        return Padding(
          padding: const EdgeInsets.only(left: 4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 22,
                child: Text(
                  block.marker ?? '•',
                  style: theme.textTheme.bodyMedium,
                ),
              ),
              Expanded(
                child: Text.rich(
                  _inline(theme, block.text, theme.textTheme.bodyMedium),
                ),
              ),
            ],
          ),
        );
      case _BlockType.table:
        return _buildTable(theme, block.rows);
      case _BlockType.paragraph:
        return Text.rich(
          _inline(theme, block.text, theme.textTheme.bodyMedium),
        );
    }
  }

  /// The quote bar's colour — also the table outline, and (faded) the code
  /// highlight, so the three read as one family.
  static Color _quoteColor(ThemeData theme) =>
      theme.colorScheme.onSurface.withAlpha(175);

  Widget _buildTable(ThemeData theme, List<List<String>> rows) {
    final columns = rows.fold<int>(0, (m, r) => r.length > m ? r.length : m);
    final border = BorderSide(color: _quoteColor(theme));
    return SizedBox(
      width: double.infinity,
      child: Table(
        // Flexible columns, so long cell text wraps instead of overflowing.
        defaultColumnWidth: const FlexColumnWidth(),
        border: TableBorder(
          top: border,
          bottom: border,
          left: border,
          right: border,
          horizontalInside: border,
          verticalInside: border,
        ),
        children: [
          for (var r = 0; r < rows.length; r++)
            TableRow(
              decoration: r == 0
                  ? BoxDecoration(color: _quoteColor(theme).withAlpha(40))
                  : null,
              children: [
                for (var c = 0; c < columns; c++)
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Text.rich(
                      _inline(
                        theme,
                        c < rows[r].length ? rows[r][c] : '',
                        r == 0
                            ? theme.textTheme.bodyMedium
                                ?.copyWith(fontWeight: FontWeight.bold)
                            : theme.textTheme.bodyMedium,
                      ),
                    ),
                  ),
              ],
            ),
        ],
      ),
    );
  }

  /// Bold (`**x**`), italic (`*x*` / `_x_`) and inline code (`` `x` ``) within
  /// one line of text.
  TextSpan _inline(ThemeData theme, String text, TextStyle? base) {
    final spans = <TextSpan>[];
    var last = 0;
    for (final match in _inlinePattern.allMatches(text)) {
      if (match.start > last) {
        spans.add(TextSpan(text: text.substring(last, match.start)));
      }
      if (match.group(1) != null) {
        spans.add(TextSpan(
          text: match.group(1),
          style: const TextStyle(fontWeight: FontWeight.bold),
        ));
      } else if (match.group(2) != null) {
        spans.add(TextSpan(
          text: match.group(2),
          style: const TextStyle(
            fontFamily: 'monospace',
            backgroundColor: Color.fromARGB(92, 160, 135, 80),
            color: Colors.white,
          ),
        ));
      } else {
        final emphasised = match.group(3) ?? match.group(4);
        spans.add(TextSpan(
          text: emphasised,
          style: const TextStyle(fontStyle: FontStyle.italic),
        ));
      }
      last = match.end;
    }
    if (last < text.length) spans.add(TextSpan(text: text.substring(last)));
    return TextSpan(style: _fadeBySize(theme, base), children: spans);
  }

  /// Smaller text gets slightly more transparent: full opacity from 24px
  /// down to 80% at 10px, so headings stay crisp and fine print recedes.
  ///
  static double calculateSteppedOpacity(
    double? fontSize, {
    double minOpacity = 0.8,
    double maxOpacity = 1.0,
    double minFontSize = 10.0,
    double maxFontSize = 24.0,
    double defaultFontSize = 14.0,
    double step = 0.05,
  }) {
    final size = fontSize ?? defaultFontSize;

    // 1. Normalize font size to a 0.0 - 1.0 progress ratio
    final progress =
        ((size - minFontSize) / (maxFontSize - minFontSize)).clamp(0.0, 1.0);

    // 2. Interpolate linearly between minOpacity and maxOpacity
    final rawOpacity = minOpacity + (maxOpacity - minOpacity) * progress;

    // 3. Snap to the nearest step increment
    final stepped = (rawOpacity / step).round() * step;

    // 4. Clamp to guard against floating-point precision drift
    return stepped.clamp(minOpacity, maxOpacity);
  }

  static TextStyle? _fadeBySize(ThemeData theme, TextStyle? base) {
    // old smooth opacity
    // final opacity = (0.8 + 0.2 * ((size - 10) / 14)).clamp(0.8, 1.0);
    if (base == null) return null;
    final size = base.fontSize ?? 14;
    final opacity = calculateSteppedOpacity(size,
        step: 0.15, minOpacity: 0.7, minFontSize: 10, maxFontSize: 20);
    final color = base.color ?? theme.colorScheme.onSurface;
    return base.copyWith(color: color.withValues(alpha: opacity));
  }

  List<_Block> _parseBlocks(String text) {
    final lines = text.split('\n');
    final blocks = <_Block>[];
    final paragraph = StringBuffer();
    var inCode = false;
    final codeBuffer = StringBuffer();

    final tableRows = <List<String>>[];

    void flushTable() {
      if (tableRows.isEmpty) return;
      // Row 2 is the `|---|---|` separator when present; it is not content.
      final rows = [...tableRows];
      if (rows.length > 1 && rows[1].every(_tableSeparatorCell.hasMatch)) {
        rows.removeAt(1);
      }
      blocks.add(_Block.table(rows));
      tableRows.clear();
    }

    List<String> splitRow(String line) {
      var t = line.trim();
      if (t.startsWith('|')) t = t.substring(1);
      if (t.endsWith('|')) t = t.substring(0, t.length - 1);
      return [for (final c in t.split('|')) c.trim()];
    }

    void flushParagraph() {
      final joined = paragraph.toString().trim();
      if (joined.isNotEmpty) blocks.add(_Block.paragraph(joined));
      paragraph.clear();
    }

    for (final rawLine in lines) {
      final line = rawLine.trimRight();

      if (line.trim().startsWith('```')) {
        if (inCode) {
          blocks.add(_Block.code(codeBuffer.toString().trimRight()));
          codeBuffer.clear();
          inCode = false;
        } else {
          flushParagraph();
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        codeBuffer.writeln(rawLine);
        continue;
      }

      final trimmed = line.trim();
      if (trimmed.startsWith('|')) {
        flushParagraph();
        tableRows.add(splitRow(trimmed));
        continue;
      }
      flushTable();
      if (trimmed.isEmpty) {
        flushParagraph();
        continue;
      }
      if (_rulePattern.hasMatch(trimmed)) {
        flushParagraph();
        blocks.add(_Block.rule());
        continue;
      }
      final heading = _headingPattern.firstMatch(trimmed);
      if (heading != null) {
        flushParagraph();
        blocks.add(_Block.heading(heading.group(2)!, heading.group(1)!.length));
        continue;
      }
      if (trimmed.startsWith('>')) {
        flushParagraph();
        // A bare ">" is an empty quote line: it still draws the bar.
        blocks.add(_Block.quote(trimmed.substring(1).trim()));
        continue;
      }
      final bullet = _bulletPattern.firstMatch(trimmed);
      if (bullet != null) {
        flushParagraph();
        blocks.add(_Block.listItem(bullet.group(1)!, '•'));
        continue;
      }
      final numbered = _numberedPattern.firstMatch(trimmed);
      if (numbered != null) {
        flushParagraph();
        blocks
            .add(_Block.listItem(numbered.group(2)!, '${numbered.group(1)}.'));
        continue;
      }

      if (paragraph.isNotEmpty) paragraph.write(' ');
      paragraph.write(trimmed);
    }
    if (inCode) blocks.add(_Block.code(codeBuffer.toString().trimRight()));
    flushParagraph();
    flushTable();
    return blocks;
  }
}

// Compiled once: the parser runs per line and the inline pass per block, and
// building a RegExp each time was a large share of every rebuild.
final _inlinePattern = RegExp(r'\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*|_(.+?)_');
final _tableSeparatorCell = RegExp(r'^:?-+:?$');
final _rulePattern = RegExp(r'^-{3,}$');
final _headingPattern = RegExp(r'^(#{1,4})\s+(.*)$');
final _bulletPattern = RegExp(r'^[-*]\s+(.*)$');
final _numberedPattern = RegExp(r'^(\d+)[.)]\s+(.*)$');

enum _BlockType { heading, rule, code, quote, listItem, table, paragraph }

class _Block {
  const _Block(this.type, this.text,
      {this.level = 0, this.marker, this.rows = const []});

  factory _Block.heading(String text, int level) =>
      _Block(_BlockType.heading, text, level: level);
  factory _Block.rule() => const _Block(_BlockType.rule, '');
  factory _Block.code(String text) => _Block(_BlockType.code, text);
  factory _Block.quote(String text) => _Block(_BlockType.quote, text);
  factory _Block.listItem(String text, String marker) =>
      _Block(_BlockType.listItem, text, marker: marker);
  factory _Block.table(List<List<String>> rows) =>
      _Block(_BlockType.table, '', rows: rows);
  factory _Block.paragraph(String text) => _Block(_BlockType.paragraph, text);

  final _BlockType type;
  final String text;
  final int level;
  final String? marker;
  final List<List<String>> rows;
}
