import 'package:gratovo_toolbox/data/models/skill_group.dart';
import 'package:gratovo_toolbox/data/models/skill_section.dart';

final _nonSlugChars = RegExp('[^a-z0-9_]+');
final _edgeUnderscores = RegExp(r'^_+|_+$');
final _wordChar = RegExp('[A-Za-z0-9_]');

/// Turns a slug-able string into the `[A-Za-z0-9_]+` shape
/// `MentionTextField`'s trigger regex requires (see
/// `mention_text_field.dart`) — spaces and punctuation become underscores,
/// case is folded so "Step 2" and "step 2" reach the same card.
///
/// Never empty for non-empty input: a string of only punctuation still needs
/// *some* token, so it falls back to `section`.
String slugifyForMention(String raw) {
  final token = raw
      .trim()
      .toLowerCase()
      .replaceAll(_nonSlugChars, '_')
      .replaceAll(_edgeUnderscores, '');
  return token.isEmpty ? 'section' : token;
}

/// The `@` token a reference to [section] resolves to: `group__heading`,
/// double-underscored so the two halves cannot be confused with an
/// underscore that was already part of either name.
String mentionTokenFor(SkillGroup group, SkillSection section) =>
    '${slugifyForMention(group.name)}__${slugifyForMention(section.heading)}';

/// One card, addressable by its `@` token — what the mention menu offers and
/// what [resolveSkillReferences] looks up.
class SkillReferenceTarget {
  const SkillReferenceTarget({
    required this.token,
    required this.group,
    required this.section,
  });

  final String token;
  final SkillGroup group;
  final SkillSection section;
}

/// Every card across every group, keyed by its mention token — the source
/// both the `@` mention menu and reference resolution look up against.
///
/// Takes the whole library rather than one group because a reference is not
/// scoped to the group it is written in: pointing from the drafter skill at a
/// rule stated once in the QA skill is exactly the point.
Map<String, SkillReferenceTarget> buildReferenceIndex(
  Map<SkillGroup, List<SkillSection>> library,
) {
  final index = <String, SkillReferenceTarget>{};
  for (final entry in library.entries) {
    for (final section in entry.value) {
      final token = mentionTokenFor(entry.key, section);
      // First writer wins on a collision (two cards slugifying to the same
      // token) rather than the last, so a reference already typed against
      // the first one never silently repoints.
      index.putIfAbsent(
        token,
        () => SkillReferenceTarget(
          token: token,
          group: entry.key,
          section: section,
        ),
      );
    }
  }
  return index;
}

/// The `@` tokens a card should be offered in its own mention menu: every
/// card in [index] except [ownToken].
///
/// A card cannot be handed its own token as a suggestion — see
/// `resolveSkillReferences`'s doc comment for why a self-reference is a case
/// worth designing out rather than merely detecting. Someone can still type
/// it by hand; this only keeps the menu from offering it.
List<String> mentionSuggestionsExcluding(
  Map<String, SkillReferenceTarget> index,
  String ownToken,
) {
  final tokens = [
    for (final token in index.keys)
      if (token != ownToken) token
  ];
  tokens.sort();
  return tokens;
}

bool _isWordChar(String ch) => _wordChar.hasMatch(ch);

/// Matches `@token` (group 1 null) or `@@token` (group 1 present) in one
/// pass, so a double mention's two `@`s are never mistaken for two separate
/// single mentions.
final _mentionPattern = RegExp('@(@)?([A-Za-z0-9_]+)');

/// Resolves every `@`/`@@` reference in [body] against [index]:
///
/// - `@token` is a **plain reference** — like a normal cross-reference in a
///   hand-written `.md` file, it resolves to the target card's heading and
///   nothing more. It does not pull that card's content in.
/// - `@@token` **transcludes** — the referenced card's own (recursively
///   resolved) body is inlined in full. This is the one case that can
///   recurse, so [visited] guards a cycle: a chain of `@@` references that
///   loops back on itself renders as a marker instead of recursing forever.
///
///   A card cannot reference *itself* this way through the mention menu — see
///   [mentionSuggestionsExcluding] — so in normal use this marker should
///   never actually appear; it exists as a backstop for a hand-typed token or
///   an indirect cycle across several cards, not a case the UI is expected to
///   produce.
///
/// An unknown token (typo, or the target card was deleted) is left as literal
/// text rather than silently dropped, so a stale reference stays visible to
/// whoever reads the exported file.
String resolveSkillReferences(
  String body,
  Map<String, SkillReferenceTarget> index, {
  Set<String> visited = const {},
}) {
  return body.replaceAllMapped(_mentionPattern, (match) {
    final start = match.start;
    // Same boundary rule as `MentionTextField`: `sam@brand` is an address,
    // not a reference.
    if (start > 0 && _isWordChar(body[start - 1])) return match.group(0)!;

    final isTransclude = match.group(1) != null;
    final token = match.group(2)!;
    final target = index[token];
    if (target == null) return match.group(0)!;

    if (!isTransclude) return target.section.heading;

    if (visited.contains(token)) {
      return '[circular reference: ${target.section.heading}]';
    }
    return resolveSkillReferences(
      target.section.body,
      index,
      visited: {...visited, token},
    );
  });
}

/// The combined markdown for [group] — `# name`, then one `# heading`
/// section per exportable card in order (a card is a top-level section; its
/// own `##`/`###` subsections live in its body), `---`-separated the same way the
/// hand-written skill files are.
///
/// Two kinds of card never reach the file Gemini reads:
/// - [SkillSection.isUnnamed] — a card with no heading yet is still being
///   written, not ready to be prompted from.
/// - [SkillSection.teamOnly] — written for whoever else opens this deck, not
///   for the model.
String buildSkillMarkdown(
  SkillGroup group,
  List<SkillSection> sections,
  Map<String, SkillReferenceTarget> index,
) {
  final buffer = StringBuffer('# ${group.name}\n');
  for (final section in sections) {
    if (section.isUnnamed || section.teamOnly) continue;
    final resolved = resolveSkillReferences(section.body, index).trim();
    buffer
      ..write('\n---\n\n# ${section.heading}\n\n')
      ..write(resolved)
      ..write('\n');
  }
  return buffer.toString();
}

/// The file name a group exports to, inside `data/gemini skills/`.
String skillMarkdownFileName(SkillGroup group) => '${group.name}.md';

/// One card recovered from an existing hand-written skill file — what
/// [parseSkillMarkdownSections] turns a `.md` file into, and what
/// `skill_import.dart` turns into rows.
class ParsedSkillSection {
  const ParsedSkillSection(this.heading, this.body);
  final String heading;
  final String body;
}

/// Splits an existing skill file's markdown into cards, the inverse of
/// [buildSkillMarkdown] — what lets `data/gemini skills/*.md` (hand-written
/// long before this page existed) be imported as an editable deck instead of
/// only ever being overwritten by an export.
///
/// A card is one **top-level** section, with everything beneath it: when the
/// file has `# ` headings (after its own title) each of those opens a card and
/// its `##`/`###` subsections stay inside that card's body — "PART 0" keeps
/// 0.1 through 0.9 rather than shattering into nine cards and leaving the
/// `# PART 0` line stranded at the end of the previous card. A file with no
/// `# ` headings falls back to splitting on `## `.
///
/// The file's own `# Title` line is dropped when it is [title] (a group's name
/// already carries it; with no [title] the first `# ` before any other content
/// is assumed to be it), and the bare `---` separators the export writes
/// between cards are trimmed off card edges — a rule in the middle of a body is
/// content and stays. Headings inside fenced code are never headings. Anything
/// before the first card — a hand-written file's lead-in prose — becomes one
/// card named "Intro" rather than being discarded.
List<ParsedSkillSection> parseSkillMarkdownSections(
  String content, {
  String? title,
}) {
  final lines = content.replaceAll('\r\n', '\n').split('\n');
  final headingPattern = RegExp(r'^(#{1,6})\s+(.*?)\s*#*\s*$');

  // Pass 1: locate headings outside fenced code.
  final levels = List<int>.filled(lines.length, 0);
  final texts = List<String>.filled(lines.length, '');
  String? fence;
  for (var i = 0; i < lines.length; i++) {
    final t = lines[i].trim();
    final fenceMatch = RegExp('^(```+|~~~+)').firstMatch(t);
    if (fenceMatch != null) {
      final marker = fenceMatch.group(1)![0];
      if (fence == null) {
        fence = marker;
      } else if (fence == marker) {
        fence = null;
      }
      continue;
    }
    if (fence != null) continue;
    final h = headingPattern.firstMatch(t);
    if (h != null) {
      levels[i] = h.group(1)!.length;
      texts[i] = h.group(2)!.trim();
    }
  }

  // The file's own title: the first heading, if it is a `# ` with nothing but
  // blank lines before it and it is (or, with no [title] given, could be) the
  // title rather than a card.
  final skip = <int>{};
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim().isEmpty) continue;
    if (levels[i] == 1 &&
        (title == null ||
            texts[i].toLowerCase() == title.trim().toLowerCase())) {
      skip.add(i);
    }
    break;
  }

  final splitLevel = [
    for (var i = 0; i < lines.length; i++)
      if (levels[i] == 1 && !skip.contains(i)) i,
  ].isNotEmpty
      ? 1
      : 2;

  final sections = <ParsedSkillSection>[];
  String? heading;
  var body = <String>[];

  String cleaned() {
    var start = 0;
    var end = body.length;
    bool isEdge(int i) => body[i].trim().isEmpty || body[i].trim() == '---';
    while (start < end && isEdge(start)) {
      start++;
    }
    while (end > start && isEdge(end - 1)) {
      end--;
    }
    return body.sublist(start, end).join('\n').trimRight();
  }

  void flush() {
    var text = cleaned();
    if (heading != null) {
      sections.add(ParsedSkillSection(heading, text));
    } else if (text.isNotEmpty) {
      // A lead-in that opens with its own "Intro" heading would otherwise
      // name itself twice.
      final first = text.split('\n').first;
      final h = headingPattern.firstMatch(first.trim());
      if (h != null && h.group(2)!.trim().toLowerCase() == 'intro') {
        text = text.substring(first.length).trim();
      }
      sections.add(ParsedSkillSection('Intro', text));
    }
    body = <String>[];
  }

  for (var i = 0; i < lines.length; i++) {
    if (skip.contains(i)) continue;
    if (levels[i] == splitLevel) {
      flush();
      heading = texts[i];
      continue;
    }
    body.add(lines[i]);
  }
  flush();
  return sections;
}

/// Total word count across every card in [sections] — the one figure the
/// group's header shows, summed rather than per-card per the owner's
/// instruction, so a skill's overall weight against a model's prompt limit is
/// visible from anywhere in the deck. Includes team-only and unnamed cards —
/// this is "how much is in this deck", not "how much will be exported".
int totalWordCount(List<SkillSection> sections) =>
    sections.fold(0, (sum, section) => sum + section.wordCount);
