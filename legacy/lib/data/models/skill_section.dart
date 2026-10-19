/// One card in a [SkillGroup]'s deck — becomes one `##` section of the
/// exported markdown, in [position] order, joined by `---` the same way the
/// hand-written skill files are.
class SkillSection {
  const SkillSection({
    required this.id,
    required this.groupId,
    required this.heading,
    required this.body,
    required this.position,
    required this.createdAt,
    required this.updatedAt,
    this.teamOnly = false,
  });

  final String id;
  final String groupId;

  /// Rendered as the section's `## heading` and, slugified, what a `@`
  /// reference to this card resolves to — see `skill_markdown.dart`. Required:
  /// a nameless card has nothing for a reference or the export to call it, so
  /// the editor refuses to collapse or export a card until this is filled in.
  final String heading;

  /// May contain `@token` (a plain reference, left as a pointer) or
  /// `@@token` (transcluded in full) — see `skill_markdown.dart`.
  final String body;

  /// 0-based order within the group. Sparse gaps are fine — reordering
  /// rewrites every affected row's position rather than shuffling by one.
  final int position;

  final DateTime createdAt;
  final DateTime updatedAt;

  /// True for a card meant for the team reading the deck, not for Gemini —
  /// excluded from the exported `.md` entirely, kept visible in the app at
  /// reduced opacity so its presence (and that it will NOT be sent) stays
  /// obvious.
  final bool teamOnly;

  /// A rough word count for this card alone, used to sum the group's total.
  /// Splits on whitespace rather than counting tokens an LLM would actually
  /// use — good enough for "is this skill getting too heavy", not a billing
  /// figure.
  int get wordCount {
    final trimmed = body.trim();
    return trimmed.isEmpty ? 0 : trimmed.split(_whitespace).length;
  }

  static final _whitespace = RegExp(r'\s+');

  /// A card with nothing typed into its name yet — never exported, and the
  /// deck refuses to let it collapse while this is true.
  bool get isUnnamed => heading.trim().isEmpty;

  SkillSection copyWith({
    String? heading,
    String? body,
    int? position,
    DateTime? updatedAt,
    bool? teamOnly,
  }) {
    return SkillSection(
      id: id,
      groupId: groupId,
      heading: heading ?? this.heading,
      body: body ?? this.body,
      position: position ?? this.position,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      teamOnly: teamOnly ?? this.teamOnly,
    );
  }
}
