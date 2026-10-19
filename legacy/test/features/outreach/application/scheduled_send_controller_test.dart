import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/core/notifications/notification_service.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/scheduled_email.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/data/repositories/scheduled_email_store.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_compose_controller.dart';
import 'package:gratovo_toolbox/features/outreach/application/scheduled_send_controller.dart';

import '../scheduled_send_fakes.dart';

/// "Send later": held on this machine, sent while the app runs, never sent
/// twice, and never sent late without a person deciding.

class _Notices extends NoopNotificationService {
  final titles = <String>[];

  @override
  Future<void> show({
    required int id,
    required String title,
    required String body,
    String? payload,
  }) async =>
      titles.add(title);
}

// A seeded mock thread and its channel.
const _threadId = 'thread_002';
const _channelId = 'inf_007';

final _nine = DateTime.utc(2026, 10, 1, 9);

ScheduledEmail _email({
  String id = 'e1',
  DateTime? sendAt,
  ScheduledEmailStatus status = ScheduledEmailStatus.scheduled,
  GmailFailure? lastFailure,
}) {
  return ScheduledEmail(
    id: id,
    threadId: _threadId,
    influencerId: _channelId,
    handle: '@channel',
    to: 'creator@example.com',
    subject: 'Collab',
    body: 'Hello there.',
    followUps: const [GmailFollowUpDraft(delayDays: 3, body: 'Chasing.')],
    sendAt: sendAt ?? _nine,
    createdAt: DateTime.utc(2026, 9, 30),
    status: status,
    lastFailure: lastFailure,
    lastError: lastFailure == null ? null : 'earlier problem',
  );
}

void main() {
  late FakeKeyedMailbox mailbox;
  late MockOutreachRepository outreach;
  late MemoryScheduledEmailStore store;
  late DateTime now;
  late _Notices notices;

  ProviderContainer launch() {
    final container = ProviderContainer(
      overrides: [
        supabaseBootProvider.overrideWithValue(
          const SupabaseBoot(
            config: SupabaseConfig(url: '', anonKey: ''),
            error: 'no server configured in this test',
          ),
        ),
        gmailGatewayProvider.overrideWithValue(mailbox),
        outreachRepositoryProvider.overrideWithValue(outreach),
        influencerRepositoryProvider
            .overrideWithValue(MockInfluencerRepository()),
        reminderRepositoryProvider.overrideWithValue(MockReminderRepository()),
        scheduledEmailStoreProvider.overrideWithValue(store),
        scheduledSendClockProvider.overrideWithValue(() => now),
        notificationServiceProvider.overrideWithValue(notices),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  Future<List<OutreachMessage>> outbound() async => [
        for (final message in await outreach.getMessages(_threadId))
          if (message.direction == MessageDirection.outbound &&
              message.body == 'Hello there.')
            message,
      ];

  setUp(() {
    mailbox = FakeKeyedMailbox();
    outreach = MockOutreachRepository();
    store = MemoryScheduledEmailStore();
    now = DateTime.utc(2026, 9, 30, 12);
    notices = _Notices();
  });

  group('scheduling from the composer', () {
    test('takes the draft as it is, with no follow-up behind it, and clears it',
        () async {
      final container = launch();
      final thread = (await outreach.getThreadById(_threadId))!;
      final influencer =
          (await MockInfluencerRepository().getById(_channelId))!;
      final compose =
          container.read(composeControllerProvider(_threadId).notifier)
            ..initFor(influencer)
            ..setMethod(ContactMethod.email, recipient: 'creator@example.com')
            ..setSubject('Collab')
            ..setBody('Hello there.');

      final result = await compose.scheduleSend(
        thread: thread,
        influencer: influencer,
        sendAtUtc: _nine,
      );

      expect(result, ScheduleSendResult.scheduled);
      final saved = store.saved.single;
      expect(saved.to, 'creator@example.com');
      expect(saved.subject, 'Collab');
      expect(saved.body, 'Hello there.');
      expect(saved.sendAt, _nine);
      expect(saved.followUps, isEmpty);
      expect(saved.sendKey, saved.id);
      expect(container.read(composeControllerProvider(_threadId)).body, '');
      expect(mailbox.calls, 0, reason: 'scheduling sends nothing');
    });

    test('an empty draft is refused, not scheduled', () async {
      final container = launch();
      final thread = (await outreach.getThreadById(_threadId))!;
      final influencer =
          (await MockInfluencerRepository().getById(_channelId))!;
      final result = await container
          .read(composeControllerProvider(_threadId).notifier)
          .scheduleSend(
            thread: thread,
            influencer: influencer,
            sendAtUtc: _nine,
          );
      expect(result, ScheduleSendResult.nothingToSend);
      expect(store.saved, isEmpty);
    });

    test('Edit puts it back in the composer exactly as it was queued',
        () async {
      store = MemoryScheduledEmailStore([_email()]);
      final container = launch();
      final controller = container.read(scheduledSendProvider.notifier);
      await controller.ensureLoaded();

      final taken = await controller.takeBack('e1');
      container
          .read(composeControllerProvider(_threadId).notifier)
          .restoreScheduled(taken!);

      final state = container.read(composeControllerProvider(_threadId));
      expect(state.recipientValue, 'creator@example.com');
      expect(state.subject, 'Collab');
      expect(state.body, 'Hello there.');
      expect(store.saved, isEmpty,
          reason: 'off the list while it is being edited');
    });
  });

  group('while the app runs', () {
    test('nothing goes before its time', () async {
      store = MemoryScheduledEmailStore([_email()]);
      final container = launch();
      now = _nine.subtract(const Duration(minutes: 1));

      expect(await container.read(scheduledSendProvider.notifier).tick(), 0);
      expect(mailbox.calls, 0);
    });

    test('at its time it goes out once, and is recorded once', () async {
      store = MemoryScheduledEmailStore([_email()]);
      final container = launch();
      final controller = container.read(scheduledSendProvider.notifier);
      now = _nine.add(const Duration(seconds: 20));

      expect(await controller.tick(), 1);
      expect(await controller.tick(), 0);

      expect(mailbox.delivered, hasLength(1));
      final request = mailbox.delivered.single;
      expect(request.sendKey, 'e1');
      expect(request.conversationKey, _threadId);
      expect(request.toJson().containsKey('followUps'), isFalse,
          reason:
              'a follow-up saved with an older scheduled email is not sent');
      expect(request.labels, isNotEmpty,
          reason: 'labelled by the channel\'s stage as of the send');
      expect(await outbound(), hasLength(1));
      expect(store.saved, isEmpty);
      expect(container.read(scheduledSendProvider).emails, isEmpty);
      await Future<void>.delayed(Duration.zero);
      expect(notices.titles, [contains('@channel')],
          reason: 'it went out on its own, so the person is told');
    });

    test('two ticks and a double-click at once still send it once', () async {
      store = MemoryScheduledEmailStore([_email()]);
      final container = launch();
      final controller = container.read(scheduledSendProvider.notifier);
      await controller.ensureLoaded();
      now = _nine;
      mailbox.hold = Completer<void>();

      final first = controller.tick();
      final second = controller.tick();
      // And a double-click on Send now, from the list, at the same moment.
      final pressed = controller.sendNow('e1');
      final pressedAgain = controller.sendNow('e1');
      await Future<void>.delayed(Duration.zero);
      mailbox.hold!.complete();
      await Future.wait([first, second, pressed, pressedAgain]);

      expect(mailbox.calls, 1);
      expect(mailbox.delivered, hasLength(1));
    });

    test('it is marked sending on disk before the mailbox is asked', () async {
      store = MemoryScheduledEmailStore([_email()]);
      final container = launch();
      final controller = container.read(scheduledSendProvider.notifier);
      now = _nine;
      mailbox.hold = Completer<void>();

      final tick = controller.tick();
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(store.saved.single.status, ScheduledEmailStatus.sending);
      mailbox.hold!.complete();
      await tick;
    });
  });

  group('when the app was closed at its time', () {
    test('a late email waits for a person instead of going out', () async {
      store = MemoryScheduledEmailStore([_email()]);
      now = _nine.add(const Duration(hours: 3));
      final container = launch();
      final controller = container.read(scheduledSendProvider.notifier);

      expect(await controller.tick(), 0);
      expect(mailbox.calls, 0);
      expect(
        [
          for (final e in container.read(scheduledSendProvider).needsAttention)
            e.id
        ],
        ['e1'],
      );

      expect(await controller.sendNow('e1'), ScheduledSendOutcome.sent);
      expect(mailbox.delivered, hasLength(1));
      expect(container.read(scheduledSendProvider).needsAttention, isEmpty);
    });

    test('a few minutes late is still on time', () async {
      store = MemoryScheduledEmailStore([_email()]);
      now = _nine.add(scheduledSendGrace - const Duration(minutes: 1));
      final container = launch();
      expect(await container.read(scheduledSendProvider.notifier).tick(), 1);
    });

    test('a new time puts it back on the schedule', () async {
      store = MemoryScheduledEmailStore([_email()]);
      now = _nine.add(const Duration(hours: 3));
      final container = launch();
      final controller = container.read(scheduledSendProvider.notifier);
      await controller.tick();

      final later = now.add(const Duration(hours: 1));
      expect(await controller.reschedule('e1', later), isTrue);
      expect(container.read(scheduledSendProvider).needsAttention, isEmpty);
      expect(store.saved.single.sendAt, later);

      now = later;
      expect(await controller.tick(), 1);
    });

    test("Don't send drops it for good", () async {
      store = MemoryScheduledEmailStore([_email()]);
      now = _nine.add(const Duration(hours: 3));
      final container = launch();
      final controller = container.read(scheduledSendProvider.notifier);
      await controller.tick();

      expect(await controller.cancel('e1'), isTrue);
      expect(store.saved, isEmpty);
      expect(container.read(scheduledSendProvider).needsAttention, isEmpty);
      expect(mailbox.calls, 0);
    });

    test(
        'an app that died mid-send retries with the same key, and the '
        'mailbox does not send it twice', () async {
      // The mailbox sent it; the app died before hearing back.
      mailbox.keysSent.add('e1');
      store = MemoryScheduledEmailStore(
          [_email(status: ScheduledEmailStatus.sending)]);
      now = _nine.add(const Duration(minutes: 2));
      final container = launch();

      expect(await container.read(scheduledSendProvider.notifier).tick(), 1);
      expect(mailbox.calls, 1);
      expect(mailbox.delivered, isEmpty,
          reason: 'nothing new reached the inbox');
      expect(await outbound(), hasLength(1),
          reason: 'and the CRM gets the record it never got');
      expect(store.saved, isEmpty);
    });
  });

  group('failures', () {
    test(
        'a refusal is kept with its reason, not retried on its own, and '
        'Send now retries it', () async {
      store = MemoryScheduledEmailStore([_email()]);
      now = _nine;
      final container = launch();
      final controller = container.read(scheduledSendProvider.notifier);
      mailbox.failWith = const GmailError(
        failure: GmailFailure.authFailed,
        message: 'Reconnect the mailbox.',
      );

      await controller.tick();
      final failed = store.saved.single;
      expect(failed.status, ScheduledEmailStatus.failed);
      expect(failed.lastError, 'Reconnect the mailbox.');
      expect(failed.attempts, 1);
      expect(
          container.read(scheduledSendProvider).needsAttention, hasLength(1));
      expect(await outbound(), isEmpty,
          reason: 'nothing recorded for a failed send');

      await controller.tick();
      expect(mailbox.calls, 1, reason: 'a failure waits for a person');

      mailbox.failWith = null;
      expect(await controller.sendNow('e1'), ScheduledSendOutcome.sent);
      expect(mailbox.delivered, hasLength(1));
      expect(await outbound(), hasLength(1));
    });

    test('"may already have gone out" retries only with a new key', () async {
      store = MemoryScheduledEmailStore([
        _email(
          status: ScheduledEmailStatus.failed,
          lastFailure: GmailFailure.sendUncertain,
        ),
      ]);
      final container = launch();
      final controller = container.read(scheduledSendProvider.notifier);
      await controller.ensureLoaded();
      expect(
          container.read(scheduledSendProvider).emails.single.mayHaveBeenSent,
          isTrue);

      await controller.sendNow('e1', evenIfMaybeSent: true);

      expect(mailbox.delivered.single.sendKey, isNot('e1'));
    });

    test('a channel that no longer exists fails instead of sending', () async {
      store = MemoryScheduledEmailStore([
        ScheduledEmail(
          id: 'gone',
          threadId: 'no_such_thread',
          influencerId: 'no_such_channel',
          handle: '@gone',
          to: 'x@example.com',
          subject: 's',
          body: 'b',
          sendAt: _nine,
          createdAt: _nine,
        ),
      ]);
      now = _nine;
      final container = launch();
      await container.read(scheduledSendProvider.notifier).tick();
      expect(mailbox.calls, 0);
      expect(store.saved.single.status, ScheduledEmailStatus.failed);
    });
  });

  test('the stored form round-trips everything a send needs', () {
    final email = _email(
      status: ScheduledEmailStatus.failed,
      lastFailure: GmailFailure.apiError,
    ).copyWith(sendKey: 'k2');
    final back = ScheduledEmail.fromJson(email.toJson())!;
    expect(back.toJson(), email.toJson());
    expect(back.sendKey, 'k2');
    expect(back.lastFailure, GmailFailure.apiError);
    expect(back.sendAt.isUtc, isTrue);
    expect(ScheduledEmail.fromJson({'id': 'x'}), isNull,
        reason: 'an entry with no recipient or time is dropped, not guessed');
  });
}
