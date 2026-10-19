import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/follow_up_cadence.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_compose_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

Influencer _influencer({
  String id = 'ch_1',
  PipelineStage stage = PipelineStage.isNew,
  List<InfluencerContact> contacts = const [],
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
    contacts: contacts,
  );
}

ProviderContainer _container({
  MockInfluencerRepository? influencers,
  MockOutreachRepository? outreach,
  MockReminderRepository? reminders,
}) {
  final container = ProviderContainer(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      if (influencers != null)
        influencerRepositoryProvider.overrideWithValue(influencers),
      if (outreach != null)
        outreachRepositoryProvider.overrideWithValue(outreach),
      if (reminders != null)
        reminderRepositoryProvider.overrideWithValue(reminders),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('initFor auto-pick', () {
    test('no contacts flags needsContact and stays on email', () {
      final container = _container();
      final controller =
          container.read(composeControllerProvider('t1').notifier);

      controller.initFor(_influencer());

      final state = container.read(composeControllerProvider('t1'));
      expect(state.needsContact, isTrue);
      expect(state.method, ContactMethod.email);
      expect(state.recipientValue, isNull);
    });

    test('exactly one contact adopts its method and value', () {
      final container = _container();
      final controller =
          container.read(composeControllerProvider('t1').notifier);

      controller.initFor(
        _influencer(
          contacts: const [
            InfluencerContact(
              method: ContactMethod.whatsapp,
              value: '+20 100 000 0000',
            ),
          ],
        ),
      );

      final state = container.read(composeControllerProvider('t1'));
      expect(state.needsContact, isFalse);
      expect(state.method, ContactMethod.whatsapp);
      expect(state.recipientValue, '+20 100 000 0000');
    });

    test('several contacts pick the primary', () {
      final container = _container();
      final controller =
          container.read(composeControllerProvider('t1').notifier);

      controller.initFor(
        _influencer(
          contacts: const [
            InfluencerContact(
              method: ContactMethod.email,
              value: 'first@x.com',
            ),
            InfluencerContact(
              method: ContactMethod.instagram,
              value: '@primary',
              isPrimary: true,
            ),
          ],
        ),
      );

      final state = container.read(composeControllerProvider('t1'));
      expect(state.method, ContactMethod.instagram);
      expect(state.recipientValue, '@primary');
    });

    test('is a one-shot — a later call does not overwrite edits', () {
      final container = _container();
      final controller =
          container.read(composeControllerProvider('t1').notifier);

      controller.initFor(_influencer());
      controller.setMethod(ContactMethod.telegram, recipient: '@handle');
      controller.initFor(
        _influencer(
          contacts: const [
            InfluencerContact(method: ContactMethod.email, value: 'e@x.com'),
          ],
        ),
      );

      final state = container.read(composeControllerProvider('t1'));
      expect(state.method, ContactMethod.telegram);
      expect(state.recipientValue, '@handle');
    });
  });

  group('buildMailto', () {
    test('is null for a non-email method', () {
      final container = _container();
      final controller =
          container.read(composeControllerProvider('t1').notifier)
            ..setMethod(ContactMethod.instagram, recipient: '@x')
            ..setBody('hello');
      expect(controller.buildMailto(), isNull);
    });

    test('is null for email with no recipient', () {
      final container = _container();
      final controller = container
          .read(composeControllerProvider('t1').notifier)
        ..setBody('hello');
      expect(controller.buildMailto(), isNull);
    });

    test('percent-encodes the subject and body', () {
      final container = _container();
      final controller =
          container.read(composeControllerProvider('t1').notifier)
            ..setRecipient('creator@example.com')
            ..setSubject('Quick hello & idea')
            ..setBody('line one\nline two');

      final mailto = controller.buildMailto()!;
      expect(mailto, startsWith('mailto:creator@example.com?'));
      expect(mailto, contains('subject=Quick%20hello%20%26%20idea'));
      expect(mailto, contains('body=line%20one%0Aline%20two'));
    });

    test('omits an over-long body from the URL', () {
      final container = _container();
      final longBody = 'x' * 2000;
      final controller =
          container.read(composeControllerProvider('t1').notifier)
            ..setRecipient('creator@example.com')
            ..setBody(longBody);

      expect(controller.mailtoOmitsBody, isTrue);
      expect(controller.buildMailto(), isNot(contains('body=')));
    });
  });

  group('markSent', () {
    test('records the message, advances the thread and the pipeline once',
        () async {
      final influencers = MockInfluencerRepository();
      final outreach = MockOutreachRepository();
      final container = _container(
        influencers: influencers,
        outreach: outreach,
      );

      // inf_002 is seeded `new` with no existing thread.
      final thread = await outreach.getOrCreateThreadForInfluencer('inf_002');
      expect(thread.status, ThreadStatus.notContactedYet);
      final influencer = (await influencers.getById('inf_002'))!;

      final controller =
          container.read(composeControllerProvider(thread.id).notifier)
            ..setRecipient('hi@inf2.com')
            ..setSubject('Hello')
            ..setBody('First contact.');

      final sent = await controller.markSent(
        thread: thread,
        influencer: influencer,
      );
      expect(sent, isTrue);

      final messages = await outreach.getMessages(thread.id);
      expect(messages, hasLength(1));
      expect(messages.single.direction, MessageDirection.outbound);
      expect(messages.single.peerAddress, 'hi@inf2.com');

      expect(
        (await outreach.getThreadById(thread.id))!.status,
        ThreadStatus.awaitingReply,
      );
      expect(
        (await influencers.getById('inf_002'))!.pipelineStage,
        PipelineStage.contacted,
      );
    });

    test('a second send does not move the pipeline again', () async {
      final influencers = MockInfluencerRepository();
      final outreach = MockOutreachRepository();
      final container = _container(
        influencers: influencers,
        outreach: outreach,
      );

      final thread = await outreach.getOrCreateThreadForInfluencer('inf_002');
      final controller =
          container.read(composeControllerProvider(thread.id).notifier);

      controller.setBody('one');
      await controller.markSent(
        thread: thread,
        influencer: (await influencers.getById('inf_002'))!,
      );

      // Reload the (now `awaitingReply`) thread and hand-set the stage to
      // something a human might have chosen; a second send must leave it be.
      final threadAfter = (await outreach.getThreadById(thread.id))!;
      await influencers.updatePipelineStage(
        'inf_002',
        PipelineStage.interested,
        base: (await influencers.getById('inf_002'))!.pipelineStage,
      );

      controller.setBody('two');
      await controller.markSent(
        thread: threadAfter,
        influencer: (await influencers.getById('inf_002'))!,
      );

      expect(
        (await influencers.getById('inf_002'))!.pipelineStage,
        PipelineStage.interested,
      );
      expect(await outreach.getMessages(thread.id), hasLength(2));
    });

    test('an empty draft does nothing', () async {
      final outreach = MockOutreachRepository();
      final influencers = MockInfluencerRepository();
      final container = _container(
        influencers: influencers,
        outreach: outreach,
      );
      final thread = await outreach.getOrCreateThreadForInfluencer('inf_002');

      final sent = await container
          .read(composeControllerProvider(thread.id).notifier)
          .markSent(
            thread: thread,
            influencer: (await influencers.getById('inf_002'))!,
          );

      expect(sent, isFalse);
      expect(await outreach.getMessages(thread.id), isEmpty);
    });
  });

  group('logReply', () {
    test('records an inbound message, flips to replied, clears reminders',
        () async {
      final outreach = MockOutreachRepository();
      final influencers = MockInfluencerRepository();
      final reminders = MockReminderRepository();
      final container = _container(
        influencers: influencers,
        outreach: outreach,
        reminders: reminders,
      );

      // thread_002 / inf_007 is seeded `awaitingReply` with an open reminder.
      final thread = (await outreach.getThreadById('thread_002'))!;
      final influencer = (await influencers.getById('inf_007'))!;
      expect(await reminders.getForInfluencer('inf_007'), isNotEmpty);

      await container
          .read(composeControllerProvider(thread.id).notifier)
          .logReply(
            thread: thread,
            influencer: influencer,
            body: 'Sounds good.',
            method: ContactMethod.email,
            at: DateTime.now(),
          );

      final messages = await outreach.getMessages(thread.id);
      final inbound = messages.where(
        (m) => m.direction == MessageDirection.inbound,
      );
      expect(inbound, hasLength(1));
      expect(inbound.single.body, 'Sounds good.');
      expect(
        (await outreach.getThreadById(thread.id))!.status,
        ThreadStatus.replied,
      );
      expect(await reminders.getForInfluencer('inf_007'), isEmpty);
    });
  });

  group('applyExternalDraft', () {
    test('puts the email in the composer, marked as AI, and nothing more', () {
      final container = _container();
      final compose = container.read(composeControllerProvider('t1').notifier);

      compose.applyExternalDraft(subject: 's', body: 'b');

      final state = container.read(composeControllerProvider('t1'));
      expect(
          (state.subject, state.body, state.lastDraftWasAi), ('s', 'b', true));
    });
  });

  group('follow-up reminders after a send', () {
    // The owner's rule (2026-10-18): nothing is queued behind a message; the
    // send sets a reminder for the next follow-up, timed by the house choices.
    final l10n = lookupAppLocalizations(const Locale('ar'));

    Future<(ComposeController, OutreachThread, Influencer)> ready(
      ProviderContainer container,
      MockOutreachRepository outreach,
      MockInfluencerRepository influencers,
    ) async {
      final thread = await outreach.getOrCreateThreadForInfluencer('inf_002');
      final influencer = (await influencers.getById('inf_002'))!;
      final controller =
          container.read(composeControllerProvider(thread.id).notifier)
            ..setRecipient('hi@inf2.com')
            ..setSubject('Hello')
            ..setBody('First contact.');
      return (controller, thread, influencer);
    }

    test('a first message sets "follow-up 1 of 3" one working day out',
        () async {
      final influencers = MockInfluencerRepository();
      final outreach = MockOutreachRepository();
      final reminders = MockReminderRepository();
      final container = _container(
          influencers: influencers, outreach: outreach, reminders: reminders);
      final (controller, thread, influencer) =
          await ready(container, outreach, influencers);

      await controller.markSent(thread: thread, influencer: influencer);

      final open = await reminders.getForInfluencer('inf_002');
      final followUp = open.singleWhere((r) => r.kind == ReminderKind.followUp);
      expect(followUp.title, l10n.outreachFollowUpNumbered(1, 3));
      final sentAt = (await outreach.getMessages(thread.id)).last.at.toLocal();
      expect(followUp.dueAt.toLocal(), addWorkingDays(sentAt, 1));
    });

    test(
        'the next send closes that reminder, keeps a deal deadline, and sets '
        'follow-up 2', () async {
      final influencers = MockInfluencerRepository();
      final outreach = MockOutreachRepository();
      final reminders = MockReminderRepository();
      final container = _container(
          influencers: influencers, outreach: outreach, reminders: reminders);
      final (controller, thread, influencer) =
          await ready(container, outreach, influencers);
      await reminders.create(FollowUpReminder(
        id: '',
        title: 'Contract due',
        dueAt: DateTime.utc(2030),
        kind: ReminderKind.dealDeadline,
        influencerId: 'inf_002',
      ));

      await controller.markSent(thread: thread, influencer: influencer);
      controller
        ..setSubject('Re: Hello')
        ..setBody('Bumping this.');
      await controller.markSent(thread: thread, influencer: influencer);

      final open = await reminders.getForInfluencer('inf_002');
      expect(
        [for (final r in open) r.title]..sort(),
        ['Contract due', l10n.outreachFollowUpNumbered(2, 3)]..sort(),
      );
    });

    test('after three follow-ups no reminder is set', () async {
      final influencers = MockInfluencerRepository();
      final outreach = MockOutreachRepository();
      final reminders = MockReminderRepository();
      final container = _container(
          influencers: influencers, outreach: outreach, reminders: reminders);
      final (controller, thread, influencer) =
          await ready(container, outreach, influencers);

      for (var i = 0; i < 4; i++) {
        controller
          ..setSubject('Message $i')
          ..setBody('Body $i');
        await controller.markSent(thread: thread, influencer: influencer);
      }

      final open = await reminders.getForInfluencer('inf_002');
      expect(open.where((r) => r.kind == ReminderKind.followUp), isEmpty);
    });
  });
}
