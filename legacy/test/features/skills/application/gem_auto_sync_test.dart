import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';
import 'package:gratovo_toolbox/data/models/skill_gem_setup.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_providers.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/sqlite_skills_library_repository.dart';
import 'package:gratovo_toolbox/features/skills/application/gem_auto_sync.dart';
import 'package:gratovo_toolbox/features/skills/application/skill_gem_setup_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../data/repositories/skills_library/memory_skills_db.dart';
import '../../../support/fake_gemini_bridge.dart';

void main() {
  const gemUrl = 'https://gemini.google.com/gem/abc123def';
  final connected = GeminiBridgeState.connected(const GeminiBridgeStatus());

  late MemorySkillsDb db;
  late SqliteSkillsLibraryRepository repo;
  late FakeGeminiBridge bridge;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    db = MemorySkillsDb();
    repo = SqliteSkillsLibraryRepository(db);
    bridge = FakeGeminiBridge(initialState: connected);
  });

  tearDown(() => db.close());

  final syncProvider = Provider<GemAutoSync>((ref) {
    final sync = GemAutoSync(
      ref,
      ref.watch(geminiBridgeProvider),
      quietPeriod: const Duration(milliseconds: 10),
    );
    ref.listen(gemSetupSavesProvider, (previous, next) {
      if (next != null) sync.changed(next.groupId);
    });
    ref.onDispose(sync.dispose);
    return sync;
  });

  ProviderContainer newContainer() {
    final container = ProviderContainer(
      overrides: [
        skillsLibraryRepositoryProvider.overrideWithValue(repo),
        geminiBridgeProvider.overrideWithValue(bridge),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  Future<String> keywordsDeck(ProviderContainer container) async {
    final group = await repo.createGroup('keyword generator skill');
    await container.read(skillGemSetupControllerProvider(group.id).future);
    return group.id;
  }

  Future<void> editInstructions(
    ProviderContainer container,
    String groupId,
    String text,
  ) async {
    await Future<void>.delayed(const Duration(milliseconds: 2));
    final controller =
        container.read(skillGemSetupControllerProvider(groupId).notifier);
    controller.edit(instructions: text);
    await controller.flush();
  }

  Future<SkillGemSetup> setupOf(ProviderContainer c, String groupId) async {
    final setup = await c.read(skillGemSetupControllerProvider(groupId).future);
    return setup!;
  }

  test('an edited deck with no gem gets one created, linked in Settings',
      () async {
    final container = newContainer();
    final groupId = await keywordsDeck(container);
    await editInstructions(container, groupId, 'Always be brief.');
    bridge.answerGemCreate(const GemResult(url: gemUrl, gemId: 'abc123def'));

    await container.read(syncProvider).syncAll();

    final create = bridge.lastCall('action.gem_create')!;
    expect(create.params['instructions'], 'Always be brief.');
    final setup = await setupOf(container, groupId);
    expect(setup.url, gemUrl);
    expect(setup.needsSync, isFalse);
    expect(container.read(geminiBridgeSettingsProvider).keywordsGem, gemUrl);
  });

  test('an edit to a deck that has a gem updates that gem after a pause',
      () async {
    final container = newContainer();
    final groupId = await keywordsDeck(container);
    await editInstructions(container, groupId, 'v1');
    bridge.answerGemCreate(const GemResult(url: gemUrl));
    final sync = container.read(syncProvider);
    await sync.syncAll();

    bridge.answerGemUpdate(
        const GemResult(url: gemUrl, changed: ['instructions']));
    await editInstructions(container, groupId, 'v2');
    expect(bridge.callCount('action.gem_update'), 0);
    await Future<void>.delayed(const Duration(milliseconds: 60));

    final update = bridge.lastCall('action.gem_update')!;
    expect(update.params['gem'], gemUrl);
    expect(update.params['instructions'], 'v2');
    expect((await setupOf(container, groupId)).needsSync, isFalse);
    expect(bridge.callCount('action.gem_create'), 1);
  });

  test('an untouched deck is never pushed; a gem named in Settings is read in',
      () async {
    final container = newContainer();
    await container
        .read(geminiBridgeSettingsProvider.notifier)
        .edit((s) => s.copyWith(keywordsGem: gemUrl));
    final groupId = await keywordsDeck(container);
    bridge.answerGemRead(const GemDetails(
      url: gemUrl,
      name: 'Keywords',
      description: 'd',
      instructions: 'Written in Gemini.',
    ));

    await container.read(syncProvider).syncAll();

    expect(bridge.callCount('action.gem_update'), 0);
    expect(bridge.callCount('action.gem_create'), 0);
    final setup = await setupOf(container, groupId);
    expect(setup.instructions, 'Written in Gemini.');
    expect(setup.url, gemUrl);
    expect(setup.needsSync, isFalse);
  });

  test('an untouched deck with no gem anywhere is left alone', () async {
    final container = newContainer();
    await keywordsDeck(container);

    await container.read(syncProvider).syncAll();

    expect(
        bridge.calls.where((c) => c.method.startsWith('action.gem')), isEmpty);
  });

  test('nothing is pushed while Gemini is not connected; connecting does it',
      () async {
    bridge.setState(const GeminiBridgeState.listening());
    final container = newContainer();
    final groupId = await keywordsDeck(container);
    await editInstructions(container, groupId, 'offline edit');
    bridge.answerGemCreate(const GemResult(url: gemUrl));
    container.read(syncProvider).start();

    await container.read(syncProvider).syncAll();
    expect(bridge.callCount('action.gem_create'), 0);

    bridge.setState(connected);
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(bridge.callCount('action.gem_create'), 1);
  });

  test('a create that does not say where the gem is is not repeated', () async {
    final container = newContainer();
    final groupId = await keywordsDeck(container);
    await editInstructions(container, groupId, 'x');
    bridge.answerGemCreate(const GemResult());
    final sync = container.read(syncProvider);

    await sync.syncAll();
    await sync.syncAll();

    expect(bridge.callCount('action.gem_create'), 1);
  });
}
