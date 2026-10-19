import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/data/models/skill_section.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_providers.dart';
import 'package:gratovo_toolbox/features/skills/application/skill_export.dart';
import 'package:gratovo_toolbox/features/skills/application/skills_revision.dart';

/// One skill's deck of cards: loads them, and debounces edits to any one card
/// into a save-then-export cycle.
///
/// Debounced ~1.2s per card with a [flush] on blur/navigation — same shape as
/// `ScratchpadBoardController`, for the same reason: every keystroke would
/// otherwise mean a database write and a full markdown rebuild + file write,
/// and a card is typed into far more often than either is worth doing.
/// Multiple cards can be mid-edit at once, so pending edits and their timers
/// are tracked per card id rather than as a single slot.
class SkillGroupController extends AsyncNotifier<List<SkillSection>> {
  SkillGroupController(this.groupId);

  final String groupId;

  final Map<String, Timer> _saveTimers = {};
  final Map<String, SkillSection> _pending = {};

  static const _saveDebounce = Duration(milliseconds: 1200);

  @override
  Future<List<SkillSection>> build() async {
    ref.onDispose(() {
      for (final timer in _saveTimers.values) {
        timer.cancel();
      }
    });
    final repo = ref.watch(skillsLibraryRepositoryProvider);
    return repo.listSections(groupId);
  }

  /// Adds a new, unnamed card at the end of the deck and returns its id, so
  /// the deck can expand it and focus its heading field immediately — an
  /// unnamed card is never exported (see `SkillSection.isUnnamed`), so there
  /// is nothing to export yet and no debounce needed here.
  Future<String> addSection() async {
    final current = state.value ?? const [];
    final now = DateTime.now();
    final section = SkillSection(
      id: localUuid(),
      groupId: groupId,
      heading: '',
      body: '',
      position: current.length,
      createdAt: now,
      updatedAt: now,
    );
    final repo = ref.read(skillsLibraryRepositoryProvider);
    await repo.saveSection(section);
    state = AsyncData([...current, section]);
    ref.read(skillsRevisionProvider.notifier).bump();
    return section.id;
  }

  Future<void> deleteSection(String id) async {
    _saveTimers.remove(id)?.cancel();
    _pending.remove(id);
    final repo = ref.read(skillsLibraryRepositoryProvider);
    await repo.deleteSection(id);
    final current = state.value ?? const [];
    state = AsyncData([
      for (final s in current)
        if (s.id != id) s
    ]);
    ref.read(skillsRevisionProvider.notifier).bump();
    await exportSkillGroup(ref, groupId);
  }

  /// Call on every keystroke in a card's heading or body, and on toggling its
  /// team-only tag. Updates local state immediately (so every open card and
  /// the group's word-count total react live) and arms that card's debounced
  /// save — export waits for the debounce too, since a heading edit that
  /// just made the card named/unnamed changes what belongs in the file.
  void edit(String id, {String? heading, String? body, bool? teamOnly}) {
    final current = state.value ?? const [];
    final index = current.indexWhere((s) => s.id == id);
    if (index == -1) return;
    final updated = current[index].copyWith(
      heading: heading,
      body: body,
      teamOnly: teamOnly,
      updatedAt: DateTime.now(),
    );
    state = AsyncData([
      for (var i = 0; i < current.length; i++)
        if (i == index) updated else current[i],
    ]);
    _pending[id] = updated;
    _saveTimers[id]?.cancel();
    _saveTimers[id] = Timer(_saveDebounce, () => unawaited(_flushOne(id)));
  }

  /// Flips a card's team-only tag and saves immediately — a discrete toggle,
  /// not a keystroke, so unlike [edit] this does not wait for the debounce.
  Future<void> setTeamOnly(String id, bool teamOnly) async {
    final current = state.value ?? const [];
    final index = current.indexWhere((s) => s.id == id);
    if (index == -1) return;
    _saveTimers.remove(id)?.cancel();
    _pending.remove(id);
    final updated = current[index].copyWith(
      teamOnly: teamOnly,
      updatedAt: DateTime.now(),
    );
    state = AsyncData([
      for (var i = 0; i < current.length; i++)
        if (i == index) updated else current[i],
    ]);
    final repo = ref.read(skillsLibraryRepositoryProvider);
    await repo.saveSection(updated);
    ref.read(skillsRevisionProvider.notifier).bump();
    await exportSkillGroup(ref, groupId);
  }

  /// Rewrites every card's position to match [orderedIds] — a drag-reorder,
  /// applied immediately rather than debounced.
  Future<void> reorder(List<String> orderedIds) async {
    final current = state.value ?? const [];
    final byId = {for (final s in current) s.id: s};
    final reordered = [
      for (var i = 0; i < orderedIds.length; i++)
        if (byId[orderedIds[i]] != null)
          byId[orderedIds[i]]!.copyWith(position: i),
    ];
    state = AsyncData(reordered);
    final repo = ref.read(skillsLibraryRepositoryProvider);
    await repo.reorderSections(groupId, orderedIds);
    ref.read(skillsRevisionProvider.notifier).bump();
    await exportSkillGroup(ref, groupId);
  }

  /// Puts the deck back exactly as [snapshot] has it, dropping every edit made
  /// since — pending or already saved — and re-exports the file.
  Future<void> restore(List<SkillSection> snapshot) async {
    for (final timer in _saveTimers.values) {
      timer.cancel();
    }
    _saveTimers.clear();
    _pending.clear();
    final repo = ref.read(skillsLibraryRepositoryProvider);
    final keep = {for (final s in snapshot) s.id};
    for (final s in state.value ?? const <SkillSection>[]) {
      if (!keep.contains(s.id)) await repo.deleteSection(s.id);
    }
    for (final s in snapshot) {
      await repo.saveSection(s);
    }
    await repo.reorderSections(groupId, [for (final s in snapshot) s.id]);
    state = AsyncData(snapshot);
    ref.read(skillsRevisionProvider.notifier).bump();
    await exportSkillGroup(ref, groupId);
  }

  /// Sends every pending card's edit now — on blur, or when leaving the
  /// group's deck.
  Future<void> flush() async {
    final ids = _pending.keys.toList();
    for (final id in ids) {
      await _flushOne(id);
    }
  }

  Future<void> _flushOne(String id) async {
    _saveTimers.remove(id)?.cancel();
    final section = _pending.remove(id);
    if (section == null) return;
    final repo = ref.read(skillsLibraryRepositoryProvider);
    await repo.saveSection(section);
    ref.read(skillsRevisionProvider.notifier).bump();
    await exportSkillGroup(ref, groupId);
  }
}

final skillGroupControllerProvider = AsyncNotifierProvider.family<
    SkillGroupController, List<SkillSection>, String>(SkillGroupController.new);
