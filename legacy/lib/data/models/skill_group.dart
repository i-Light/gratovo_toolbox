/// One skill: a named deck of [SkillSection]s that combine into a single
/// `.md` file under `data/gemini skills/`, the prompt files
/// `pipeline/gemini_bridge/actions.py` prepends to a Gemini call when no Gem
/// URL is configured (see `CONTEXT.md`).
///
/// Splitting a skill into cards is an editing convenience only — the file on
/// disk is still one flat markdown document once exported, because that is
/// the only shape the Python side reads.
class SkillGroup {
  const SkillGroup({
    required this.id,
    required this.name,
    required this.createdAt,
    required this.updatedAt,
    this.exportedAt,
  });

  final String id;

  /// Also the exported file's name: `data/gemini skills/<name>.md`. Kept as
  /// typed rather than slugified, since the Python side matches on the
  /// literal file name already in use (`keyword generator skill.md`, …).
  final String name;

  final DateTime createdAt;
  final DateTime updatedAt;

  /// When the combined markdown was last written to disk. Null means this
  /// group has never been exported — its sections exist only in the
  /// database, and `actions.py` cannot see them yet.
  final DateTime? exportedAt;

  SkillGroup copyWith({
    String? name,
    DateTime? updatedAt,
    DateTime? exportedAt,
  }) {
    return SkillGroup(
      id: id,
      name: name ?? this.name,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      exportedAt: exportedAt ?? this.exportedAt,
    );
  }
}
