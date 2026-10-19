import 'package:gratovo_toolbox/data/models/skill_gem_setup.dart';
import 'package:gratovo_toolbox/data/models/skill_group.dart';
import 'package:gratovo_toolbox/data/models/skill_section.dart';

/// How the Skills page reads and writes skill decks.
///
/// **Local only**, same reasoning as `EmailLibraryRepository`: a skill is
/// edited by whoever is sharpening the team's Gemini prompts, on their own
/// machine, and the thing other machines actually need is not this database
/// but the `.md` file it exports — see `skill_markdown.dart`. The database
/// exists so a skill can be split into cards and autosaved card-by-card;
/// `data/gemini skills/*.md` stays the single file `actions.py` reads.
abstract class SkillsLibraryRepository {
  /// Whether there is somewhere to write at all — false on web and on a
  /// machine whose database could not be opened.
  bool get isAvailable;

  Future<List<SkillGroup>> listGroups();

  Future<SkillGroup> createGroup(String name);

  Future<void> renameGroup(String id, String name);

  Future<void> deleteGroup(String id);

  /// Marks [id] as exported at [at] — called right after a successful write
  /// of the combined markdown to disk.
  Future<void> markGroupExported(String id, DateTime at);

  /// Every card in [groupId], ordered by position.
  Future<List<SkillSection>> listSections(String groupId);

  /// Inserts or updates one card. `position` on a new card should be one past
  /// the current highest in its group.
  Future<void> saveSection(SkillSection section);

  Future<void> deleteSection(String id);

  /// Rewrites every card's position in [groupId] to match [orderedIds] —
  /// replace rather than diff, so a drag-reorder cannot leave two cards
  /// sharing a position.
  Future<void> reorderSections(String groupId, List<String> orderedIds);

  /// [groupId]'s Gemini gem setup, or null when that deck has none.
  ///
  /// Kept apart from the deck's cards on purpose — see [SkillGemSetup] — so
  /// nothing that lists sections (export, import, word count, references,
  /// preview) can ever come across it.
  Future<SkillGemSetup?> getGemSetup(String groupId);

  /// Inserts or replaces [setup]. Never touches the deck's own `updated_at`:
  /// a gem edit is not an edit of the skill, and must not make it look stale.
  Future<void> saveGemSetup(SkillGemSetup setup);
}
