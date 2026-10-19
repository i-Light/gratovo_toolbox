import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';

/// Parsing the mailbox tool's output.
///
/// Worth its own suite because the input is a subprocess's stdout, which is
/// not a clean channel: an interpreter is entitled to print a
/// `DeprecationWarning`, a proxy banner or a traceback around the one line
/// this app asked for. Every case below is something that has to survive that,
/// and none of them needs Python, a mailbox or a network to check.
void main() {
  group('decodeToolOutput', () {
    test('finds the JSON line among library noise', () {
      const output = '''
DeprecationWarning: pkg_resources is deprecated as an API
  from pkg_resources import parse_version
{"ok": true, "command": "status", "configured": true}
''';
      final json = decodeToolOutput(output);
      expect(json, isNotNull);
      expect(json!['command'], 'status');
    });

    test('takes the LAST JSON object when something printed one first', () {
      const output = '{"ok": false, "stale": true}\n{"ok": true, "n": 2}';
      expect(decodeToolOutput(output)!['n'], 2);
    });

    test('answers null when nothing parses', () {
      expect(decodeToolOutput('Traceback (most recent call last):'), isNull);
      expect(decodeToolOutput(''), isNull);
      expect(decodeToolOutput('{not json}'), isNull);
    });
  });

  group('parseToolOutcome', () {
    test('a crash becomes an unavailable failure naming the last line', () {
      const output = 'Traceback...\nModuleNotFoundError: No module named x';
      final outcome = parseToolOutcome(output, GmailStatus.fromJson);

      expect(outcome.succeeded, isFalse);
      expect(outcome.error!.failure, GmailFailure.unavailable);
      expect(outcome.error!.message, contains('ModuleNotFoundError'));
      // The raw output is kept only on a failure — it is the difference
      // between a debuggable report and "it didn't work".
      expect(outcome.rawOutput, output);
    });

    test('a reported failure keeps its code, so the UI can offer a fix', () {
      final outcome = parseToolOutcome(
        jsonEncode({
          'ok': false,
          'error': {'code': 'auth_failed', 'message': 'Token lapsed.'},
        }),
        GmailStatus.fromJson,
      );

      expect(outcome.error!.failure, GmailFailure.authFailed);
      expect(outcome.error!.failure.isFixedByReconnecting, isTrue);
      expect(outcome.error!.message, 'Token lapsed.');
    });

    test('an unconfigured machine is a failure that reconnecting fixes', () {
      final outcome = parseToolOutcome(
        jsonEncode({
          'ok': false,
          'error': {'code': 'not_configured', 'message': 'None here.'},
        }),
        GmailStatus.fromJson,
      );
      expect(outcome.error!.failure, GmailFailure.notConfigured);
      expect(outcome.error!.failure.isFixedByReconnecting, isTrue);
    });

    test('a missing dependency is its own case, with its own fix', () {
      final outcome = parseToolOutcome(
        jsonEncode({
          'ok': false,
          'error': {'code': 'dependency_missing', 'message': 'pip install'},
        }),
        GmailStatus.fromJson,
      );
      expect(outcome.error!.failure, GmailFailure.dependencyMissing);
      expect(outcome.error!.failure.isFixedByReconnecting, isFalse,
          reason: 'reconnecting a mailbox does not install a Python package');
    });

    test('an unrecognized code degrades rather than throwing', () {
      final outcome = parseToolOutcome(
        jsonEncode({
          'ok': false,
          'error': {'code': 'something_new', 'message': 'From a later tool.'},
        }),
        GmailStatus.fromJson,
      );
      expect(outcome.error!.failure, GmailFailure.unknown);
      expect(outcome.error!.message, 'From a later tool.');
    });
  });

  group('GmailStatus', () {
    test('a connected mailbox may send and carries its counters', () {
      final status = GmailStatus.fromJson({
        'configured': true,
        'label': 'Gratovo Outreach',
        'accounts': [
          {
            'account': 'outreach@gratovo.test',
            'connected': true,
            'counters': {
              'sent': 12,
              'awaitingReply': 5,
              'pendingSteps': 7,
              'dueSteps': 2,
              'failedSteps': 1,
            },
          },
        ],
      });

      expect(status.canSend, isTrue);
      expect(status.account, 'outreach@gratovo.test');
      expect(status.counters.sent, 12);
      expect(status.counters.dueSteps, 2);
      expect(status.counters.failedSteps, 1);
    });

    test('configured but not connected cannot send — the lapsed-token case',
        () {
      final status = GmailStatus.fromJson({
        'configured': true,
        'accounts': [
          {
            'account': 'outreach@gratovo.test',
            'connected': false,
            'error': {'code': 'auth_failed', 'message': 'invalid_grant'},
          },
        ],
      });

      expect(status.configured, isTrue);
      expect(status.canSend, isFalse);
      expect(status.error!.failure, GmailFailure.authFailed);
    });

    test(
        'nothing configured at all is a machine-wide error, not a per-account one',
        () {
      final status = GmailStatus.fromJson({
        'configured': false,
        'error': {'code': 'not_configured', 'message': 'None here.'},
      });

      expect(status.configured, isFalse);
      expect(status.canSend, isFalse);
      expect(status.accounts, isEmpty);
      expect(status.error!.failure, GmailFailure.notConfigured);
    });

    test('missing counters read as zero rather than throwing', () {
      final status = GmailStatus.fromJson({
        'accounts': [
          {'account': 'a@b.c', 'connected': true},
        ],
      });
      expect(status.counters.sent, 0);
      expect(status.counters.pendingSteps, 0);
    });

    test(
        'several accounts: canSend if ANY can, counters are the total across all',
        () {
      final status = GmailStatus.fromJson({
        'configured': true,
        'accounts': [
          {
            'account': 'one@gratovo.test',
            'connected': false,
            'error': {'code': 'auth_failed', 'message': 'invalid_grant'},
          },
          {
            'account': 'two@gratovo.test',
            'connected': true,
            'counters': {'sent': 3, 'pendingSteps': 2},
          },
        ],
      });

      expect(status.accounts, hasLength(2));
      expect(status.canSend, isTrue,
          reason: 'one lapsed account must not hide that another can send');
      expect(status.counters.sent, 3);
      expect(status.counters.pendingSteps, 2);
      // The connected one is what "the" mailbox means to a caller that
      // hasn't picked one — not necessarily the first in the list.
      expect(status.account, 'two@gratovo.test');
    });

    test(
        'an unnamed connected mailbox is what a caller with more than one ambiguous account gets told about',
        () {
      final outcome = parseToolOutcome(
        jsonEncode({
          'ok': false,
          'error': {
            'code': 'ambiguous_account',
            'message': 'pass --account ADDRESS',
          },
        }),
        GmailStatus.fromJson,
      );
      expect(outcome.error!.failure, GmailFailure.ambiguousAccount);
      expect(outcome.error!.failure.isFixedByReconnecting, isFalse,
          reason: 'the fix is picking an account, not reconnecting one');
    });
  });

  group('GmailLimits', () {
    // House choices HC-02 (daily cap per mailbox) and HC-03 (warm-up).
    test('a mailbox reports its cap, what is left today and its warm-up', () {
      final entry = GmailAccountStatus.fromJson({
        'account': 'outreach@gratovo.test',
        'connected': true,
        'limits': {
          'dailyCap': 12,
          'sentToday': 3,
          'leftToday': 9,
          'warmupStartedOn': '2026-10-01',
        },
      });

      final limits = entry.limits!;
      expect(limits.dailyCap, 12);
      expect(limits.sentToday, 3);
      expect(limits.leftToday, 9);
      expect(limits.warmupStartedOn, DateTime(2026, 10, 1));
      expect(limits.warmupDays(DateTime(2026, 10, 18, 9)), 17);
      expect(limits.warmedEnough(DateTime(2026, 10, 18)), isTrue);
      expect(limits.warmedEnough(DateTime(2026, 10, 10)), isFalse,
          reason: '14 days is the minimum');
    });

    test('an older tool that reports no limits leaves them unknown', () {
      final entry = GmailAccountStatus.fromJson(
          {'account': 'outreach@gratovo.test', 'connected': true});
      expect(entry.limits, isNull);
    });

    test('a mailbox with no warm-up date has no day count', () {
      const limits = GmailLimits(dailyCap: 35, sentToday: 0, leftToday: 35);
      expect(limits.warmupDays(DateTime(2026, 10, 18)), isNull);
      expect(limits.warmedEnough(DateTime(2026, 10, 18)), isFalse);
    });

    test('a send over the cap is its own failure', () {
      expect(GmailFailure.fromCode('daily_cap_reached'),
          GmailFailure.dailyCapReached);
    });

    test('saving limits merges into the mailboxes map of this machine', () {
      final merged = mergeMailboxLimits(
        {
          'auto_clean': {'x': 1},
          'mailboxes': {
            'other@gratovo.test': {'daily_cap': 20},
          },
        },
        'Outreach@Gratovo.test',
        dailyCap: 80,
        warmupStartedOn: DateTime(2026, 10, 1),
      );

      expect(merged['auto_clean'], {'x': 1});
      expect(merged['mailboxes'], {
        'other@gratovo.test': {'daily_cap': 20},
        'outreach@gratovo.test': {
          'daily_cap': 50,
          'warmup_started_on': '2026-10-01',
        },
      });
    });

    test('clearing the warm-up date removes it', () {
      final merged = mergeMailboxLimits(
        {
          'mailboxes': {
            'outreach@gratovo.test': {
              'daily_cap': 30,
              'warmup_started_on': '2026-10-01',
            },
          },
        },
        'outreach@gratovo.test',
        dailyCap: 5,
        warmupStartedOn: null,
      );
      expect(merged['mailboxes'], {
        'outreach@gratovo.test': {'daily_cap': 10},
      });
    });
  });

  group('GmailSweep', () {
    test('reads replies, auto-sends and failures out of one payload', () {
      final sweep = GmailSweep.fromJson({
        'account': 'outreach@gratovo.test',
        'checked': 4,
        'replies': [
          {
            'conversationKey': 'thread_1',
            'channelId': 'UC123',
            'messageId': 'r1',
            'from': 'creator@example.com',
            'fromName': 'A Creator',
            'subject': 'Re: Collab',
            'body': 'Interested!',
            'receivedAt': '2026-09-04T10:00:00Z',
            'isFirstReply': true,
            'cancelledFollowUps': 2,
          },
        ],
        'sent': [
          {
            'conversationKey': 'thread_2',
            'messageId': 'm9',
            'stepNo': 1,
            'subject': 'Re: Collab',
            'body': 'Just checking in.',
            'sentAt': '2026-09-04T09:00:00Z',
          },
        ],
        'failed': [
          {
            'conversationKey': 'thread_3',
            'stepNo': 2,
            'error': 'Gmail is unavailable',
            'givenUp': false,
          },
        ],
      });

      expect(sweep.checked, 4);
      expect(sweep.replies.single.isFirstReply, isTrue);
      expect(sweep.replies.single.cancelledFollowUps, 2);
      expect(sweep.replies.single.displayName, 'A Creator');
      expect(sweep.autoSent.single.stepNo, 1);
      expect(sweep.failures.single.message, 'Gmail is unavailable');
    });

    test('only a given-up failure is worth interrupting somebody about', () {
      final sweep = GmailSweep.fromJson({
        'failed': [
          {'conversationKey': 'a', 'stepNo': 1, 'error': 'x', 'givenUp': false},
          {'conversationKey': 'b', 'stepNo': 1, 'error': 'y', 'givenUp': true},
        ],
      });

      expect(sweep.failures, hasLength(2));
      expect(sweep.permanentFailures.single.conversationKey, 'b');
    });

    test('a nameless reply falls back to the address', () {
      final reply = GmailReply.fromJson({
        'conversationKey': 't',
        'messageId': 'r',
        'from': 'creator@example.com',
      });
      expect(reply.displayName, 'creator@example.com');
    });

    test('timestamps are read as UTC, never as local time', () {
      final reply = GmailReply.fromJson({
        'conversationKey': 't',
        'messageId': 'r',
        'receivedAt': '2026-09-04T10:00:00Z',
      });
      expect(reply.receivedAt.isUtc, isTrue);
      expect(reply.receivedAt, DateTime.utc(2026, 9, 4, 10));
    });

    test('an empty sweep is recognisable as one', () {
      expect(GmailSweep.fromJson(const {}).isEmpty, isTrue);
    });
  });

  group('GmailSendRequest', () {
    test('carries the thread id as the conversation key', () {
      final json = const GmailSendRequest(
        conversationKey: 'thread_1',
        channelId: 'UC123',
        to: 'creator@example.com',
        subject: 'Collab',
        body: 'Hello.',
      ).toJson();

      expect(json['conversationKey'], 'thread_1');
      expect(json['channelId'], 'UC123');
      expect(json.containsKey('followUps'), isFalse,
          reason: 'nothing is armed behind a send');
      expect(json.containsKey('labels'), isFalse,
          reason: 'no labels means the parent label only — the key is absent');
    });

    test('sub-label paths travel under the "labels" key', () {
      final json = const GmailSendRequest(
        conversationKey: 'thread_1',
        to: 'creator@example.com',
        body: 'Hello.',
        labels: ['Influencers', 'Stage/Contacted'],
      ).toJson();

      expect(json['labels'], ['Influencers', 'Stage/Contacted']);
    });

    test('the payload round-trips through JSON unharmed', () {
      const request = GmailSendRequest(
        conversationKey: 'thread_1',
        to: 'creator@example.com',
        subject: 'Collab — "quick" idea',
        body: 'Line one\nLine two\n\nAll the best 👋',
      );
      final decoded =
          jsonDecode(jsonEncode(request.toJson())) as Map<String, Object?>;

      expect(decoded['body'], 'Line one\nLine two\n\nAll the best 👋');
      expect(decoded['subject'], 'Collab — "quick" idea');
    });
  });
}
