import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge_types.dart';

import '../../support/fake_gemini_bridge.dart';

/// The typed calls added with the browser / add-on / gem / drafting-rule work
/// (CONTRACT_GEMINI.md §3, §5): the daemon method each one speaks, the params
/// it sends (only the ones with a value), the deadline it gives the call, and
/// whether it prepares an account first.
///
/// The rule worth pinning is the last: the three `bridge.*` calls and the
/// catalogue read must NOT prepare an account — `prepareForAction` needs an
/// extension connection, and `bridge.ensure_window` is what makes one exist —
/// while every call that drives the Gemini page must.
void main() {
  late FakeGeminiBridge bridge;
  setUp(() => bridge = FakeGeminiBridge());
  tearDown(() => bridge.dispose());

  group('browserInfo', () {
    test('asks bridge.browser_info with no params and a 30 s deadline',
        () async {
      bridge.answerBrowserInfo(sampleGeminiBrowserInfo());
      final info = await bridge.browserInfo();

      final call = bridge.lastCall('bridge.browser_info')!;
      expect(call.params, isEmpty);
      expect(call.timeout, const Duration(seconds: 30));
      expect(bridge.prepareCount, 0);

      expect(info.selectedKind, GeminiBrowserKind.firefox);
      expect(info.browsers, hasLength(3));
      expect(info.addon.state, GeminiAddonState.missing);
      expect(info.addon.shippedVersion, '0.2.0');
      expect(info.profile.dir, endsWith('gemini-profile'));
    });
  });

  group('ensureWindow', () {
    test('defaults: no browser, not focused, 45 s, and 30 s of grace',
        () async {
      bridge.answerEnsureWindow(sampleGeminiWindowResult());
      final window = await bridge.ensureWindow();

      final call = bridge.lastCall('bridge.ensure_window')!;
      expect(call.params, {'focus': false, 'timeoutS': 45});
      expect(call.timeout, const Duration(seconds: 75));
      expect(bridge.prepareCount, 0);

      expect(window.connected, isTrue);
      expect(window.reused, isTrue);
      expect(window.account!.label, 'Moustafa Khaled (moustafa@example.com)');
    });

    test(
        'sends what it is given, and its own timeout plus 30 s is the deadline',
        () async {
      bridge.answerEnsureWindow(sampleGeminiWindowResult(launched: true));
      final window = await bridge.ensureWindow(
        browser: GeminiBrowserKind.edge,
        focus: true,
        timeout: const Duration(seconds: 20),
        url: ' https://gemini.google.com/app ',
      );

      final call = bridge.lastCall('bridge.ensure_window')!;
      expect(call.params, {
        'browser': 'edge',
        'focus': true,
        'timeoutS': 20,
        'url': 'https://gemini.google.com/app',
      });
      expect(call.timeout, const Duration(seconds: 50));
      expect(window.launched, isTrue);
    });

    test('a blank url is left out; a sub-second timeout still asks for 1 s',
        () async {
      bridge.answerEnsureWindow(sampleGeminiWindowResult());
      await bridge.ensureWindow(
        url: '  ',
        timeout: const Duration(milliseconds: 200),
      );
      final call = bridge.lastCall('bridge.ensure_window')!;
      expect(call.params.containsKey('url'), isFalse);
      expect(call.params['timeoutS'], 1);
      expect(call.timeout, const Duration(seconds: 31));
    });

    test('"could not get there" comes back as a result, not an exception',
        () async {
      bridge.answerEnsureWindow(sampleGeminiWindowResult(
        connected: false,
        message: 'Firefox is not installed. Install it, or pick another '
            'browser in Settings.',
      ));
      final window = await bridge.ensureWindow();
      expect(window.connected, isFalse);
      expect(window.account, isNull);
      expect(window.message, contains('not installed'));
    });
  });

  group('installAddon', () {
    test('defaults to auto, not forced, with a 120 s deadline', () async {
      bridge.answerInstallAddon(const GeminiAddonStatus(
        state: GeminiAddonState.temporary,
        installedVersion: '0.2.0',
        method: GeminiAddonMethod.rdpTemporary,
        message: 'Installed for this Firefox session.',
      ));
      final status = await bridge.installAddon();

      final call = bridge.lastCall('bridge.install_addon')!;
      expect(call.params, {'mode': 'auto', 'force': false});
      expect(call.timeout, const Duration(seconds: 120));
      expect(bridge.prepareCount, 0);

      // The daemon calls the version `version`; it reads as the installed one.
      expect(status.state, GeminiAddonState.temporary);
      expect(status.installedVersion, '0.2.0');
      expect(status.method, GeminiAddonMethod.rdpTemporary);
      expect(status.message, 'Installed for this Firefox session.');
    });

    test('sends the browser, the mode and force', () async {
      bridge.answerInstallAddon(const GeminiAddonStatus());
      await bridge.installAddon(
        browser: GeminiBrowserKind.firefox,
        mode: GeminiAddonMode.permanent,
        force: true,
      );
      expect(bridge.lastCall('bridge.install_addon')!.params, {
        'browser': 'firefox',
        'mode': 'permanent',
        'force': true,
      });
    });

    test('an unsigned add-on on release Firefox is a typed exception', () {
      bridge.failWith(
        'bridge.install_addon',
        'ADDON_UNSIGNED',
        'Release Firefox will not run an unsigned add-on.',
        details: {
          'browser': 'firefox',
          'channel': 'release',
          'hint': 'Use Firefox ESR, or sign the add-on.',
        },
      );
      expect(
        bridge.installAddon(),
        throwsA(isA<GeminiBridgeException>()
            .having((e) => e.failure, 'failure', GeminiFailure.addonUnsigned)
            .having((e) => e.failure.isBridgeProblem, 'isBridgeProblem', true)
            .having((e) => e.details['channel'], 'channel', 'release')),
      );
    });
  });

  group('gems', () {
    test('createGem sends the three texts and prepares the account', () async {
      bridge.answerGemCreate(const GemResult(
        url: 'https://gemini.google.com/gem/abc123',
        gemId: 'abc123',
        name: 'Email drafter',
      ));
      final gem = await bridge.createGem(
        name: 'Email drafter',
        description: 'Writes cold emails',
        instructions: 'You are a drafter.',
      );

      final call = bridge.lastCall('action.gem_create')!;
      expect(call.params, {
        'name': 'Email drafter',
        'description': 'Writes cold emails',
        'instructions': 'You are a drafter.',
        'timeoutS': 180,
      });
      expect(call.timeout, const Duration(seconds: 240));
      expect(bridge.prepareCount, 1);
      expect(gem.url, 'https://gemini.google.com/gem/abc123');
      expect(gem.gemId, 'abc123');
    });

    test('createGem passes a model when there is one, and leaves a blank out',
        () async {
      bridge.answerGemCreate(const GemResult());
      await bridge.createGem(
        name: 'n',
        description: 'd',
        instructions: 'i',
        model: ' Pro ',
        timeoutS: 100,
      );
      final call = bridge.lastCall('action.gem_create')!;
      expect(call.params['model'], 'Pro');
      expect(call.params['timeoutS'], 100);
      expect(call.timeout, const Duration(seconds: 160));

      await bridge.createGem(
        name: 'n',
        description: 'd',
        instructions: 'i',
        model: '  ',
      );
      expect(bridge.lastCall('action.gem_create')!.params.containsKey('model'),
          isFalse);
    });

    test('updateGem sends only the fields given, and the gem trimmed',
        () async {
      bridge.answerGemUpdate(const GemResult(
        url: 'https://gemini.google.com/gem/abc123',
        gemId: 'abc123',
        name: 'Email drafter',
        changed: ['instructions'],
      ));
      final gem = await bridge.updateGem(
        ' https://gemini.google.com/gem/abc123 ',
        instructions: 'New instructions.',
      );

      final call = bridge.lastCall('action.gem_update')!;
      expect(call.params, {
        'gem': 'https://gemini.google.com/gem/abc123',
        'instructions': 'New instructions.',
        'timeoutS': 180,
      });
      expect(call.timeout, const Duration(seconds: 240));
      expect(bridge.prepareCount, 1);
      expect(gem.changed, ['instructions']);
    });

    test('updateGem can clear the description: blank is a value, null is not',
        () async {
      bridge.answerGemUpdate(const GemResult());
      await bridge.updateGem('abc', name: 'New name', description: '');
      expect(bridge.lastCall('action.gem_update')!.params, {
        'gem': 'abc',
        'name': 'New name',
        'description': '',
        'timeoutS': 180,
      });
    });

    test('readGem asks for the gem and decodes what the editor shows',
        () async {
      bridge.answerGemRead(const GemDetails(
        url: 'https://gemini.google.com/gem/abc123',
        gemId: 'abc123',
        name: 'Email drafter',
        description: 'Writes cold emails',
        instructions: 'You are a drafter.\n\nRule 1.',
      ));
      final gem = await bridge.readGem(' abc123 ');

      final call = bridge.lastCall('action.gem_read')!;
      expect(call.params, {'gem': 'abc123', 'timeoutS': 90});
      expect(call.timeout, const Duration(seconds: 150));
      expect(bridge.prepareCount, 1);
      expect(gem.name, 'Email drafter');
      expect(gem.instructions, 'You are a drafter.\n\nRule 1.');
    });

    test('an element the gem editor lacks keeps its diagnostics', () {
      bridge.failWith(
        'action.gem_update',
        'GEM_UI_NOT_FOUND',
        'The instructions box of the gem editor was not found.',
        details: {
          'element': 'gemInstructions',
          'tried': [
            {'strategy': 'css#1', 'matched': 0, 'visible': 0},
          ],
        },
      );
      expect(
        bridge.updateGem('abc', instructions: 'x'),
        throwsA(isA<GeminiBridgeException>()
            .having((e) => e.failure, 'failure', GeminiFailure.gemUiNotFound)
            .having((e) => e.failure.isBridgeProblem, 'isBridgeProblem', true)
            .having((e) => e.details['element'], 'element', 'gemInstructions')),
      );
    });

    test('a save the editor refused carries the reason and the field errors',
        () {
      bridge.failWith(
        'action.gem_create',
        'GEM_SAVE_FAILED',
        'The editor did not accept the save.',
        details: {
          'reason': 'name too long',
          'fieldErrors': {'name': 'Too long'},
        },
      );
      expect(
        bridge.createGem(name: 'n', description: 'd', instructions: 'i'),
        throwsA(isA<GeminiBridgeException>()
            .having((e) => e.failure, 'failure', GeminiFailure.gemSaveFailed)
            .having((e) => e.details['reason'], 'reason', 'name too long')),
      );
    });

    test('a method the daemon has not implemented yet says so', () {
      bridge.failWith(
        'action.gem_read',
        'NOT_IMPLEMENTED',
        'not implemented yet',
      );
      expect(
        bridge.readGem('abc'),
        throwsA(isA<GeminiBridgeException>()
            .having((e) => e.failure, 'failure', GeminiFailure.notImplemented)
            .having((e) => e.message, 'message', 'not implemented yet')),
      );
    });
  });

  group('generateKeywords batches', () {
    test('without the new params it sends what it always did', () async {
      bridge.answer('action.generate_keywords', {
        'keywords': ['a']
      });
      await bridge.generateKeywords(topic: 'AI');
      final call = bridge.lastCall('action.generate_keywords')!;
      expect(
          call.params.keys,
          isNot(anyOf(
              contains('chats'), contains('perChat'), contains('angles'))));
      expect(call.timeout, const Duration(seconds: 300));
    });

    test('chats, perChat and angles are sent, and timeoutS is per chat',
        () async {
      bridge.answer('action.generate_keywords', {
        'keywords': ['a', 'b'],
        'chats': [
          {'index': 0, 'requested': 25, 'received': 2, 'ok': true},
        ],
        'partial': false,
      });
      final result = await bridge.generateKeywords(
        topic: 'AI',
        chats: 4,
        perChat: 25,
        angles: const ['how-to', 'comparison'],
        timeoutS: 100,
      );
      final call = bridge.lastCall('action.generate_keywords')!;
      expect(call.params['chats'], 4);
      expect(call.params['perChat'], 25);
      expect(call.params['angles'], ['how-to', 'comparison']);
      expect(call.params['timeoutS'], 100);
      // Four chats one after another, then the usual 60 s.
      expect(call.timeout, const Duration(seconds: 460));
      expect(bridge.prepareCount, 1);

      expect(result.keywords, ['a', 'b']);
      expect(result.chats.single.received, 2);
      expect(result.partial, isFalse);
    });

    test('a partial batch is a result, with the failed chats listed', () async {
      bridge.answer('action.generate_keywords', {
        'keywords': ['a'],
        'chats': [
          {'index': 0, 'ok': true, 'received': 1},
          {'index': 1, 'ok': false, 'error': 'timed out'},
        ],
        'partial': true,
      });
      final result = await bridge.generateKeywords(topic: 'AI', chats: 2);
      expect(result.partial, isTrue);
      expect(result.failedChats.single.error, 'timed out');
    });
  });

  group('progress events', () {
    test('a scripted call emits its steps, in order, before it answers',
        () async {
      bridge.answer('action.generate_keywords', {
        'keywords': ['a']
      });
      bridge.scriptProgress('action.generate_keywords', const [
        GeminiProgress(
          action: 'generate_keywords',
          done: 1,
          total: 2,
          keywords: 30,
          message: 'chat 1 of 2 done',
        ),
        GeminiProgress(
          action: 'generate_keywords',
          done: 2,
          total: 2,
          keywords: 58,
          message: 'chat 2 of 2 done',
        ),
      ]);
      final seen = <GeminiEvent>[];
      final sub = bridge.events.listen(seen.add);
      addTearDown(sub.cancel);

      var answered = false;
      final call = bridge
          .generateKeywords(topic: 'AI', chats: 2)
          .then((_) => answered = true);
      await call;

      expect(answered, isTrue);
      expect(seen.every((e) => e.isProgress), isTrue);
      expect(seen.map((e) => e.progress!.done), [1, 2]);
      expect(seen.map((e) => e.progress!.keywords), [30, 58]);
      expect(seen.last.progress!.message, 'chat 2 of 2 done');
      expect(seen.last.progress!.fraction, 1.0);
    });

    test('emitProgress pushes one event by hand', () async {
      final seen = <GeminiEvent>[];
      final sub = bridge.events.listen(seen.add);
      addTearDown(sub.cancel);

      bridge.emitProgress(const GeminiProgress(
        action: 'generate_keywords',
        done: 3,
        total: 8,
        message: 'chat 3 of 8 done',
      ));
      await Future<void>.delayed(Duration.zero);

      final event = seen.single;
      expect(event.event, 'progress');
      expect(event.progress!.action, 'generate_keywords');
      expect(event.progress!.fraction, 0.375);
    });

    test('calls nobody scripted progress for emit nothing', () async {
      bridge.answer('bridge.status', {'listening': true});
      final seen = <GeminiEvent>[];
      final sub = bridge.events.listen(seen.add);
      addTearDown(sub.cancel);
      await bridge.status();
      await Future<void>.delayed(Duration.zero);
      expect(seen, isEmpty);
    });
  });

  group('the fake keeps behaving as it did', () {
    test('a call with no deadline of its own records none', () async {
      bridge.answer('bridge.status', {'listening': true});
      await bridge.status();
      expect(bridge.lastCall('bridge.status')!.timeout, isNull);
    });

    test('an unscripted new call fails the way any unscripted call does',
        () async {
      await expectLater(
        bridge.browserInfo(),
        throwsA(isA<GeminiBridgeException>()
            .having((e) => e.code, 'code', 'BAD_PARAMS')
            .having((e) => e.message, 'message',
                contains('no answer scripted for bridge.browser_info'))),
      );
    });
  });
}
