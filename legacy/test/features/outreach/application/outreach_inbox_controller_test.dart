import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/core/notifications/notification_service.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_inbox_controller.dart';

/// What the app does when the mailbox reports a reply.
///
/// The email half of this — that a follow-up is never sent to somebody who has
/// already answered — is enforced in SQL and tested in
/// `pipeline/tests/test_mailbox.py`. What is tested here is the other half:
/// the business consequences, which are a fixed sequence of writes, and the
/// two rules in it that are easy to get wrong in a way nobody notices.
///
///   * **Only the FIRST reply moves a channel to `interested`.** A later one
///     says nothing new about the stage.
///   * **The move only ever goes forward.** A channel that has reached
///     `negotiating` must not be dragged back down the funnel by a stray
///     message landing on an old thread — silently, on a timer, with no person
///     involved to notice.
///
/// The gateway is a fake, so none of this needs a Gmail account, a Python
/// interpreter or a network.

class _FakeGmailGateway implements GmailGateway {
  GmailSweep? sweepResult;
  GmailError? sweepError;

  final acknowledged = <String>[];
  int sweepCalls = 0;
  bool? lastCheckOnly;

  @override
  Future<GmailOutcome<GmailSweep>> runDue({
    bool checkOnly = false,
    String? conversationKey,
    int? limit,
    String? account,
  }) async {
    sweepCalls += 1;
    lastCheckOnly = checkOnly;
    if (sweepError != null) return GmailOutcome.failure(sweepError);
    return GmailOutcome.success(sweepResult ?? GmailSweep.empty);
  }

  @override
  Future<GmailOutcome<int>> acknowledge(List<String> messageIds) async {
    acknowledged.addAll(messageIds);
    return GmailOutcome.success(messageIds.length);
  }

  @override
  Future<GmailOutcome<GmailStatus>> status() async =>
      const GmailOutcome.success(GmailStatus.unconfigured);

  @override
  Future<GmailOutcome<String>> connect() async => throw UnimplementedError();

  @override
  Future<GmailOutcome<bool>> disconnect({String? account}) async =>
      throw UnimplementedError();

  @override
  Future<GmailOutcome<GmailSendReceipt>> send(GmailSendRequest request) async =>
      throw UnimplementedError();

  @override
  Future<GmailOutcome<int>> cancelFollowUps(String conversationKey) async =>
      const GmailOutcome.success(0);

  @override
  Future<GmailOutcome<String>> sendTest({String? to, String? account}) async =>
      const GmailOutcome.success('');
}

class _RecordingNotificationService implements NotificationService {
  final shown = <({int id, String title, String body})>[];

  @override
  Future<void> init() async {}

  @override
  Future<bool> requestPermission() async => true;

  @override
  Future<void> show({
    required int id,
    required String title,
    required String body,
    String? payload,
  }) async {
    shown.add((id: id, title: title, body: body));
  }

  @override
  Future<void> schedule({
    required int id,
    required String title,
    required String body,
    required DateTime whenUtc,
    String? payload,
  }) async {}

  @override
  Future<void> cancel(int id) async {}

  @override
  Future<void> cancelAll() async {}
}

/// An outreach repository whose [recordMessage] always throws.
///
/// The mock accepts a message for a thread id it has never heard of, so it
/// cannot stand in for a failed CRM write — and a failed CRM write is the
/// entire reason the acknowledgement is a second round trip.
class _RefusingOutreachRepository implements OutreachRepository {
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
  }) async {
    throw StateError('the server refused this write');
  }

  @override
  Future<List<OutreachThread>> getAllThreads() async => const [];

  @override
  Future<OutreachThread?> getThreadById(String id) async => null;

  @override
  Future<OutreachThread?> getThreadByInfluencer(String influencerId) async =>
      null;

  @override
  Future<OutreachThread> getOrCreateThreadForInfluencer(
          String influencerId) async =>
      throw UnimplementedError();

  @override
  Future<OutreachThread> getOrCreateThreadForBrand(
          String brandId, String contactEmail) async =>
      throw UnimplementedError();

  @override
  Future<List<OutreachThread>> getThreadsForBrand(String brandId) async =>
      const [];

  @override
  Future<void> updateThreadStatus(String threadId, ThreadStatus status) async {}

  @override
  Future<void> updateThreadOwner(String threadId, String? ownerId) async {}

  @override
  Future<List<OutreachMessage>> getMessages(String threadId) async => const [];

  @override
  Future<int> countOutboundSince(DateTime since) async => 0;

  @override
  Future<void> deleteMessage(String messageId) async {}

  @override
  Future<void> updateMessageClassification(
    String messageId,
    MessageClassification? classification,
  ) async {}

  @override
  Future<void> deleteThread(String threadId) async {}
}

GmailReply _reply({
  required String threadId,
  String? channelId,
  String messageId = 'r1',
  bool isFirstReply = true,
  int cancelledFollowUps = 0,
}) {
  return GmailReply(
    conversationKey: threadId,
    channelId: channelId,
    messageId: messageId,
    fromAddress: 'creator@example.com',
    fromName: 'A Creator',
    subject: 'Re: Collaboration',
    body: 'Sounds interesting, tell me more.',
    receivedAt: DateTime.utc(2026, 9, 4, 10),
    isFirstReply: isFirstReply,
    cancelledFollowUps: cancelledFollowUps,
  );
}

void main() {
  late _FakeGmailGateway gateway;
  late _RecordingNotificationService notifications;
  late MockOutreachRepository outreach;
  late MockInfluencerRepository influencers;
  late MockReminderRepository reminders;
  late ProviderContainer container;

  setUp(() {
    gateway = _FakeGmailGateway();
    notifications = _RecordingNotificationService();
    outreach = MockOutreachRepository();
    influencers = MockInfluencerRepository();
    reminders = MockReminderRepository();

    container = ProviderContainer(
      overrides: [
        supabaseBootProvider.overrideWithValue(
          const SupabaseBoot(
            config: SupabaseConfig(url: '', anonKey: ''),
            error: 'no server configured in this test',
          ),
        ),
        gmailGatewayProvider.overrideWithValue(gateway),
        notificationServiceProvider.overrideWithValue(notifications),
        outreachRepositoryProvider.overrideWithValue(outreach),
        influencerRepositoryProvider.overrideWithValue(influencers),
        reminderRepositoryProvider.overrideWithValue(reminders),
      ],
    );
    addTearDown(container.dispose);
  });

  OutreachInboxController controller() =>
      container.read(outreachInboxProvider.notifier);

  /// A channel and its thread, both freshly created so no seeded fixture's
  /// stage or message history can make a test pass or fail by accident.
  Future<({String channelId, OutreachThread thread})> newConversation({
    PipelineStage stage = PipelineStage.contacted,
  }) async {
    final channelId = await influencers.create(
      NewInfluencer(handle: 'creator${DateTime.now().microsecondsSinceEpoch}'),
    );
    if (stage != PipelineStage.isNew) {
      await influencers.updatePipelineStage(
        channelId,
        stage,
        base: PipelineStage.isNew,
      );
    }
    final thread = await outreach.getOrCreateThreadForInfluencer(channelId);
    return (channelId: channelId, thread: thread);
  }

  group('a reply', () {
    test('is recorded on its thread and flips the thread to replied', () async {
      final conversation = await newConversation();
      gateway.sweepResult = GmailSweep(
        account: 'outreach@gratovo.test',
        replies: [
          _reply(
            threadId: conversation.thread.id,
            channelId: conversation.channelId,
          ),
        ],
      );

      final report = await controller().sweep();

      expect(report.replies, 1);
      final messages = await outreach.getMessages(conversation.thread.id);
      final inbound = messages.last;
      expect(inbound.direction, MessageDirection.inbound);
      expect(inbound.body, 'Sounds interesting, tell me more.');
      expect(inbound.peerAddress, 'creator@example.com');
      expect(inbound.at, DateTime.utc(2026, 9, 4, 10),
          reason: 'the time it arrived, not the time we noticed');

      final thread = await outreach.getThreadById(conversation.thread.id);
      expect(thread!.status, ThreadStatus.replied);
    });

    test('posts a notification naming who replied', () async {
      final conversation = await newConversation();
      gateway.sweepResult = GmailSweep(
        account: 'a@b.c',
        replies: [
          _reply(
            threadId: conversation.thread.id,
            channelId: conversation.channelId,
          ),
        ],
      );

      await controller().sweep();

      expect(notifications.shown, hasLength(1));
      // Whichever language the title is in, it names who wrote.
      final handle =
          (await influencers.getById(conversation.channelId))!.handle;
      expect(notifications.shown.single.title, contains(handle));
      expect(notifications.shown.single.body, 'Re: Collaboration');
    });

    test('clears the open follow-up reminders for that channel', () async {
      final conversation = await newConversation();
      await reminders.create(
        FollowUpReminder(
          id: '',
          title: 'Chase them',
          dueAt: DateTime.now().add(const Duration(days: 2)),
          kind: ReminderKind.followUp,
          influencerId: conversation.channelId,
        ),
      );
      expect(
          await reminders.getForInfluencer(conversation.channelId), isNotEmpty);

      gateway.sweepResult = GmailSweep(
        account: 'a@b.c',
        replies: [
          _reply(
            threadId: conversation.thread.id,
            channelId: conversation.channelId,
          ),
        ],
      );
      await controller().sweep();

      expect(
        await reminders.getForInfluencer(conversation.channelId),
        isEmpty,
        reason: 'a reminder to chase somebody who has replied is worse than '
            'no reminder at all',
      );
    });

    test('is acknowledged, so the mailbox stops offering it', () async {
      final conversation = await newConversation();
      gateway.sweepResult = GmailSweep(
        account: 'a@b.c',
        replies: [
          _reply(
            threadId: conversation.thread.id,
            channelId: conversation.channelId,
            messageId: 'r-42',
          ),
        ],
      );

      await controller().sweep();

      expect(gateway.acknowledged, ['r-42']);
    });

    test('is NOT acknowledged when recording it failed', () async {
      // The CRM write throws. The reply must stay on offer for the next sweep
      // rather than being quietly consumed — losing a reply is far worse than
      // applying it a few minutes late.
      final refusing = ProviderContainer(
        overrides: [
          supabaseBootProvider.overrideWithValue(
            const SupabaseBoot(
              config: SupabaseConfig(url: '', anonKey: ''),
              error: 'no server configured in this test',
            ),
          ),
          gmailGatewayProvider.overrideWithValue(gateway),
          notificationServiceProvider.overrideWithValue(notifications),
          outreachRepositoryProvider
              .overrideWithValue(_RefusingOutreachRepository()),
          influencerRepositoryProvider.overrideWithValue(influencers),
          reminderRepositoryProvider.overrideWithValue(reminders),
        ],
      );
      addTearDown(refusing.dispose);

      gateway.sweepResult = GmailSweep(
        account: 'a@b.c',
        replies: [_reply(threadId: 'thread_001', messageId: 'r-lost')],
      );

      final report =
          await refusing.read(outreachInboxProvider.notifier).sweep();

      expect(gateway.acknowledged, isEmpty);
      expect(report.replies, 0);
    });
  });

  group('the first reply moves the channel to interested', () {
    test('from contacted', () async {
      final conversation = await newConversation();
      gateway.sweepResult = GmailSweep(
        account: 'a@b.c',
        replies: [
          _reply(
            threadId: conversation.thread.id,
            channelId: conversation.channelId,
          ),
        ],
      );

      final report = await controller().sweep();

      expect(report.newlyInterested, 1);
      final channel = await influencers.getById(conversation.channelId);
      expect(channel!.pipelineStage, PipelineStage.interested);
    });

    test('from new — a channel somebody was emailed before it was staged',
        () async {
      final conversation = await newConversation(stage: PipelineStage.isNew);
      gateway.sweepResult = GmailSweep(
        account: 'a@b.c',
        replies: [
          _reply(
            threadId: conversation.thread.id,
            channelId: conversation.channelId,
          ),
        ],
      );

      await controller().sweep();

      final channel = await influencers.getById(conversation.channelId);
      expect(channel!.pipelineStage, PipelineStage.interested);
    });

    test('but a LATER reply leaves the stage alone', () async {
      final conversation = await newConversation();
      await influencers.updatePipelineStage(
        conversation.channelId,
        PipelineStage.negotiating,
        base: PipelineStage.contacted,
      );

      gateway.sweepResult = GmailSweep(
        account: 'a@b.c',
        replies: [
          _reply(
            threadId: conversation.thread.id,
            channelId: conversation.channelId,
            isFirstReply: false,
          ),
        ],
      );

      final report = await controller().sweep();

      expect(report.newlyInterested, 0);
      final channel = await influencers.getById(conversation.channelId);
      expect(channel!.pipelineStage, PipelineStage.negotiating);
    });

    test('and a channel already further along is never dragged back', () async {
      final conversation = await newConversation();
      await influencers.updatePipelineStage(
        conversation.channelId,
        PipelineStage.roster,
        base: PipelineStage.contacted,
      );

      // isFirstReply is true — this is the case where the flag alone would be
      // enough to walk a rostered channel back to `interested`.
      gateway.sweepResult = GmailSweep(
        account: 'a@b.c',
        replies: [
          _reply(
            threadId: conversation.thread.id,
            channelId: conversation.channelId,
          ),
        ],
      );

      final report = await controller().sweep();

      expect(report.newlyInterested, 0);
      final channel = await influencers.getById(conversation.channelId);
      expect(channel!.pipelineStage, PipelineStage.roster);
    });

    test('a reply with no channel still lands as a message', () async {
      final conversation = await newConversation();
      gateway.sweepResult = GmailSweep(
        account: 'a@b.c',
        replies: [_reply(threadId: conversation.thread.id)],
      );

      final report = await controller().sweep();

      expect(report.replies, 1);
      expect(report.newlyInterested, 0);
      final messages = await outreach.getMessages(conversation.thread.id);
      expect(messages.last.direction, MessageDirection.inbound);
    });
  });

  group('follow-ups the mailbox sent by itself', () {
    test('are recorded as outbound messages on their thread', () async {
      final conversation = await newConversation();
      gateway.sweepResult = GmailSweep(
        account: 'a@b.c',
        autoSent: [
          GmailAutoSend(
            conversationKey: conversation.thread.id,
            channelId: conversation.channelId,
            messageId: 'm9',
            stepNo: 1,
            to: 'creator@example.com',
            subject: 'Re: Collaboration',
            body: 'Just floating this back up.',
            sentAt: DateTime.utc(2026, 9, 4, 9),
          ),
        ],
      );

      final report = await controller().sweep();

      expect(report.followUpsSent, 1);
      final messages = await outreach.getMessages(conversation.thread.id);
      final sent = messages.last;
      expect(sent.direction, MessageDirection.outbound);
      expect(sent.body, 'Just floating this back up.');
      expect(sent.at, DateTime.utc(2026, 9, 4, 9));
    });

    test('a permanently failed one is worth a notification', () async {
      gateway.sweepResult = const GmailSweep(
        account: 'a@b.c',
        failures: [
          GmailSendFailure(
            conversationKey: 't1',
            stepNo: 2,
            message: 'Gmail refused the request.',
            givenUp: true,
          ),
          GmailSendFailure(
            conversationKey: 't2',
            stepNo: 1,
            message: 'Gmail is unavailable right now.',
          ),
        ],
      );

      final report = await controller().sweep();

      expect(report.permanentFailures, 1);
      expect(notifications.shown, hasLength(1),
          reason: 'a transient failure fixes itself on the next sweep and is '
              'not worth interrupting anyone about');
      expect(notifications.shown.single.body, 'Gmail refused the request.');
    });
  });

  group('the sweep itself', () {
    test('no sweep sends: the automatic one only checks for replies too',
        () async {
      // Owner's rule, 2026-10-18: every outgoing message waits for a person,
      // so a follow-up queued in the mailbox is never fired from here.
      await controller().sweep(checkOnly: true);
      expect(gateway.lastCheckOnly, isTrue);

      await controller().sweep();
      expect(gateway.lastCheckOnly, isTrue);

      await controller().sweep(checkOnly: false);
      expect(gateway.lastCheckOnly, isTrue);
    });

    test('an unreachable mailbox is held as state, not thrown', () async {
      gateway.sweepError = const GmailError(
        failure: GmailFailure.notConfigured,
        message: 'No mailbox here.',
      );

      final report = await controller().sweep();

      expect(report.error!.failure, GmailFailure.notConfigured);
      expect(container.read(outreachInboxProvider).error, isNotNull);
      expect(container.read(outreachInboxProvider).isSweeping, isFalse);
    });

    test('a success clears a previous failure', () async {
      gateway.sweepError = const GmailError(
        failure: GmailFailure.apiError,
        message: 'Rate limited.',
      );
      await controller().sweep();
      expect(container.read(outreachInboxProvider).error, isNotNull);

      gateway.sweepError = null;
      await controller().sweep();
      expect(container.read(outreachInboxProvider).error, isNull);
    });

    test('an empty sweep writes nothing and notifies nobody', () async {
      final report = await controller().sweep();

      expect(report.foundNothing, isTrue);
      expect(notifications.shown, isEmpty);
      expect(gateway.acknowledged, isEmpty);
    });
  });
}
