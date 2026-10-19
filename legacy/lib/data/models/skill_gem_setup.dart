/// Which of the app's Gemini gems a skill deck configures — one per gem URL
/// field in the Gemini bridge settings (`keywordsGem`).
///
/// The drafter and QA gems are gone with the old drafting path (decision
/// old-files): drafting runs in the Comms queue on the course-built skill. A
/// stored `drafter` or `qa` now reads back as no role, see [fromName].
enum SkillGemRole {
  keywords;

  /// The stored form — also what [fromName] reads back.
  String get storageName => name;

  static SkillGemRole? fromName(String? raw) {
    for (final role in values) {
      if (role.name == raw) return role;
    }
    return null;
  }
}

/// The decks that ship with the app, and the gem each one configures. Keyed by
/// the file name `pipeline/gemini_bridge/actions.py` reads (`keyword generator
/// skill.md`), which is also what an imported deck is called — see
/// `importSkillMarkdownFile`.
///
/// Deliberately a short explicit table rather than a fuzzy match: a deck named
/// "keyword notes" must not quietly turn into the keywords gem. A deck this
/// table does not know can still be given a role by hand (see
/// `SkillGemSetupController.enable`).
const _gemRoleBySkillName = <String, SkillGemRole>{
  'keyword generator skill': SkillGemRole.keywords,
};

/// The gem role [skillName] maps to, or null when the deck has none. Case and
/// runs of whitespace do not matter.
SkillGemRole? gemRoleForSkillName(String skillName) {
  final normalised =
      skillName.trim().toLowerCase().replaceAll(RegExp(r'\s+'), ' ');
  return _gemRoleBySkillName[normalised];
}

/// A skill deck's gem setup: what to create the Gemini gem with, and which gem
/// it became.
///
/// **Not part of the skill.** This lives in its own table and its own model on
/// purpose — a [SkillSection] is what the export, the import, the word count,
/// the `@` reference index and the preview all read, so keeping the gem's
/// fields out of that type is what keeps them out of all of those, without a
/// filter anyone could forget to apply. Nothing here reaches the exported
/// markdown, and so nothing here reaches a prompt the daemon builds.
class SkillGemSetup {
  const SkillGemSetup({
    required this.groupId,
    required this.role,
    required this.name,
    required this.description,
    required this.instructions,
    required this.createdAt,
    required this.updatedAt,
    this.url = '',
    this.syncedAt,
  });

  /// The deck this belongs to — one setup per deck.
  final String groupId;

  final SkillGemRole role;

  /// The gem's name in Gemini.
  final String name;

  final String description;

  /// The gem's instructions in Gemini — the gem's own system prompt, written
  /// and kept here, separate from the skill document.
  final String instructions;

  /// The gem's link once it exists in Gemini (`https://gemini.google.com/gem/…`),
  /// or empty while it has only been drafted here.
  final String url;

  /// When these fields were last created in, pushed to or read from Gemini.
  final DateTime? syncedAt;

  final DateTime createdAt;
  final DateTime updatedAt;

  bool get hasUrl => url.trim().isNotEmpty;

  /// Changed here since it was last created in, pushed to or read from Gemini.
  bool get needsSync {
    final synced = syncedAt;
    return synced == null || updatedAt.isAfter(synced);
  }

  /// Someone has changed it since it was made from the defaults — the line
  /// between a setup worth pushing to Gemini on its own and one that is only
  /// a placeholder.
  bool get isEdited => updatedAt.isAfter(createdAt);

  /// True when name and description and instructions are all blank — nothing
  /// worth asking before a "Read from Gemini" overwrites it.
  bool get isBlank =>
      name.trim().isEmpty &&
      description.trim().isEmpty &&
      instructions.trim().isEmpty;

  /// Whether the given three fields equal this setup's, ignoring surrounding
  /// whitespace — what decides if a read from Gemini would change anything the
  /// person has here.
  bool sameContentAs({
    required String name,
    required String description,
    required String instructions,
  }) =>
      this.name.trim() == name.trim() &&
      this.description.trim() == description.trim() &&
      this.instructions.trim() == instructions.trim();

  SkillGemSetup copyWith({
    SkillGemRole? role,
    String? name,
    String? description,
    String? instructions,
    String? url,
    DateTime? syncedAt,
    DateTime? updatedAt,
  }) {
    return SkillGemSetup(
      groupId: groupId,
      role: role ?? this.role,
      name: name ?? this.name,
      description: description ?? this.description,
      instructions: instructions ?? this.instructions,
      url: url ?? this.url,
      syncedAt: syncedAt ?? this.syncedAt,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  /// A fresh setup for the deck called [skillName]: the gem is named after the
  /// skill, and the description and instructions start as one generic line
  /// that says what the role is for — something true to edit rather than a
  /// blank field, never a copy of the skill itself.
  factory SkillGemSetup.defaultsFor({
    required String groupId,
    required String skillName,
    required SkillGemRole role,
    required DateTime now,
  }) {
    return SkillGemSetup(
      groupId: groupId,
      role: role,
      name: defaultGemName(skillName),
      description: _defaultDescription[role]!,
      instructions: _defaultInstructions[role]!,
      createdAt: now,
      updatedAt: now,
    );
  }
}

/// The skill's name as a gem name: "keyword generator skill" becomes
/// "Keyword generator". A trailing "skill" is noise on a gem; a name without
/// one is kept as it is.
String defaultGemName(String skillName) {
  var name = skillName.trim().replaceAll(RegExp(r'\s+'), ' ');
  name = name.replaceFirst(RegExp(r'\s+skill$', caseSensitive: false), '');
  if (name.isEmpty) return skillName.trim();
  return name[0].toUpperCase() + name.substring(1);
}

const _defaultDescription = <SkillGemRole, String>{
  SkillGemRole.keywords:
      'Writes long-tail YouTube search phrases for discovering smaller channels '
          'about a topic.',
};

const _defaultInstructions = <SkillGemRole, String>{
  SkillGemRole.keywords:
      'You write long-tail YouTube search phrases for finding channels about '
          'a topic. Prefer specific, niche phrases over broad ones, and never '
          'repeat a phrase you are told to avoid.',
};
