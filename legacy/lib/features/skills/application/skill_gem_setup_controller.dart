import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/skill_gem_setup.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_providers.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library_repository.dart';

/// One skill deck's Gemini gem setup — the two permanent cards at the top of
/// the deck.
///
/// State is `null` for a deck that has no gem: its name maps to no gem role
/// and nobody has set one up by hand (see [enable]). A deck whose name does map
/// gets its setup created, pre-filled, the first time this loads.
///
/// Debounced like `SkillGroupController`, and for the same reason: a text
/// field calls [edit] on every keystroke. Unlike it, nothing here ever exports
/// a file, bumps `skillsRevisionProvider` or touches the deck's `updated_at` —
/// the gem is not part of the skill, so editing it must not make the skill's
/// exported file look stale or change what the `@` menu offers.
class SkillGemSetupController extends AsyncNotifier<SkillGemSetup?> {
  SkillGemSetupController(this.groupId);

  final String groupId;

  Timer? _saveTimer;
  SkillGemSetup? _pending;

  static const _saveDebounce = Duration(milliseconds: 800);

  @override
  Future<SkillGemSetup?> build() async {
    ref.onDispose(() => _saveTimer?.cancel());
    final repo = ref.watch(skillsLibraryRepositoryProvider);
    final existing = await repo.getGemSetup(groupId);
    if (existing != null) return existing;

    final skillName = await _skillName(repo);
    final role = skillName == null ? null : gemRoleForSkillName(skillName);
    if (skillName == null || role == null) return null;
    return _createDefaults(repo, skillName, role);
  }

  /// Gives a deck the name-to-role table does not know a gem setup anyway —
  /// the way a hand-named deck opts in. Does nothing when it already has one.
  Future<void> enable(SkillGemRole role) async {
    if (state.value != null) return;
    final repo = ref.read(skillsLibraryRepositoryProvider);
    final skillName = await _skillName(repo);
    if (skillName == null) return;
    state = AsyncData(await _createDefaults(repo, skillName, role));
  }

  /// Changes which gem this deck configures — and with it which gem-URL
  /// setting a created gem's link is written to.
  Future<void> setRole(SkillGemRole role) async {
    final current = state.value;
    if (current == null || current.role == role) return;
    await _persist(current.copyWith(role: role, updatedAt: DateTime.now()));
  }

  /// Call on every keystroke in a card's fields. Updates state at once and
  /// arms the debounced save.
  void edit({String? name, String? description, String? instructions}) {
    final current = state.value;
    if (current == null) return;
    final updated = current.copyWith(
      name: name,
      description: description,
      instructions: instructions,
      updatedAt: DateTime.now(),
    );
    state = AsyncData(updated);
    _pending = updated;
    _saveTimer?.cancel();
    _saveTimer = Timer(_saveDebounce, () => unawaited(flush()));
  }

  /// Drops every edit since [snapshot] was taken, saved or not.
  Future<void> restore(SkillGemSetup? snapshot) async {
    if (snapshot == null) return;
    await _persist(snapshot);
  }

  /// Saves a pending edit now — on leaving the deck, and before anything that
  /// is about to read the fields.
  Future<void> flush() async {
    _saveTimer?.cancel();
    final pending = _pending;
    if (pending == null) return;
    _pending = null;
    await ref.read(skillsLibraryRepositoryProvider).saveGemSetup(pending);
    _announce();
  }

  /// Records that the fields as they stood at [pushedAt] (their `updatedAt`)
  /// are now what the gem at [url] says. An edit made while the push ran has a
  /// later `updatedAt`, so the setup stays out of date and is pushed again.
  Future<void> markSynced({
    required String url,
    required DateTime pushedAt,
  }) async {
    final current = state.value;
    if (current == null) return;
    await _persist(
      current.copyWith(url: url, syncedAt: pushedAt),
      announce: false,
    );
  }

  /// Takes the gem at [url] as this deck's gem, with the fields Gemini has for
  /// it — for a setup nobody has edited here, whose defaults must not be
  /// pushed over a gem someone already wrote.
  Future<void> adoptFromGemini({
    required String url,
    required String name,
    required String description,
    required String instructions,
  }) async {
    final current = state.value;
    if (current == null) return;
    final now = DateTime.now();
    await _persist(
      current.copyWith(
        url: url,
        name: name,
        description: description,
        instructions: instructions,
        syncedAt: now,
        updatedAt: now,
      ),
      announce: false,
    );
  }

  /// Saves [updated] immediately, folding in any edit still waiting on its
  /// debounce — [updated] was built from the latest state, so it already
  /// carries it.
  Future<void> _persist(SkillGemSetup updated, {bool announce = true}) async {
    _saveTimer?.cancel();
    _pending = null;
    state = AsyncData(updated);
    await ref.read(skillsLibraryRepositoryProvider).saveGemSetup(updated);
    if (announce) _announce();
  }

  void _announce() => ref.read(gemSetupSavesProvider.notifier).saved(groupId);

  Future<String?> _skillName(SkillsLibraryRepository repo) async {
    for (final group in await repo.listGroups()) {
      if (group.id == groupId) return group.name;
    }
    return null;
  }

  Future<SkillGemSetup> _createDefaults(
    SkillsLibraryRepository repo,
    String skillName,
    SkillGemRole role,
  ) async {
    final created = SkillGemSetup.defaultsFor(
      groupId: groupId,
      skillName: skillName,
      role: role,
      now: DateTime.now(),
    );
    await repo.saveGemSetup(created);
    return created;
  }
}

/// The last gem setup a person's change was saved to — `GemAutoSync` listens
/// here to push it to Gemini. Syncing's own saves are not announced.
class GemSetupSaves extends Notifier<({String groupId, int serial})?> {
  @override
  ({String groupId, int serial})? build() => null;

  void saved(String groupId) =>
      state = (groupId: groupId, serial: (state?.serial ?? 0) + 1);
}

final gemSetupSavesProvider =
    NotifierProvider<GemSetupSaves, ({String groupId, int serial})?>(
  GemSetupSaves.new,
);

final skillGemSetupControllerProvider = AsyncNotifierProvider.family<
    SkillGemSetupController,
    SkillGemSetup?,
    String>(SkillGemSetupController.new);
