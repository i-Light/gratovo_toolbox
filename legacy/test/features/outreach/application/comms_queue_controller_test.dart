// The Comms queue (plan step 6): items to answer, drafted by the engine on a
// person's click, and sent only by a person — edited text checked again, the
// gates confirmed first.
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/native/comms_protocol.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/agency_settings.dart';
import 'package:gratovo_toolbox/data/models/comms_proposal.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_agency_settings_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_comms_proposal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/comms_queue_controller.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';

import '../../../support/fake_gemini_bridge.dart';
import '../../../support/fake_gmail_gateway.dart';

const _ready = {
  'status': 'ready',
  'proposal': {
    'situation': {'side': 'influencer', 'stage': 'replied'},
    'decision': {
      'action': 'send_message',
      'why': 'Ask their rate first.',
      'rules': ['INF-PRICE-09'],
    },
    'message': {'subject': 'Re: your test', 'body': 'What do you charge?'},
    'needs_human': [],
  },
  'gates': [],
  'findings': [],
};

/// The thread log, able to fail the way a busy shared database does.
class _FlakyOutreach extends MockOutreachRepository {
  bool failRecording = false;

  @override
  Future<OutreachMessage> recordMessage({
    required String threadId,
    required MessageDirection direction,
    required String subject,
    required String body,
    ContactMethod method = ContactMethod.email,
    String? peerAddress,
    DateTime? at,
    bool isAiDrafted = false,
    String? templateId,
  }) {
    if (failRecording) throw StateError('database is locked');
    return super.recordMessage(
      threadId: threadId,
      direction: direction,
      subject: subject,
      body: body,
      method: method,
      peerAddress: peerAddress,
      at: at,
      isAiDrafted: isAiDrafted,
      templateId: templateId,
    );
  }
}

class _World {
  final bridge = FakeGeminiBridge();
  final gmail = FakeGmailGateway();
  final proposals = MockCommsProposalRepository();
  final outreach = _FlakyOutreach();
  final influencers = MockInfluencerRepository();
  final agency = MockAgencySettingsRepository();
  late final ProviderContainer container;

  Future<void> start() async {
    influencers.replaceAllForTesting([
      Influencer(
        id: 'UC_sam',
        handle: '@sam',
        channelUrl: '',
        platform: InfluencerPlatform.youtube,
        subscriberCount: 100000,
        sourceKeywords: const [],
        vettingStatus: VettingStatus.shortlisted,
        discoveredAt: DateTime(2026),
        contacts: const [
          InfluencerContact(
              method: ContactMethod.email,
              value: 'sam@sam.tv',
              isPrimary: true),
        ],
      ),
    ]);
    await agency.save(const AgencySettings(dailyTarget: 50));
    container = ProviderContainer(overrides: [
      supabaseBootProvider.overrideWithValue(const SupabaseBoot(
        config: SupabaseConfig(url: '', anonKey: ''),
        error: 'no server configured in this test',
      )),
      geminiBridgeProvider.overrideWithValue(bridge),
      gmailGatewayProvider.overrideWithValue(gmail),
      commsProposalRepositoryProvider.overrideWithValue(proposals),
      outreachRepositoryProvider.overrideWithValue(outreach),
      influencerRepositoryProvider.overrideWithValue(influencers),
      agencySettingsRepositoryProvider.overrideWithValue(agency),
      reminderRepositoryProvider.overrideWithValue(MockReminderRepository()),
    ]);
    addTearDown(container.dispose);
  }

  CommsQueueController get queue => container.read(commsQueueProvider.notifier);

  /// Every send is checked again first; this check finds nothing.
  void checksPass() => bridge.answer('action.comms_check', const {
        'blocking': false,
        'findings': [],
        'gates': [],
      });

  Future<CommsQueueView> view() => container.read(commsQueueProvider.future);

  /// Sam wrote back: a thread whose last message is theirs.
  Future<OutreachThread> samReplied() async {
    final thread = await outreach.getOrCreateThreadForInfluencer('UC_sam');
    await outreach.recordMessage(
        threadId: thread.id,
        direction: MessageDirection.outbound,
        subject: 'Your test',
        body: 'Hi Sam');
    await outreach.recordMessage(
        threadId: thread.id,
        direction: MessageDirection.inbound,
        subject: 'Re: your test',
        body: 'What do you pay?');
    await outreach.updateThreadStatus(thread.id, ThreadStatus.replied);
    return thread;
  }
}

void main() {
  test('a reply waiting on us is an item, and drafting it saves a proposal',
      () async {
    final world = _World();
    await world.start();
    final thread = await world.samReplied();
    world.bridge.answer('action.comms_propose', _ready);

    final before = await world.view();
    final item = before.replies.single;
    expect(item.request.threadId, thread.id);
    expect(item.title, '@sam');
    expect(item.detail, contains('What do you pay?'));

    final proposal = await world.queue.draft(item.request);

    expect(proposal.status, CommsQueueStatus.proposed);
    expect(proposal.body, 'What do you charge?');
    final after = await world.view();
    expect(after.replies, isEmpty, reason: 'the item is now its proposal');
    expect(after.proposals.single.id, proposal.id);
  });

  test('a ready proposal goes out through the mailbox and is recorded',
      () async {
    final world = _World();
    await world.start();
    final thread = await world.samReplied();
    world.bridge.answer('action.comms_propose', _ready);
    world.checksPass();
    final proposal = await world.queue
        .draft(CommsRequest(kind: CommsKind.reply, threadId: thread.id));

    final result = await world.queue
        .send(proposal, subject: proposal.subject, body: proposal.body);

    expect(result, isA<CommsSent>());
    expect(world.gmail.sent.single.to, 'sam@sam.tv');
    expect(world.gmail.sent.single.conversationKey, thread.id);
    final messages = await world.outreach.getMessages(thread.id);
    expect(messages.last.body, 'What do you charge?');
    expect((await world.proposals.getById(proposal.id))!.status,
        CommsQueueStatus.sent);
    expect((await world.view()).sentToday, greaterThanOrEqualTo(1));
  });

  test('gates are confirmed by a person before anything goes', () async {
    final world = _World();
    await world.start();
    final thread = await world.samReplied();
    world.bridge.answer('action.comms_propose', {
      ..._ready,
      'gates': [
        {'what': 'price', 'detail': 'the message names a price'}
      ],
    });
    world.checksPass();
    final proposal = await world.queue
        .draft(CommsRequest(kind: CommsKind.reply, threadId: thread.id));

    final first = await world.queue
        .send(proposal, subject: proposal.subject, body: proposal.body);
    expect(first, isA<CommsNeedsConfirmation>());
    expect((first as CommsNeedsConfirmation).gates.single.what, 'price');
    expect(world.gmail.sent, isEmpty);

    final second = await world.queue.send(proposal,
        subject: proposal.subject, body: proposal.body, gatesConfirmed: true);
    expect(second, isA<CommsSent>());
  });

  test('edited text is checked again, and a blocking finding stops it',
      () async {
    final world = _World();
    await world.start();
    final thread = await world.samReplied();
    world.bridge
      ..answer('action.comms_propose', _ready)
      ..answer('action.comms_check', const {
        'blocking': true,
        'findings': [
          {
            'code': 'SPAM_WORD',
            'severity': 'block',
            'rule': 'FND-WRITE-12',
            'detail': "uses 'guaranteed'"
          }
        ],
        'gates': [],
      });
    final proposal = await world.queue
        .draft(CommsRequest(kind: CommsKind.reply, threadId: thread.id));

    final result = await world.queue
        .send(proposal, subject: proposal.subject, body: 'A guaranteed deal!');

    expect(result, isA<CommsBlocked>());
    expect((result as CommsBlocked).findings.single.rule, 'FND-WRITE-12');
    expect(world.bridge.calls.last.params['body'], 'A guaranteed deal!');
    expect(world.gmail.sent, isEmpty);
  });

  // Unedited text is checked too (final review I4): the engine may leave a
  // placeholder for a person to fill, and a confirmation must not send it.
  test(
      'unedited text is checked again before it goes, and a placeholder '
      'left in stops it', () async {
    final world = _World();
    await world.start();
    final thread = await world.samReplied();
    world.bridge
      ..answer('action.comms_propose', {
        ..._ready,
        'proposal': {
          ...(_ready['proposal']! as Map<String, Object?>),
          'message': {
            'subject': 'Re: your test',
            'body': 'Thanks!\n\n[Your name]',
          },
          'needs_human': [
            {'what': 'fact_missing', 'detail': 'fill in your name'}
          ],
        },
      })
      ..answer('action.comms_check', const {
        'blocking': true,
        'findings': [
          {
            'code': 'PLACEHOLDER',
            'severity': 'block',
            'rule': 'APP-SEND',
            'detail': "fill in '[Your name]' before sending"
          }
        ],
        'gates': [],
      });
    final proposal = await world.queue
        .draft(CommsRequest(kind: CommsKind.reply, threadId: thread.id));

    final result = await world.queue.send(proposal,
        subject: proposal.subject, body: proposal.body, gatesConfirmed: true);

    expect(result, isA<CommsBlocked>());
    expect((result as CommsBlocked).findings.single.code, 'PLACEHOLDER');
    expect(world.bridge.calls.last.method, 'action.comms_check');
    expect(world.bridge.calls.last.params['body'], proposal.body);
    expect(world.gmail.sent, isEmpty);
  });

  // Final review I2: one message, one send.
  group('a proposal goes out once', () {
    test('the send carries the proposal id as its send key', () async {
      final world = _World();
      await world.start();
      final thread = await world.samReplied();
      world.bridge.answer('action.comms_propose', _ready);
      world.checksPass();
      final proposal = await world.queue
          .draft(CommsRequest(kind: CommsKind.reply, threadId: thread.id));

      await world.queue
          .send(proposal, subject: proposal.subject, body: proposal.body);

      expect(world.gmail.sent.single.sendKey, proposal.id);
    });

    test(
        'a send that went out but could not be recorded says so, and is '
        'not offered again', () async {
      final world = _World();
      await world.start();
      final thread = await world.samReplied();
      world.bridge.answer('action.comms_propose', _ready);
      world.checksPass();
      final proposal = await world.queue
          .draft(CommsRequest(kind: CommsKind.reply, threadId: thread.id));
      world.outreach.failRecording = true;

      final result = await world.queue
          .send(proposal, subject: proposal.subject, body: proposal.body);

      expect(result, isA<CommsSentNotRecorded>());
      expect((result as CommsSentNotRecorded).error,
          contains('database is locked'));
      expect(world.gmail.sent, hasLength(1));
      expect((await world.proposals.getById(proposal.id))!.status,
          CommsQueueStatus.sent);
      expect((await world.view()).proposals, isEmpty,
          reason: 'a sent message is never offered for sending again');
    });

    test(
        'drafting an item that already has an open proposal returns it, '
        'without asking again', () async {
      final world = _World();
      await world.start();
      final thread = await world.samReplied();
      world.bridge.answer('action.comms_propose', _ready);
      final first = await world.queue
          .draft(CommsRequest(kind: CommsKind.reply, threadId: thread.id));

      final second = await world.queue
          .draft(CommsRequest(kind: CommsKind.reply, threadId: thread.id));

      expect(second.id, first.id);
      expect(
          world.bridge.calls.where((c) => c.method == 'action.comms_propose'),
          hasLength(1));
    });

    test('redo still replaces its own draft', () async {
      final world = _World();
      await world.start();
      final thread = await world.samReplied();
      world.bridge.answer('action.comms_propose', _ready);
      final first = await world.queue
          .draft(CommsRequest(kind: CommsKind.reply, threadId: thread.id));

      final next = await world.queue.redo(first, note: 'shorter');

      expect(next.id, isNot(first.id));
      expect((await world.proposals.getById(first.id))!.status,
          CommsQueueStatus.skipped);
    });

    test('sending one sets aside any other open draft for the same thread',
        () async {
      final world = _World();
      await world.start();
      final thread = await world.samReplied();
      world.bridge.answer('action.comms_propose', _ready);
      world.checksPass();
      final proposal = await world.queue
          .draft(CommsRequest(kind: CommsKind.reply, threadId: thread.id));
      // What an older build, or a second machine, could leave behind.
      final sibling = await world.proposals.save(CommsProposal.fromResult(
          CommsRequest(
              kind: CommsKind.reply, threadId: thread.id, channelId: 'UC_sam'),
          CommsProposalResult.fromJson(_ready)));

      await world.queue
          .send(proposal, subject: proposal.subject, body: proposal.body);

      expect((await world.proposals.getById(sibling.id))!.status,
          CommsQueueStatus.skipped);
    });
  });

  // Final review I3: a person sees where it goes before pressing Send.
  test(
      'the recipient is resolved for the card, and a found address is '
      'marked unconfirmed', () async {
    final world = _World();
    await world.start();
    world.influencers.replaceAllForTesting([
      ...await world.influencers.getAll(),
      Influencer(
        id: 'UC_found',
        handle: '@found',
        channelUrl: '',
        platform: InfluencerPlatform.youtube,
        subscriberCount: 100000,
        sourceKeywords: const [],
        vettingStatus: VettingStatus.shortlisted,
        discoveredAt: DateTime(2026),
        foundEmails: const ['press@found.tv'],
      ),
    ]);

    final sam = await world.container.read(commsRecipientProvider(
        (threadId: null, channelId: 'UC_sam', brandId: null)).future);
    final found = await world.container.read(commsRecipientProvider(
        (threadId: null, channelId: 'UC_found', brandId: null)).future);

    expect(sam!.address, 'sam@sam.tv');
    expect(sam.unconfirmed, isFalse);
    expect(found!.address, 'press@found.tv');
    expect(found.unconfirmed, isTrue);
  });

  // Final review I6: contacted creators must not fill the window.
  test(
      'new outreach still finds never-contacted creators behind 40 '
      'contacted ones', () async {
    final world = _World();
    await world.start();
    Influencer creator(int n, {required int attempts}) => Influencer(
          id: 'UC_$n',
          handle: '@c$n',
          channelUrl: '',
          platform: InfluencerPlatform.youtube,
          subscriberCount: 1000000 - n,
          sourceKeywords: const [],
          vettingStatus: VettingStatus.shortlisted,
          discoveredAt: DateTime(2026),
          contactAttempts: attempts,
        );
    world.influencers.replaceAllForTesting([
      for (var n = 0; n < 45; n++) creator(n, attempts: n < 40 ? 1 : 0),
    ]);

    final view = await world.view();

    expect([for (final c in view.newOutreach) c.request.channelId],
        ['UC_40', 'UC_41', 'UC_42', 'UC_43', 'UC_44']);
  });

  // Final review I5: a brand pitch can be started, with ready creators only.
  test(
      'a brand pitch is drafted for the given creators, on a thread with the '
      'brand contact', () async {
    final world = _World();
    await world.start();
    world.bridge.answer('action.comms_propose', _ready);

    final proposal = await world.queue.draftBrandPitch(
      brandId: 'brand_1',
      contactEmail: 'deals@brand.io',
      channelIds: const ['UC_sam'],
    );

    final asked = world.bridge
        .lastCall('action.comms_propose')!
        .params['request']! as Map<String, Object?>;
    expect(asked['kind'], 'first');
    expect(asked['brandId'], 'brand_1');
    expect(asked['contactEmail'], 'deals@brand.io');
    expect(asked['pitchChannelIds'], ['UC_sam']);
    expect(proposal.brandId, 'brand_1');
    final thread = await world.outreach.getThreadById(proposal.threadId!);
    expect(thread!.contactEmail, 'deals@brand.io');
    expect((await world.view()).proposals.single.id, proposal.id);
  });

  test('a creator with no email address cannot be sent to', () async {
    final world = _World();
    await world.start();
    world.influencers.replaceAllForTesting([
      Influencer(
        id: 'UC_new',
        handle: '@new',
        channelUrl: '',
        platform: InfluencerPlatform.youtube,
        subscriberCount: 100000,
        sourceKeywords: const [],
        vettingStatus: VettingStatus.shortlisted,
        discoveredAt: DateTime(2026),
      ),
    ]);
    world.bridge.answer('action.comms_propose', _ready);
    world.checksPass();
    final proposal = await world.queue
        .draft(const CommsRequest(kind: CommsKind.first, channelId: 'UC_new'));

    final result = await world.queue
        .send(proposal, subject: proposal.subject, body: proposal.body);

    expect(result, isA<CommsNoRecipient>());
    expect(world.gmail.sent, isEmpty);
  });

  test('skipping takes an item out of the queue', () async {
    final world = _World();
    await world.start();
    final thread = await world.samReplied();
    world.bridge.answer('action.comms_propose', _ready);
    final proposal = await world.queue
        .draft(CommsRequest(kind: CommsKind.reply, threadId: thread.id));

    await world.queue.skip(proposal);

    expect((await world.view()).proposals, isEmpty);
  });

  test('redo asks again with the corrections and replaces the old draft',
      () async {
    final world = _World();
    await world.start();
    final thread = await world.samReplied();
    world.bridge.answer('action.comms_propose', _ready);
    final first = await world.queue
        .draft(CommsRequest(kind: CommsKind.reply, threadId: thread.id));

    final second = await world.queue.redo(first,
        steer: const {'english': 'nonnative'}, note: 'Keep it short.');

    expect(world.bridge.calls.last.params['request'], {
      'kind': 'reply',
      'threadId': thread.id,
      'channelId': 'UC_sam',
      'steer': {'english': 'nonnative', 'note': 'Keep it short.'},
    });
    final open = (await world.view()).proposals;
    expect(open.single.id, second.id);
    expect(second.steer['english'], 'nonnative');
  });

  test('a shortlisted creator never written to is new outreach', () async {
    final world = _World();
    await world.start();

    final view = await world.view();

    expect(view.newOutreach.single.request.channelId, 'UC_sam');
    expect(view.newOutreach.single.request.kind, CommsKind.first);
    expect(view.dailyTarget, 50);
  });
}
