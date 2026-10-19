import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/gemini_protocol.dart';

/// The result classes added with the browser / add-on / gem / drafting-rule
/// work (CONTRACT_GEMINI.md §3, §5): each is decoded from the contract's own
/// example, from a payload with fields missing or null, from one with a value
/// this build has never heard of, and — where it has a `toJson` — round-tripped.
/// The classes that grew (`KeywordsResult`, `DraftEmailResult`) are also fed
/// what an OLD daemon sends, which has none of the new fields.
void main() {
  // ---- bridge.browser_info -------------------------------------------------

  group('GeminiBrowserInfo', () {
    // CONTRACT §3.1, verbatim (one browser instead of three).
    const contractSample = <String, Object?>{
      'selected': 'firefox',
      'browsers': [
        {
          'id': 'firefox',
          'name': 'Mozilla Firefox',
          'path': r'C:\Program Files\Mozilla Firefox\firefox.exe',
          'version': '156.0.1',
          'channel': 'release',
          'installed': true,
          'running': false,
          'canRunUnsigned': false,
        },
      ],
      'addon': {
        'id': 'gemini-bridge@gratovo.app',
        'shippedVersion': '0.2.0',
        'installedVersion': null,
        'state': 'missing',
        'signed': false,
        'restartNeeded': false,
        'method': 'none',
        'message': 'Human sentence saying what is wrong.',
      },
      'profile': {
        'mode': 'managed',
        'dir': r'C:\Users\x\AppData\Local\gratovo\gemini-profile',
        'exists': false,
      },
      'extensionDir': r'C:\gratovo\pipeline\gemini_extension',
      'xpiPath': null,
    };

    test('parses the contract example', () {
      final info = GeminiBrowserInfo.fromJson(contractSample);
      expect(info.selected, 'firefox');
      expect(info.selectedKind, GeminiBrowserKind.firefox);
      final firefox = info.browsers.single;
      expect(firefox.id, 'firefox');
      expect(firefox.kind, GeminiBrowserKind.firefox);
      expect(firefox.name, 'Mozilla Firefox');
      expect(firefox.label, 'Mozilla Firefox');
      expect(firefox.path, r'C:\Program Files\Mozilla Firefox\firefox.exe');
      expect(firefox.version, '156.0.1');
      expect(firefox.channel, 'release');
      expect(firefox.installed, isTrue);
      expect(firefox.running, isFalse);
      expect(firefox.canRunUnsigned, isFalse);
      expect(info.selectedEntry, same(firefox));
      expect(info.installedBrowsers, [firefox]);

      expect(info.addon.id, 'gemini-bridge@gratovo.app');
      expect(info.addon.shippedVersion, '0.2.0');
      expect(info.addon.installedVersion, isNull);
      expect(info.addon.state, GeminiAddonState.missing);
      expect(info.addon.method, GeminiAddonMethod.none);
      expect(info.addon.signed, isFalse);
      expect(info.addon.restartNeeded, isFalse);
      expect(info.addon.message, 'Human sentence saying what is wrong.');

      expect(info.profile.mode, GeminiProfileMode.managed);
      expect(
          info.profile.dir, r'C:\Users\x\AppData\Local\gratovo\gemini-profile');
      expect(info.profile.exists, isFalse);
      expect(info.extensionDir, r'C:\gratovo\pipeline\gemini_extension');
      expect(info.xpiPath, isNull);
    });

    test('round-trips, and writes the shape it read', () {
      final info = GeminiBrowserInfo.fromJson(contractSample);
      expect(info.toJson(), contractSample);
      expect(GeminiBrowserInfo.fromJson(info.toJson()).toJson(), info.toJson());
    });

    test('an empty object parses to defaults', () {
      final info = GeminiBrowserInfo.fromJson(const {});
      expect(info.selected, '');
      expect(info.selectedKind, isNull);
      expect(info.selectedEntry, isNull);
      expect(info.browsers, isEmpty);
      expect(info.addon.state, GeminiAddonState.unknown);
      expect(info.addon.method, GeminiAddonMethod.unknown);
      expect(info.addon.id, geminiAddonId);
      expect(info.addon.message, '');
      expect(info.profile.mode, GeminiProfileMode.managed);
      expect(info.extensionDir, isNull);
      expect(info.xpiPath, isNull);
    });

    test('tolerates nulls and the wrong types everywhere', () {
      final info = GeminiBrowserInfo.fromJson({
        'selected': null,
        'browsers': [
          null,
          3,
          'x',
          {'id': 'edge'}
        ],
        'addon': 'not a map',
        'profile': [],
        'extensionDir': 7,
      });
      expect(info.browsers.map((b) => b.id), ['edge']);
      // Everything else about the surviving entry is defaulted.
      expect(info.browsers.single.channel, 'unknown');
      expect(info.browsers.single.installed, isFalse);
      expect(info.browsers.single.label, 'edge');
      expect(info.addon.state, GeminiAddonState.unknown);
      expect(info.extensionDir, isNull);
    });

    test('values this build does not know stay usable', () {
      final info = GeminiBrowserInfo.fromJson({
        'selected': 'brave',
        'browsers': [
          {'id': 'brave', 'name': 'Brave', 'installed': true},
        ],
        'addon': {
          'state': 'from_the_future',
          'method': 'carrier_pigeon',
        },
        'profile': {'mode': 'sideways'},
      });
      expect(info.selectedKind, isNull);
      expect(info.selectedEntry!.kind, isNull);
      expect(info.selectedEntry!.label, 'Brave');
      expect(info.addon.state, GeminiAddonState.unknown);
      expect(info.addon.method, GeminiAddonMethod.unknown);
      expect(info.profile.mode, GeminiProfileMode.managed);
    });

    test('every state and method wire name maps to its own value', () {
      expect(GeminiAddonState.values.map((s) => s.wire), [
        'missing',
        'temporary',
        'installed',
        'outdated',
        'unsigned_blocked',
        'unknown',
      ]);
      for (final state in GeminiAddonState.values) {
        expect(GeminiAddonState.fromWire(state.wire), state);
      }
      expect(GeminiAddonMethod.values.map((m) => m.wire), [
        'none',
        'rdp_temporary',
        'profile_xpi',
        'policy',
        'unpacked',
        'unknown',
      ]);
      for (final method in GeminiAddonMethod.values) {
        expect(GeminiAddonMethod.fromWire(method.wire), method);
      }
      expect(
          GeminiAddonState.fromWire(' Installed '), GeminiAddonState.installed);
      expect(GeminiAddonState.fromWire(null), GeminiAddonState.unknown);
      expect(GeminiAddonMethod.fromWire(''), GeminiAddonMethod.unknown);
    });
  });

  // ---- bridge.install_addon -----------------------------------------------

  group('GeminiAddonStatus (bridge.install_addon)', () {
    test('reads the install result, `version` being the installed version', () {
      final status = GeminiAddonStatus.fromJson({
        'state': 'temporary',
        'version': '0.2.0',
        'method': 'rdp_temporary',
        'restartNeeded': false,
        'message': 'Installed for this session.',
      });
      expect(status.state, GeminiAddonState.temporary);
      expect(status.installedVersion, '0.2.0');
      expect(status.method, GeminiAddonMethod.rdpTemporary);
      expect(status.restartNeeded, isFalse);
      expect(status.message, 'Installed for this session.');
    });

    test('installedVersion wins over version when both are sent', () {
      final status = GeminiAddonStatus.fromJson({
        'installedVersion': '0.3.0',
        'version': '0.2.0',
      });
      expect(status.installedVersion, '0.3.0');
    });

    test('an empty result is unknown, not an error', () {
      final status = GeminiAddonStatus.fromJson(null);
      expect(status.state, GeminiAddonState.unknown);
      expect(status.installedVersion, isNull);
      expect(status.restartNeeded, isFalse);
      expect(status.message, '');
    });

    test('round-trips', () {
      const status = GeminiAddonStatus(
        shippedVersion: '0.2.0',
        installedVersion: '0.1.1',
        state: GeminiAddonState.outdated,
        signed: true,
        restartNeeded: true,
        method: GeminiAddonMethod.profileXpi,
        message: 'Restart Firefox to finish updating.',
      );
      expect(GeminiAddonStatus.fromJson(status.toJson()).toJson(),
          status.toJson());
    });
  });

  // ---- bridge.ensure_window -----------------------------------------------

  group('GeminiWindowResult', () {
    // CONTRACT §3.2, verbatim.
    const contractSample = <String, Object?>{
      'connected': true,
      'launched': false,
      'reused': true,
      'browser': 'firefox',
      'addon': {
        'state': 'temporary',
        'version': '0.2.0',
        'method': 'rdp_temporary',
      },
      'tab': {'tabId': 12, 'url': 'https://gemini.google.com/app'},
      'account': {'name': 'Moustafa', 'email': 'x@gmail.com', 'index': 1},
      'steps': [
        {'name': 'daemon_listening', 'ok': true, 'ms': 3, 'detail': ''},
        {'name': 'launch_browser', 'ok': true, 'ms': 1240},
      ],
      'message': '',
    };

    test('parses the contract example', () {
      final window = GeminiWindowResult.fromJson(contractSample);
      expect(window.connected, isTrue);
      expect(window.launched, isFalse);
      expect(window.reused, isTrue);
      expect(window.browser, 'firefox');
      expect(window.addon.state, GeminiAddonState.temporary);
      expect(window.addon.installedVersion, '0.2.0');
      expect(window.addon.method, GeminiAddonMethod.rdpTemporary);
      expect(window.tab!.tabId, 12);
      expect(window.tab!.url, 'https://gemini.google.com/app');
      // The account is the same type `bridge.ensure_account` returns.
      final GeminiAccountInfo account = window.account!;
      expect(account.name, 'Moustafa');
      expect(account.email, 'x@gmail.com');
      expect(account.index, 1);
      expect(window.steps.map((s) => s.name),
          ['daemon_listening', 'launch_browser']);
      expect(window.steps[0].ms, 3);
      expect(window.steps[1].ms, 1240);
      expect(window.steps[1].detail, '');
      expect(window.failedStep, isNull);
      expect(window.message, '');
    });

    test('round-trips, keeping the short add-on shape', () {
      final window = GeminiWindowResult.fromJson(contractSample);
      final json = window.toJson();
      expect(json['addon'], {
        'state': 'temporary',
        'version': '0.2.0',
        'method': 'rdp_temporary',
      });
      expect(GeminiWindowResult.fromJson(json).toJson(), json);
    });

    test('"could not get there" is a result, with the step that failed', () {
      final window = GeminiWindowResult.fromJson({
        'connected': false,
        'launched': false,
        'reused': false,
        'browser': 'firefox',
        'addon': {
          'state': 'unsigned_blocked',
          'version': null,
          'method': 'none'
        },
        'tab': null,
        'account': null,
        'steps': [
          {'name': 'daemon_listening', 'ok': true, 'ms': 2},
          {'name': 'launch_browser', 'ok': false, 'ms': 90, 'detail': 'exit 1'},
          {'name': 'wait_for_extension', 'ok': false, 'ms': 0},
        ],
        'message': 'Firefox would not start. Close it and try again.',
      });
      expect(window.connected, isFalse);
      expect(window.tab, isNull);
      expect(window.account, isNull);
      expect(window.addon.state, GeminiAddonState.unsignedBlocked);
      expect(window.failedStep!.name, 'launch_browser');
      expect(window.failedStep!.detail, 'exit 1');
      expect(window.message, contains('would not start'));
    });

    test('connected with no account is the first-run, not-signed-in-yet case',
        () {
      final window = GeminiWindowResult.fromJson({
        'connected': true,
        'account': null,
        'message': 'Sign in to Google in the window that just opened.',
      });
      expect(window.connected, isTrue);
      expect(window.account, isNull);
      expect(window.message, startsWith('Sign in'));
    });

    test('an empty object parses to "not connected"', () {
      final window = GeminiWindowResult.fromJson(const {});
      expect(window.connected, isFalse);
      expect(window.launched, isFalse);
      expect(window.reused, isFalse);
      expect(window.browser, isNull);
      expect(window.tab, isNull);
      expect(window.account, isNull);
      expect(window.steps, isEmpty);
      expect(window.failedStep, isNull);
      expect(window.addon.state, GeminiAddonState.unknown);
    });

    test('tolerates junk in the lists and objects', () {
      final window = GeminiWindowResult.fromJson({
        'steps': [
          null,
          'x',
          4,
          {'name': 'a', 'ok': true}
        ],
        'tab': 'not a map',
        'addon': null,
      });
      expect(window.steps.map((s) => s.name), ['a']);
      expect(window.tab, isNull);
    });
  });

  // ---- gems ---------------------------------------------------------------

  group('gems', () {
    test('GemResult: create and update shapes', () {
      final created = GemResult.fromJson({
        'url': 'https://gemini.google.com/gem/abc123',
        'gemId': 'abc123',
        'name': 'Email drafter',
      });
      expect(created.url, 'https://gemini.google.com/gem/abc123');
      expect(created.gemId, 'abc123');
      expect(created.name, 'Email drafter');
      expect(created.changed, isEmpty);

      final updated = GemResult.fromJson({
        'url': 'https://gemini.google.com/gem/abc123',
        'gemId': 'abc123',
        'name': 'Email drafter v2',
        'changed': ['name', 'instructions'],
      });
      expect(updated.changed, ['name', 'instructions']);
      expect(GemResult.fromJson(updated.toJson()).toJson(), updated.toJson());
    });

    test('GemDetails keeps the description and instructions verbatim', () {
      final gem = GemDetails.fromJson({
        'url': 'https://gemini.google.com/gem/abc123',
        'gemId': 'abc123',
        'name': '  Drafter  ',
        'description': ' Writes cold emails ',
        'instructions': '\n  You are a drafter.\n\nRule 1.\n',
      });
      expect(gem.name, 'Drafter');
      expect(gem.description, ' Writes cold emails ');
      expect(gem.instructions, '\n  You are a drafter.\n\nRule 1.\n');
      expect(GemDetails.fromJson(gem.toJson()).toJson(), gem.toJson());
    });

    test('empty objects are empty gems, not errors', () {
      final result = GemResult.fromJson(const {});
      expect(result.url, '');
      expect(result.gemId, '');
      expect(result.changed, isEmpty);
      final gem = GemDetails.fromJson({'instructions': null, 'name': 3});
      expect(gem.instructions, '');
      expect(gem.name, '');
    });
  });

  // ---- drafting rules -----------------------------------------------------

  group('GeminiProgress', () {
    test('comes out of a progress event', () {
      final message = GeminiMessage.decodeLine(
        '{"type":"event","event":"progress","data":{"action":"generate_keywords",'
        '"done":2,"total":4,"keywords":137,"message":"chat 2 of 4 done"}}',
      );
      final event = message! as GeminiEvent;
      expect(event.isProgress, isTrue);
      expect(event.isDaemon, isFalse);
      final progress = event.progress!;
      expect(progress.action, 'generate_keywords');
      expect(progress.done, 2);
      expect(progress.total, 4);
      expect(progress.keywords, 137);
      expect(progress.message, 'chat 2 of 4 done');
      expect(progress.fraction, 0.5);
      expect(progress.data['keywords'], 137);
    });

    test('other events have no progress', () {
      expect(const GeminiEvent(event: 'status').progress, isNull);
      expect(const GeminiEvent(event: 'daemon').isProgress, isFalse);
    });

    test('missing fields default, and an unknown total has no fraction', () {
      final progress = GeminiProgress.fromJson(const {});
      expect(progress.action, '');
      expect(progress.done, 0);
      expect(progress.total, 0);
      expect(progress.keywords, isNull);
      expect(progress.message, '');
      expect(progress.fraction, isNull);
    });

    test('the fraction stays within 0..1', () {
      expect(GeminiProgress.fromJson({'done': 9, 'total': 4}).fraction, 1.0);
      expect(GeminiProgress.fromJson({'done': -1, 'total': 4}).fraction, 0.0);
      expect(GeminiProgress.fromJson({'done': 4, 'total': 4}).fraction, 1.0);
      expect(
          GeminiProgress.fromJson({'done': '1', 'total': '4'}).fraction, 0.25);
    });

    test('round-trips', () {
      const progress = GeminiProgress(
        action: 'generate_keywords',
        done: 1,
        total: 4,
        keywords: 30,
        message: 'chat 1 of 4 done',
      );
      final again = GeminiProgress.fromJson(progress.toJson());
      expect(again.toJson(), progress.toJson());
      // `keywords` is left out rather than written as null.
      expect(
        const GeminiProgress(action: 'a').toJson().containsKey('keywords'),
        isFalse,
      );
    });
  });

  // ---- the extended results -----------------------------------------------

  group('KeywordsResult (batches)', () {
    test('parses the contract example', () {
      final result = KeywordsResult.fromJson({
        'keywords': ['a', 'b'],
        'dropped': 3,
        'chats': [
          {
            'index': 0,
            'requested': 25,
            'received': 24,
            'ok': true,
            'error': null,
            'durationMs': 41000,
          },
          {
            'index': 1,
            'requested': 25,
            'received': 0,
            'ok': false,
            'error': 'Gemini did not answer in time.',
            'durationMs': 240000,
          },
        ],
        'partial': true,
        'raw': 'a\nb',
        'model': 'Pro',
      });
      expect(result.keywords, ['a', 'b']);
      expect(result.dropped, 3);
      expect(result.partial, isTrue);
      expect(result.chats, hasLength(2));
      final first = result.chats.first;
      expect(first.index, 0);
      expect(first.requested, 25);
      expect(first.received, 24);
      expect(first.ok, isTrue);
      expect(first.error, isNull);
      expect(first.durationMs, 41000);
      expect(first.duration, const Duration(seconds: 41));
      expect(result.failedChats.single.index, 1);
      expect(result.failedChats.single.error, 'Gemini did not answer in time.');
    });

    test('a payload from an OLD daemon has no chats and is not partial', () {
      final result = KeywordsResult.fromJson({
        'keywords': ['a'],
        'dropped': 0,
        'raw': 'a',
        'model': 'Flash',
      });
      expect(result.chats, isEmpty);
      expect(result.failedChats, isEmpty);
      expect(result.partial, isFalse);
      expect(result.keywords, ['a']);
    });

    test('a chat entry reads its error as text or as {code, message}', () {
      KeywordChatResult chat(Object? entry) => KeywordsResult.fromJson({
            'chats': [entry]
          }).chats.single;
      expect(chat({'ok': false, 'error': 'boom'}).error, 'boom');
      expect(
        chat({
          'ok': false,
          'error': {'code': 'TIMEOUT', 'message': 'took too long'},
        }).error,
        'took too long',
      );
      expect(
          chat({
            'error': {'code': 'TIMEOUT'}
          }).error,
          'TIMEOUT');
      // No verdict: an error makes it failed, none makes it fine.
      expect(chat({'error': 'boom'}).ok, isFalse);
      expect(chat({'requested': 5}).ok, isTrue);
      expect(chat({'ok': true, 'error': 'ignored?'}).ok, isTrue);
    });

    test('a chat with no index is numbered by its position; junk is skipped',
        () {
      final result = KeywordsResult.fromJson({
        'chats': [
          {'requested': 5},
          null,
          {'requested': 6},
          {'index': 9},
        ],
      });
      expect(result.chats.map((c) => c.index), [0, 2, 9]);
    });

    test('a chat round-trips', () {
      const chat = KeywordChatResult(
        index: 2,
        requested: 25,
        received: 20,
        ok: false,
        error: 'nope',
        durationMs: 1234,
      );
      expect(
        KeywordChatResult.fromJson(chat.toJson(), fallbackIndex: 0).toJson(),
        chat.toJson(),
      );
      expect(const KeywordChatResult(index: 0).duration, isNull);
    });
  });

  group('the new error codes', () {
    test('map to their own failures', () {
      expect(GeminiFailure.fromCode('BROWSER_NOT_FOUND'),
          GeminiFailure.browserNotFound);
      expect(GeminiFailure.fromCode('ADDON_UNSIGNED'),
          GeminiFailure.addonUnsigned);
      expect(GeminiFailure.fromCode('ADDON_INSTALL_FAILED'),
          GeminiFailure.addonInstallFailed);
      expect(GeminiFailure.fromCode('BROWSER_LAUNCH_FAILED'),
          GeminiFailure.browserLaunchFailed);
      expect(GeminiFailure.fromCode('GEM_UI_NOT_FOUND'),
          GeminiFailure.gemUiNotFound);
      expect(GeminiFailure.fromCode('GEM_SAVE_FAILED'),
          GeminiFailure.gemSaveFailed);
      expect(GeminiFailure.fromCode('NOT_IMPLEMENTED'),
          GeminiFailure.notImplemented);
      // The outreach cards' two codes went with decision old-files.
      expect(GeminiFailure.fromCode('OUTREACH_CARDS_MISSING'),
          GeminiFailure.unknown);
    });

    test('the ones whose fix is in Settings say so', () {
      for (final failure in const [
        GeminiFailure.browserNotFound,
        GeminiFailure.addonUnsigned,
        GeminiFailure.addonInstallFailed,
        GeminiFailure.browserLaunchFailed,
        GeminiFailure.gemUiNotFound,
      ]) {
        expect(failure.isBridgeProblem, isTrue, reason: '$failure');
      }
      // A rejected save is about the gem's content; "not implemented" is
      // about the build. Neither is fixed by opening Settings.
      expect(GeminiFailure.gemSaveFailed.isBridgeProblem, isFalse);
      expect(GeminiFailure.notImplemented.isBridgeProblem, isFalse);
    });

    test('arrive typed, with their details, from an error object', () {
      final error = GeminiBridgeException.fromJson({
        'code': 'ADDON_UNSIGNED',
        'message': 'Firefox release will not run an unsigned add-on.',
        'details': {'browser': 'firefox', 'channel': 'release', 'hint': 'x'},
      })!;
      expect(error.failure, GeminiFailure.addonUnsigned);
      expect(error.details['channel'], 'release');
      final gem = GeminiBridgeException.fromJson({
        'code': 'GEM_SAVE_FAILED',
        'message': 'The editor did not accept the save.',
        'details': {
          'reason': 'name too long',
          'fieldErrors': {'name': 'Too long'},
        },
      })!;
      expect(gem.failure, GeminiFailure.gemSaveFailed);
      expect((gem.details['fieldErrors']! as Map)['name'], 'Too long');
    });
  });

  group('daemon events for the browser', () {
    test('carry the browser and a sentence to show', () {
      final event = GeminiEvent.fromJson({
        'type': 'event',
        'event': 'daemon',
        'data': {
          'state': 'browser_launching',
          'browser': 'firefox',
          'message': 'Starting Firefox…',
        },
      });
      expect(event.isDaemon, isTrue);
      expect(event.daemonState, 'browser_launching');
      expect(event.daemonBrowser, 'firefox');
      expect(event.daemonMessage, 'Starting Firefox…');
      // The events the bridge already knew have neither.
      const listening = GeminiEvent(
        event: 'daemon',
        data: {'state': 'listening', 'port': 8765},
      );
      expect(listening.daemonBrowser, isNull);
      expect(listening.daemonMessage, isNull);
    });
  });

  group('the extension hello, as the status object reads it', () {
    test('reads the additions', () {
      final status = GeminiBridgeStatus.fromJson({
        'extensionConnected': true,
        'hello': {
          'extensionVersion': '0.2.0',
          'port': 8765,
          'browser': 'firefox',
          'manifestVersion': 3,
          'capabilities': ['gems', 'keepalive'],
          'account': {'name': 'M', 'email': 'm@x', 'index': 1},
        },
      });
      expect(status.extensionVersion, '0.2.0');
      expect(status.extensionBrowser, 'firefox');
      expect(status.manifestVersion, 3);
      expect(status.capabilities, ['gems', 'keepalive']);
      expect(status.helloAccount!.label, 'M (m@x)');
      expect(status.helloAccount!.index, 1);
    });

    test('an OLD extension says none of it', () {
      final status = GeminiBridgeStatus.fromJson({
        'extensionConnected': true,
        'hello': {'extensionVersion': '0.1.1', 'port': 8765},
      });
      expect(status.extensionBrowser, isNull);
      expect(status.manifestVersion, isNull);
      expect(status.capabilities, isEmpty);
      expect(status.helloAccount, isNull);
      // …and a hello whose account is null (nobody signed in) is the same.
      final signedOut = GeminiBridgeStatus.fromJson({
        'hello': {'account': null},
      });
      expect(signedOut.helloAccount, isNull);
    });
  });

  group('GeminiAccount', () {
    test('writes the {name, email, index} shape', () {
      const account = GeminiAccountInfo(name: 'N', email: 'e@x', index: 2);
      expect(account.toJson(), {'name': 'N', 'email': 'e@x', 'index': 2});
      expect(GeminiAccount.fromJson(account.toJson())!.label, 'N (e@x)');
      expect(const GeminiAccount().toJson(),
          {'name': null, 'email': null, 'index': null});
    });
  });
}
