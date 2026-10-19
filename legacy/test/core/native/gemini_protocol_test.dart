import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/gemini_protocol.dart';

/// Decoding what the Gemini daemon prints.
///
/// The shapes come out of a browser page and a model's reply, neither of
/// which keeps promises about fields — so every parse here is exercised with
/// a full sample AND with the fields missing, null, or the wrong type. None
/// of it needs Python, Chrome or Gemini.
void main() {
  group('GeminiMessage.decodeLine', () {
    test('a response with a result', () {
      final message = GeminiMessage.decodeLine(
        '{"type":"response","id":"r1","ok":true,"result":{"listening":true}}',
      );
      expect(message, isA<GeminiResponse>());
      final response = message! as GeminiResponse;
      expect(response.id, 'r1');
      expect(response.ok, isTrue);
      expect(response.result['listening'], isTrue);
      expect(response.error, isNull);
    });

    test('a failed response carries a typed error', () {
      final message = GeminiMessage.decodeLine(jsonEncode({
        'type': 'response',
        'id': 'r2',
        'ok': false,
        'error': {
          'code': 'EXTENSION_NOT_CONNECTED',
          'message': 'no extension',
          'details': {'port': 8765},
        },
      })) as GeminiResponse;
      expect(message.ok, isFalse);
      expect(message.error!.failure, GeminiFailure.extensionNotConnected);
      expect(message.error!.details['port'], 8765);
      expect(message.error!.failure.isBridgeProblem, isTrue);
    });

    test('a failed response with no error object still has one', () {
      final message = GeminiMessage.decodeLine(
        '{"type":"response","id":null,"ok":false}',
      ) as GeminiResponse;
      expect(message.id, isNull);
      expect(message.error, isNotNull);
      expect(message.error!.failure, GeminiFailure.unknown);
    });

    test('an event', () {
      final message = GeminiMessage.decodeLine(
        '{"type":"event","event":"daemon","data":{"state":"listening","port":8765}}',
      );
      expect(message, isA<GeminiEvent>());
      final event = message! as GeminiEvent;
      expect(event.isDaemon, isTrue);
      expect(event.daemonState, 'listening');
      expect(event.data['port'], 8765);
    });

    test('non-protocol lines are ignored, not errors', () {
      expect(GeminiMessage.decodeLine(''), isNull);
      expect(GeminiMessage.decodeLine('DeprecationWarning: x'), isNull);
      expect(GeminiMessage.decodeLine('{not json}'), isNull);
      expect(GeminiMessage.decodeLine('{"type":"ping"}'), isNull);
      expect(GeminiMessage.decodeLine('[1,2]'), isNull);
    });
  });

  group('GeminiRequest', () {
    test('encodes id, method, params and a trailing newline', () {
      const request = GeminiRequest(
        id: 'abc',
        method: 'bridge.status',
        params: {'x': 1},
      );
      final line = request.encode();
      expect(line.endsWith('\n'), isTrue);
      expect(jsonDecode(line.trim()), {
        'id': 'abc',
        'method': 'bridge.status',
        'params': {'x': 1},
      });
    });

    test('params default to an empty object, never absent', () {
      const request = GeminiRequest(id: 'a', method: 'status');
      expect(jsonDecode(request.encode())['params'], <String, Object?>{});
    });
  });

  group('GeminiFailure', () {
    test('maps every documented code', () {
      expect(GeminiFailure.fromCode('NO_TAB'), GeminiFailure.noTab);
      expect(
          GeminiFailure.fromCode('TAB_NOT_READY'), GeminiFailure.tabNotReady);
      expect(GeminiFailure.fromCode('SIGNED_OUT'), GeminiFailure.signedOut);
      expect(GeminiFailure.fromCode('ELEMENT_NOT_FOUND'),
          GeminiFailure.elementNotFound);
      expect(GeminiFailure.fromCode('GEMINI_ERROR'), GeminiFailure.geminiError);
      expect(GeminiFailure.fromCode('BUSY'), GeminiFailure.busy);
      expect(GeminiFailure.fromCode('TIMEOUT'), GeminiFailure.timeout);
      expect(GeminiFailure.fromCode('SEND_NOT_ACCEPTED'),
          GeminiFailure.sendNotAccepted);
      expect(GeminiFailure.fromCode('TYPE_FAILED'), GeminiFailure.typeFailed);
      expect(GeminiFailure.fromCode('MODEL_NOT_FOUND'),
          GeminiFailure.modelNotFound);
      expect(GeminiFailure.fromCode('BAD_PARAMS'), GeminiFailure.badParams);
      expect(GeminiFailure.fromCode('INTERNAL'), GeminiFailure.internal);
      expect(GeminiFailure.fromCode('EXTENSION_NOT_CONNECTED'),
          GeminiFailure.extensionNotConnected);
      expect(GeminiFailure.fromCode('ACCOUNT_NOT_FOUND'),
          GeminiFailure.accountNotFound);
      expect(
          GeminiFailure.fromCode('NO_SUGGESTION'), GeminiFailure.noSuggestion);
      expect(GeminiFailure.fromCode('ACTION_PARSE_FAILED'),
          GeminiFailure.actionParseFailed);
      // The old drafter's stop went with decision old-files.
      expect(GeminiFailure.fromCode('ACTION_STOPPED'), GeminiFailure.unknown);
      expect(GeminiFailure.fromCode('SKILL_FILE_MISSING'),
          GeminiFailure.skillFileMissing);
      expect(GeminiFailure.fromCode('SOMETHING_NEW'), GeminiFailure.unknown);
      expect(GeminiFailure.fromCode(null), GeminiFailure.unknown);
    });

    test('which failures are bridge problems', () {
      expect(GeminiFailure.actionParseFailed.isBridgeProblem, isFalse);
      expect(GeminiFailure.unavailable.isBridgeProblem, isTrue);
      expect(GeminiFailure.timeout.isBridgeProblem, isFalse);
    });
  });

  group('GeminiBridgeException', () {
    test('unavailable defaults its message when the interpreter said nothing',
        () {
      expect(GeminiBridgeException.unavailable('   ').message,
          'The Gemini bridge did not start.');
      expect(GeminiBridgeException.unavailable(' boom ').message, 'boom');
      expect(GeminiBridgeException.unavailable('x').failure,
          GeminiFailure.unavailable);
    });
  });

  group('GeminiBridgeStatus', () {
    test('parses the full connected shape', () {
      final status = GeminiBridgeStatus.fromJson({
        'listening': true,
        'port': 8765,
        'extensionConnected': true,
        'hello': {'extensionVersion': '0.1.0', 'port': 8765},
        'status': {
          'url': 'https://gemini.google.com/u/1/app/abc',
          'accountIndex': 1,
          'account': {'name': 'Moustafa', 'email': 'x@gmail.com'},
          'model': {'name': '2.5 Pro'},
          'generating': false,
          'signedOut': false,
          'pageError': null,
          'elements': {
            'newChat': {'found': true, 'strategy': 'testid'},
            'sendButton': {
              'found': false,
              'strategy': null,
              'note': 'prompt box empty',
            },
          },
          'queue': {'length': 2, 'paused': false, 'running': 'job_7'},
          'ready': true,
        },
      });
      expect(status.listening, isTrue);
      expect(status.port, 8765);
      expect(status.extensionConnected, isTrue);
      expect(status.extensionVersion, '0.1.0');
      final page = status.status!;
      expect(page.accountIndex, 1);
      expect(page.account!.label, 'Moustafa (x@gmail.com)');
      expect(page.modelName, '2.5 Pro');
      expect(page.elements['newChat']!.found, isTrue);
      expect(page.elements['sendButton']!.note, 'prompt box empty');
      expect(page.missingElements.map((e) => e.name), ['sendButton']);
      expect(page.queue.length, 2);
      expect(page.queue.running, 'job_7');
      expect(page.ready, isTrue);
      expect(status.statusError, isNull);
    });

    test('a daemon with no extension has a null status and a statusError', () {
      final status = GeminiBridgeStatus.fromJson({
        'listening': true,
        'port': 8765,
        'extensionConnected': false,
        'hello': null,
        'status': null,
        'statusError': {
          'code': 'EXTENSION_NOT_CONNECTED',
          'message': 'no extension is connected',
        },
      });
      expect(status.status, isNull);
      expect(status.hello, isEmpty);
      expect(status.statusError!.failure, GeminiFailure.extensionNotConnected);
    });

    test('an empty object parses to defaults', () {
      final status = GeminiBridgeStatus.fromJson(const {});
      expect(status.listening, isFalse);
      expect(status.port, isNull);
      expect(status.status, isNull);
    });

    test('a page error object and a plain model string both read', () {
      final page = GeminiPageStatus.fromJson({
        'pageError': {'text': 'Something went wrong', 'source': 'toast'},
        'model': 'Flash',
        'elements': 'not a map',
      });
      expect(page.pageError, 'Something went wrong');
      expect(page.modelName, 'Flash');
      expect(page.elements, isEmpty);
    });
  });

  group('GeminiDiagnostics', () {
    final sample = <String, Object?>{
      'url': 'https://gemini.google.com/app',
      'title': 'Gemini',
      'readyState': 'complete',
      'extensionVersion': '0.1.0',
      'at': 1758290000000,
      'signedOut': false,
      'pageError': null,
      'elements': {
        'textarea': {
          'found': true,
          'strategy': 'css#1',
          'tried': [
            {'strategy': 'css#1', 'matched': 1, 'visible': 1},
          ],
          'element': {'tag': 'div', 'classes': 'ql-editor textarea'},
        },
        'newChat': {
          'found': false,
          'strategy': null,
          'tried': [
            {'strategy': 'css#1', 'matched': 0, 'visible': 0},
            {
              'strategy': 'attr#2',
              'matched': 2,
              'visible': 0,
              'describe': 'attr aria-label ~ /^new chat/'
            },
            'text#4',
          ],
          'lastKnown': {
            'strategy': 'css#1',
            'element': {'tag': 'button', 'testId': 'new-chat-button'},
            'at': 1758200000000,
            'url': 'https://gemini.google.com/app',
          },
          'candidates': [
            {
              'summary': {'tag': 'button', 'aria': 'New conversation'},
              'score': 0.9,
              'why': 'aria matches new',
            },
            {'tag': 'a', 'text': 'New chat'},
          ],
          'suggestions': [
            {
              'strategy': {
                'type': 'attr',
                'attr': 'aria-label',
                'match': '^new conversation',
                'tags': ['button'],
              },
              'candidate': {'tag': 'button'},
              'score': 0.9,
            },
            {'type': 'css', 'value': 'button.new-chat', 'reason': 'class'},
          ],
        },
      },
      'overrides': {'newChat': []},
      'page': {
        'buttons': 42,
        'customElements': ['rich-textarea', 'model-response'],
        'customElementsAdded': ['new-thing'],
        'customElementsRemoved': [],
      },
    };

    test('parses per-element found/tried/lastKnown/candidates/suggestions', () {
      final diag = GeminiDiagnostics.fromJson(sample);
      expect(diag.url, 'https://gemini.google.com/app');
      expect(diag.at,
          DateTime.fromMillisecondsSinceEpoch(1758290000000, isUtc: true));
      expect(diag.at!.isUtc, isTrue);
      expect(diag.missingElements.map((e) => e.name), ['newChat']);

      final textarea = diag.elements['textarea']!;
      expect(textarea.found, isTrue);
      expect(textarea.strategy, 'css#1');
      expect(textarea.element['tag'], 'div');

      final newChat = diag.elements['newChat']!;
      expect(newChat.found, isFalse);
      expect(newChat.tried.length, 3);
      expect(newChat.tried[1].matched, 2);
      expect(newChat.tried[1].visible, 0);
      expect(newChat.tried[1].describe, 'attr aria-label ~ /^new chat/');
      // A bare string entry survives as a strategy name.
      expect(newChat.tried[2].strategy, 'text#4');
      expect(newChat.lastKnown!.strategy, 'css#1');
      expect(newChat.lastKnown!.element['testId'], 'new-chat-button');
      expect(newChat.lastKnown!.at, isNotNull);
      expect(newChat.candidates.length, 2);
      expect(newChat.candidates[0].score, 0.9);
      expect(newChat.candidates[0].why, 'aria matches new');
      // A bare summary is the summary.
      expect(newChat.candidates[1].summary['tag'], 'a');
      expect(newChat.suggestions.length, 2);
      expect(newChat.suggestions[0].strategy['type'], 'attr');
      expect(newChat.suggestions[0].score, 0.9);
      // A bare strategy is the strategy.
      expect(newChat.suggestions[1].strategy['value'], 'button.new-chat');
      expect(newChat.suggestions[1].reason, 'class');

      expect(diag.page.buttons, 42);
      expect(diag.page.customElementsAdded, ['new-thing']);
      expect(diag.page.changed, isTrue);
      expect(diag.overrides.keys, ['newChat']);
    });

    test('rawJson is the object as received', () {
      final diag = GeminiDiagnostics.fromJson(sample);
      expect(jsonDecode(diag.rawJson), sample);
    });

    test('tolerates nulls everywhere', () {
      final diag = GeminiDiagnostics.fromJson({
        'elements': {
          'newChat': {
            'found': null,
            'tried': null,
            'lastKnown': null,
            'candidates': null,
            'suggestions': [null, 3, 'x'],
          },
          'weird': null,
        },
        'page': null,
        'at': 'not a number',
      });
      final newChat = diag.elements['newChat']!;
      expect(newChat.found, isFalse);
      expect(newChat.tried, isEmpty);
      expect(newChat.lastKnown, isNull);
      expect(newChat.suggestions, isEmpty);
      expect(diag.elements['weird']!.found, isFalse);
      expect(diag.page.customElements, isEmpty);
      expect(diag.at, isNull);
    });
  });

  group('GeminiHealResult', () {
    test('parses the applied strategy and the remaining suggestions', () {
      final result = GeminiHealResult.fromJson({
        'element': 'newChat',
        'strategy': {'type': 'css', 'value': 'button.x'},
        'suggestions': [
          {'type': 'css', 'value': 'button.y'},
        ],
      });
      expect(result.element, 'newChat');
      expect(result.strategy['value'], 'button.x');
      expect(result.suggestions.single.describe, "css 'button.y'");
    });
  });

  group('describeStrategy / describeElement', () {
    test('match the CLI wording', () {
      expect(describeStrategy({'type': 'css', 'value': 'button.a'}),
          "css 'button.a'");
      expect(
        describeStrategy({
          'type': 'attr',
          'attr': 'aria-label',
          'match': '^new chat',
          'tags': ['button', 'a'],
        }),
        'attr aria-label ~ /^new chat/ on button, a',
      );
      expect(
        describeStrategy({
          'type': 'icon',
          'match': '^send\$',
          'climb': 'button',
          'within': 'nav',
          'name': 'icon#4',
        }),
        "[icon#4] icon ~ /^send\$/ climb 'button' within 'nav'",
      );
      expect(describeStrategy({'type': 'fn', 'name': 'largestContentEditable'}),
          'fn largestContentEditable');
      expect(describeStrategy(null), '?');
      expect(describeStrategy('css#1'), 'css#1');
    });

    test('describeElement summarises tag, id, classes, attributes and rect',
        () {
      final line = describeElement({
        'tag': 'button',
        'id': 'nc',
        'classes': 'a b c d e',
        'testId': 'new-chat-button',
        'aria': 'New chat',
        'text': 'New chat',
        'rect': {'x': 1, 'y': 2, 'w': 30, 'h': 40},
        'path': 'body > nav > button',
      });
      expect(line.split('\n').first,
          "button#nc.a.b.c.d … testId='new-chat-button' aria='New chat' text='New chat' @1,2 30x40");
      expect(line.split('\n').last, 'body > nav > button');
      expect(describeElement(null), '?');
      expect(describeElement({}), '?');
    });
  });

  group('the small results', () {
    test('KeywordsResult', () {
      final result = KeywordsResult.fromJson({
        'keywords': ['a', ' b ', '', null, 3],
        'dropped': 2,
        'raw': 'a\nb',
        'model': 'Flash',
      });
      expect(result.keywords, ['a', 'b']);
      expect(result.dropped, 2);
      expect(KeywordsResult.fromJson(const {}).keywords, isEmpty);
    });

    test('ClassifyResult', () {
      final result = ClassifyResult.fromJson({
        'niche': 'AI tools',
        'audience': 'devs',
        'language': 'en',
        'brandFit': 4,
        'reasons': ['r'],
        'redFlags': [],
      });
      expect(result.niche, 'AI tools');
      expect(result.brandFit, 4);
      expect(result.reasons, ['r']);
      expect(result.redFlags, isEmpty);
    });

    test('GeminiJob', () {
      final job = GeminiJob.fromJson({
        'id': 'job_7',
        'prompt': 'p',
        'status': 'done',
        'result': {'text': 'answer', 'durationMs': 12},
        'error': null,
        'createdAt': 1758290000000,
        'startedAt': null,
        'finishedAt': 1758290001000,
        'attempts': 1,
      });
      expect(job.id, 'job_7');
      expect(job.isFinished, isTrue);
      expect(job.text, 'answer');
      expect(job.error, isNull);
      expect(job.startedAt, isNull);
      expect(job.finishedAt!.isAfter(job.createdAt!), isTrue);

      final failed = GeminiJob.fromJson({
        'id': 'job_8',
        'status': 'error',
        'error': {'code': 'TIMEOUT', 'message': 't'},
      });
      expect(failed.error!.failure, GeminiFailure.timeout);
      expect(failed.text, isNull);
    });

    test('GeminiAccount', () {
      expect(GeminiAccount.fromJson({'name': 'N'})!.label, 'N');
      expect(GeminiAccount.fromJson({'email': 'e@x'})!.label, 'e@x');
      expect(GeminiAccount.fromJson({})!.isEmpty, isTrue);
      expect(GeminiAccount.fromJson(null), isNull);
    });
  });

  group('lenient readers', () {
    test('asInt / asDouble / asString / asStringList / asEpochMillis', () {
      expect(asInt(3), 3);
      expect(asInt(3.7), 3);
      expect(asInt('4'), 4);
      expect(asInt('x'), isNull);
      expect(asDouble(1), 1.0);
      expect(asDouble('0.5'), 0.5);
      expect(asString('  a '), 'a');
      expect(asString('   '), isNull);
      expect(asString(1), isNull);
      expect(asStringList('one'), ['one']);
      expect(asStringList(['a', 1, null, ' b']), ['a', 'b']);
      expect(asEpochMillis(0), DateTime.utc(1970));
      expect(
          asEpochMillis('2026-09-19T10:00:00Z'), DateTime.utc(2026, 9, 19, 10));
      expect(asEpochMillis(null), isNull);
    });
  });
}
