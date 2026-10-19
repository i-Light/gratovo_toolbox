// The Comms queue's two daemon actions (pipeline/gemini_bridge/actions.py):
// comms_propose builds the live case and asks the engine; comms_check checks
// edited text again without Gemini.
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/comms_protocol.dart';

import '../../support/fake_gemini_bridge.dart';

void main() {
  test('a request carries what to write and who for', () {
    const request = CommsRequest(
      kind: CommsKind.followUp,
      threadId: 't1',
      followUpNumber: 2,
      steer: {'english': 'nonnative'},
      note: 'They sell a course too.',
      cashOffer: true,
    );

    expect(request.toJson(), {
      'kind': 'followUp',
      'threadId': 't1',
      'followUpNumber': 2,
      'steer': {'english': 'nonnative', 'note': 'They sell a course too.'},
      'cashOffer': true,
    });
  });

  test('a brand pitch names its contact and the creators pitched', () {
    const request = CommsRequest(
      kind: CommsKind.first,
      brandId: 'b1',
      contactEmail: 'jack@runway.ml',
      pitchChannelIds: ['UC_a'],
    );

    expect(request.toJson(), {
      'kind': 'first',
      'brandId': 'b1',
      'contactEmail': 'jack@runway.ml',
      'pitchChannelIds': ['UC_a'],
    });
  });

  test('the engine\x27s answer is read whole', () {
    final result = CommsProposalResult.fromJson(const {
      'status': 'needs_human',
      'proposal': {
        'situation': {
          'side': 'influencer',
          'stage': 'replied',
          'reply_type': 'inf.asks_price_from_us',
          'summary': 'They asked what we pay.',
        },
        'decision': {
          'action': 'send_message',
          'why': 'Ask their rate first.',
          'rules': ['INF-PRICE-09', 'FND-WRITE-13'],
        },
        'message': {'subject': 'Re: hi', 'body': 'What do you charge?'},
        'needs_human': [
          {'what': 'price', 'detail': 'confirm the budget'}
        ],
        'follow_up': {'in_working_days': 2},
      },
      'findings': [
        {
          'code': 'NEEDY',
          'severity': 'warn',
          'rule': 'INF-NEG-07',
          'detail': 'x'
        }
      ],
      'gates': [
        {'what': 'price', 'detail': 'the message names a price'}
      ],
      'case': {'side': 'influencer', 'stage': 'replied', 'goal': 'Decide'},
      'moments': [
        {'at': '7:40', 'quote': 'it took 41 minutes'}
      ],
      'model': 'Argon',
    });

    expect(result.status, CommsEngineStatus.needsHuman);
    expect(result.subject, 'Re: hi');
    expect(result.body, 'What do you charge?');
    expect(result.action, 'send_message');
    expect(result.why, 'Ask their rate first.');
    expect(result.rules, ['INF-PRICE-09', 'FND-WRITE-13']);
    expect(result.situation['reply_type'], 'inf.asks_price_from_us');
    expect(result.followUpDays, 2);
    expect(result.gates.single.what, 'price');
    expect(result.needsHuman.single.detail, 'confirm the budget');
    expect(result.findings.single.blocking, isFalse);
    expect(result.moments.single['at'], '7:40');
    expect(result.hasMessage, isTrue);
  });

  test('a refused case has no message and says why', () {
    final result = CommsProposalResult.fromJson(const {
      'status': 'blocked',
      'proposal': null,
      'findings': [
        {
          'code': 'HC09_BOYCOTT',
          'severity': 'block',
          'rule': 'HC-09',
          'detail': 'the brand is on the boycott list'
        }
      ],
    });

    expect(result.status, CommsEngineStatus.blocked);
    expect(result.hasMessage, isFalse);
    expect(result.findings.single.blocking, isTrue);
  });

  test('the bridge asks the daemon for a proposal, with a long deadline',
      () async {
    final bridge = FakeGeminiBridge()
      ..answer('action.comms_propose', const {'status': 'no_message'});

    final result = await bridge.commsPropose(
        const CommsRequest(kind: CommsKind.reply, threadId: 't1'));

    expect(result.status, CommsEngineStatus.noMessage);
    final call = bridge.calls.single;
    expect(call.method, 'action.comms_propose');
    expect(call.params['request'], {'kind': 'reply', 'threadId': 't1'});
    expect(call.timeout!.inMinutes, greaterThanOrEqualTo(10));
  });

  test('edited text is checked by the daemon without Gemini', () async {
    final bridge = FakeGeminiBridge()
      ..answer('action.comms_check', const {
        'findings': [],
        'gates': [
          {'what': 'price', 'detail': 'names a price'}
        ],
        'blocking': false,
      });

    final check = await bridge.commsCheck(
      const CommsRequest(kind: CommsKind.reply, threadId: 't1'),
      subject: 'Re: hi',
      body: 'We can pay \$500.',
    );

    expect(check.blocking, isFalse);
    expect(check.gates.single.what, 'price');
    expect(bridge.calls.single.params['body'], 'We can pay \$500.');
    expect(bridge.prepareCount, 0, reason: 'no Gemini page is needed');
  });
}
