import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';
import 'package:gratovo_toolbox/data/models/skill_gem_setup.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_providers.dart';
import 'package:gratovo_toolbox/features/skills/application/skill_gem_setup_controller.dart';

/// Keeps the Gemini gems up to date with the gem cards of the skill decks,
/// without anyone pressing a button.
///
/// Runs only while a Gemini window is connected — it never opens a browser
/// on its own — and does one gem at a time: when the connection comes up it
/// goes through every deck, and after that a deck whose gem cards were
/// changed is pushed [quietPeriod] after the last change, so a burst of
/// typing becomes one update.
///
/// Per deck:
///  * gem cards changed here and the deck has a gem → the gem is updated;
///  * changed, no gem yet → the Settings field of the deck's role names one,
///    and that gem is updated, or a gem is created and its link written into
///    that field;
///  * never changed here (still the defaults) → nothing is pushed, since the
///    defaults would overwrite whatever the gem says; when the Settings field
///    names a gem, its fields are read into the cards instead.
///
/// A failure is logged and left for the next trigger — except a create that
/// did not say where the new gem is, which is not retried this session: a
/// retry would make a second gem.
final gemAutoSyncProvider = Provider<void>((ref) {
  final bridge = ref.watch(geminiBridgeProvider);
  if (!bridge.isAvailable) return;
  final sync = GemAutoSync(ref, bridge);
  ref.listen(gemSetupSavesProvider, (previous, next) {
    if (next != null) sync.changed(next.groupId);
  });
  ref.onDispose(sync.dispose);
  sync.start();
});

class GemAutoSync {
  GemAutoSync(
    this._ref,
    this.bridge, {
    this.quietPeriod = const Duration(seconds: 15),
  });

  final Ref _ref;
  final GeminiBridge bridge;

  /// How long after the last change to a deck's gem cards it is pushed.
  final Duration quietPeriod;

  final _timers = <String, Timer>{};
  final _queue = <String>{};
  final _unrecoverable = <String>{};
  StreamSubscription<GeminiBridgeState>? _states;
  Future<void>? _running;
  bool _disposed = false;

  void start() {
    _states = bridge.stateChanges.listen((state) {
      if (state.isConnected) unawaited(syncAll());
    });
    if (bridge.state.isConnected) unawaited(syncAll());
  }

  /// A deck's gem cards were saved: push them once they have been quiet for
  /// [quietPeriod].
  void changed(String groupId) {
    if (_disposed) return;
    _timers.remove(groupId)?.cancel();
    _timers[groupId] = Timer(quietPeriod, () {
      _timers.remove(groupId);
      _enqueue([groupId]);
    });
  }

  /// Every deck with a gem setup.
  Future<void> syncAll() async {
    if (_disposed) return;
    try {
      final groups =
          await _ref.read(skillsLibraryRepositoryProvider).listGroups();
      _enqueue([for (final group in groups) group.id]);
    } catch (error) {
      _log('could not list the skill decks: $error');
    }
    await _running;
  }

  void _enqueue(Iterable<String> groupIds) {
    _queue.addAll(groupIds);
    _running ??= _drain().whenComplete(() => _running = null);
  }

  Future<void> _drain() async {
    while (_queue.isNotEmpty && !_disposed) {
      if (!bridge.state.isConnected) return; // the next connection resumes
      final groupId = _queue.first;
      _queue.remove(groupId);
      try {
        await _syncOne(groupId);
      } catch (error) {
        _log('gem of deck $groupId not synced: $error');
      }
    }
  }

  Future<void> _syncOne(String groupId) async {
    if (_unrecoverable.contains(groupId)) return;
    final provider = skillGemSetupControllerProvider(groupId);
    final setup = await _ref.read(provider.future);
    if (setup == null || !setup.needsSync) return;
    final controller = _ref.read(provider.notifier);
    final settings = _ref.read(geminiBridgeSettingsProvider);
    final configured = _settingFor(settings, setup.role).trim();

    if (!setup.isEdited && !setup.hasUrl) {
      if (configured.isEmpty) return;
      final gem = await bridge.readGem(configured);
      await controller.adoptFromGemini(
        url: gem.url.isEmpty ? configured : gem.url,
        name: gem.name,
        description: gem.description,
        instructions: gem.instructions,
      );
      _log('read the ${setup.role.name} gem into its deck');
      return;
    }
    if (setup.name.trim().isEmpty) return; // a gem cannot be saved nameless

    if (setup.hasUrl || configured.isNotEmpty) {
      final url = setup.hasUrl ? setup.url.trim() : configured;
      final result = await bridge.updateGem(
        url,
        name: setup.name,
        description: setup.description,
        instructions: setup.instructions,
      );
      final saved = result.url.isEmpty ? url : result.url;
      await controller.markSynced(url: saved, pushedAt: setup.updatedAt);
      if (configured.isEmpty) await _writeSetting(setup.role, saved);
      _log('updated the ${setup.role.name} gem (${result.changed.join(', ')})');
      return;
    }

    final created = await bridge.createGem(
      name: setup.name,
      description: setup.description,
      instructions: setup.instructions,
    );
    if (created.url.isEmpty) {
      _unrecoverable.add(groupId);
      _log('created the ${setup.role.name} gem but Gemini did not say where; '
          'not creating it again');
      return;
    }
    await controller.markSynced(url: created.url, pushedAt: setup.updatedAt);
    await _writeSetting(setup.role, created.url);
    _log('created the ${setup.role.name} gem: ${created.url}');
  }

  static String _settingFor(GeminiBridgeSettings s, SkillGemRole role) =>
      switch (role) {
        SkillGemRole.keywords => s.keywordsGem,
      };

  Future<void> _writeSetting(SkillGemRole role, String url) =>
      _ref.read(geminiBridgeSettingsProvider.notifier).edit(
            (s) => switch (role) {
              SkillGemRole.keywords => s.copyWith(keywordsGem: url),
            },
          );

  void _log(String message) =>
      developer.log(message, name: 'gratovo.gemini.gems');

  void dispose() {
    _disposed = true;
    for (final timer in _timers.values) {
      timer.cancel();
    }
    _timers.clear();
    unawaited(_states?.cancel());
  }
}
