import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_compose_controller.dart';

/// Sending a draft through the team's mailbox.
///
/// The rule this suite exists for is the ordering one: **nothing is recorded
/// until Gmail has confirmed the send.** The two failures are not symmetric. A
/// message recorded but not sent is a CRM that lies about having contacted
/// somebody — invisible, and it stops anyone from sending the real thing. A
/// message sent but not recorded is still sitting in Gmail, and the next reply
/// sweep still finds its answers.

class _FakeGmailGateway implements GmailGateway {
  GmailSendRequest? lastRequest;
  GmailError? failWith;
  int sendCalls = 0;

  @override
  Future<GmailOutcome<GmailSendReceipt>> send(GmailSendRequest request) async {
    sendCalls += 1;
    lastRequest = request;
    if (failWith != null) return GmailOutcome.failure(failWith);
    return GmailOutcome.success(
      GmailSendReceipt(
        account: 'outreach@gratovo.test',
        conversationKey: request.conversationKey,
        messageId: 'm1',
        threadId: 't1',
        sentAt: DateTime.utc(2026, 9, 4, 12),
      ),
    );
  }

  @override
  Future<GmailOutcome<GmailStatus>> status() async =>
      const GmailOutcome.success(GmailStatus.unconfigured);

  @override
  Future<GmailOutcome<String>> connect() async =>
      const GmailOutcome.success('outreach@gratovo.test');

  @override
  Future<GmailOutcome<bool>> disconnect({String? account}) async =>
      const GmailOutcome.success(true);

  @override
  Future<GmailOutcome<GmailSweep>> runDue({
    bool checkOnly = false,
    String? conversationKey,
    int? limit,
    String? account,
  }) async =>
      const GmailOutcome.success(GmailSweep.empty);

  @override
  Future<GmailOutcome<int>> acknowledge(List<String> messageIds) async =>
      const GmailOutcome.success(0);

  @override
  Future<GmailOutcome<int>> cancelFollowUps(String conversationKey) async =>
      const GmailOutcome.success(0);

  @override
  Future<GmailOutcome<String>> sendTest({String? to, String? account}) async =>
      const GmailOutcome.success('');
}

Influencer _influencer({
  String id = 'ch_1',
  PipelineStage stage = PipelineStage.isNew,
}) {
  return Influencer(
    id: id,
    handle: '@channel',
    channelUrl: 'https://youtube.com/@channel',
    platform: InfluencerPlatform.youtube,
    subscriberCount: 1000,
    sourceKeywords: const [],
    vettingStatus: VettingStatus.newlyFound,
    discoveredAt: DateTime.utc(2026),
    pipelineStage: stage,
    contacts: const [
      InfluencerContact(
        method: ContactMethod.email,
        value: 'creator@example.com',
      ),
    ],
  );
}

OutreachThread _thread({
  String id = 'thread_1',
  ThreadStatus status = ThreadStatus.notContactedYet,
}) {
  return OutreachThread(
    id: id,
    influencerId: 'ch_1',
    status: status,
    updatedAt: DateTime.utc(2026),
  );
}

void main() {
  late _FakeGmailGateway gateway;
  late MockOutreachRepository outreach;
  late ProviderContainer container;

  setUp(() {
    gateway = _FakeGmailGateway();
    outreach = MockOutreachRepository();
    container = ProviderContainer(
      overrides: [
        supabaseBootProvider.overrideWithValue(
          const SupabaseBoot(
            config: SupabaseConfig(url: '', anonKey: ''),
            error: 'no server configured in this test',
          ),
        ),
        gmailGatewayProvider.overrideWithValue(gateway),
        outreachRepositoryProvider.overrideWithValue(outreach),
        influencerRepositoryProvider.overrideWithValue(
          MockInfluencerRepository(),
        ),
        reminderRepositoryProvider.overrideWithValue(MockReminderRepository()),
      ],
    );
    addTearDown(container.dispose);
  });

  ComposeController controller([String threadId = 'thread_1']) =>
      container.read(composeControllerProvider(threadId).notifier);

  ComposeState stateOf([String threadId = 'thread_1']) =>
      container.read(composeControllerProvider(threadId));

  Future<GmailSendOutcomeForUi> send({
    ThreadStatus status = ThreadStatus.notContactedYet,
    PipelineStage stage = PipelineStage.isNew,
  }) {
    return controller().sendViaGmail(
      thread: _thread(status: status),
      influencer: _influencer(stage: stage),
    );
  }

  void writeDraft({String subject = 'Collab', String body = 'Hello there.'}) {
    controller()
      ..initFor(_influencer())
      ..setSubject(subject)
      ..setBody(body);
  }

  group('the request', () {
    test('carries the thread id as the conversation key and the channel id',
        () async {
      writeDraft();

      await send();

      final request = gateway.lastRequest!;
      expect(request.conversationKey, 'thread_1',
          reason: 'a reply comes back naming the thread it belongs to');
      expect(request.channelId, 'ch_1');
      expect(request.to, 'creator@example.com');
      expect(request.subject, 'Collab');
      expect(request.body, 'Hello there.');
    });

    test('files a first cold email under Influencers / Stage Contacted',
        () async {
      writeDraft();

      // A brand-new channel, never contacted: the funnel still reads `new`,
      // but this send is what moves it to `contacted`, so that is what the
      // label says.
      await send(
        status: ThreadStatus.notContactedYet,
        stage: PipelineStage.isNew,
      );

      expect(gateway.lastRequest!.labels, ['Influencers', 'Stage/Contacted']);
    });

    test('a replied thread whose funnel has not caught up is filed Interested',
        () async {
      writeDraft();

      await send(
        status: ThreadStatus.replied,
        stage: PipelineStage.contacted,
      );

      expect(gateway.lastRequest!.labels, ['Influencers', 'Stage/Interested']);
    });

    test('a funnel stage past contacted is used as-is', () async {
      writeDraft();

      await send(
        status: ThreadStatus.awaitingReply,
        stage: PipelineStage.negotiating,
      );

      expect(gateway.lastRequest!.labels, ['Influencers', 'Stage/Negotiating']);
    });

    test('queues no follow-up behind the message', () async {
      // Owner's rule, 2026-10-18: every outgoing message waits for a person,
      // so a follow-up is drafted and approved when it is due, never armed
      // here to go out by itself.
      writeDraft();

      await send();

      expect(gateway.lastRequest!.toJson().containsKey('followUps'), isFalse);
    });
  });

  group('a successful send', () {
    test('records the message and clears the draft', () async {
      writeDraft();

      final outcome = await send();

      expect(outcome.succeeded, isTrue);
      expect(outcome.receipt!.account, 'outreach@gratovo.test');

      final messages = await outreach.getMessages('thread_1');
      final sent = messages.last;
      expect(sent.direction, MessageDirection.outbound);
      expect(sent.subject, 'Collab');
      expect(sent.peerAddress, 'creator@example.com');

      expect(stateOf().body, isEmpty);
      expect(stateOf().subject, isEmpty);
      expect(stateOf().isSending, isFalse);
    });

    test('advances the thread on first contact', () async {
      // A real thread from the repository, not the fabricated one the other
      // tests use: this assertion is about a write landing on a stored row,
      // so the row has to exist.
      final thread =
          await outreach.getOrCreateThreadForInfluencer('ch_first_contact');
      expect(thread.status, ThreadStatus.notContactedYet);

      controller(thread.id)
        ..initFor(_influencer())
        ..setSubject('Collab')
        ..setBody('Hello there.');

      await controller(thread.id).sendViaGmail(
        thread: thread,
        influencer: _influencer(),
      );

      final after = await outreach.getThreadById(thread.id);
      expect(after!.status, ThreadStatus.awaitingReply);
    });
  });

  group('a refused send', () {
    test('records nothing and keeps the draft', () async {
      writeDraft();
      gateway.failWith = const GmailError(
        failure: GmailFailure.authFailed,
        message: 'The token lapsed.',
      );

      final outcome = await send();

      expect(outcome.succeeded, isFalse);
      expect(outcome.error!.failure, GmailFailure.authFailed);

      final messages = await outreach.getMessages('thread_1');
      expect(
        messages.where((m) => m.subject == 'Collab'),
        isEmpty,
        reason: 'a CRM that claims an unsent message stops anyone sending the '
            'real one',
      );
      expect(stateOf().body, 'Hello there.',
          reason: 'the draft has to survive so it can be sent again');
      expect(stateOf().isSending, isFalse);
    });
  });

  group('what it refuses to try', () {
    test('an empty draft is not sent at all', () async {
      controller().initFor(_influencer());

      final outcome = await send();

      expect(outcome.isEmptyDraft, isTrue);
      expect(gateway.sendCalls, 0);
    });

    test('a non-email method is handed back rather than mailed', () async {
      controller()
        ..initFor(_influencer())
        ..setMethod(ContactMethod.whatsapp, recipient: '+201234567890')
        ..setBody('Hi there.');

      final outcome = await send();

      expect(outcome.isWrongMethod, isTrue);
      expect(gateway.sendCalls, 0);
    });
  });
}
