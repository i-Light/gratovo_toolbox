import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_outreach_repository.dart';

void main() {
  group('MockOutreachRepository', () {
    test('getThreadById finds a seeded thread by id', () async {
      final repo = MockOutreachRepository();
      final thread = await repo.getThreadById('thread_001');
      expect(thread, isNotNull);
      expect(thread!.influencerId, 'inf_001');
    });

    test('getThreadById returns null for an unknown id', () async {
      final repo = MockOutreachRepository();
      expect(await repo.getThreadById('does_not_exist'), isNull);
    });

    test('getThreadByInfluencer finds the one thread per influencer', () async {
      final repo = MockOutreachRepository();
      final thread = await repo.getThreadByInfluencer('inf_007');
      expect(thread, isNotNull);
      expect(thread!.id, 'thread_002');
    });

    test(
        'getOrCreateThreadForInfluencer returns the existing thread instead '
        'of creating a duplicate', () async {
      final repo = MockOutreachRepository();
      final before = await repo.getAllThreads();
      final thread = await repo.getOrCreateThreadForInfluencer('inf_001');
      final after = await repo.getAllThreads();

      expect(thread.id, 'thread_001');
      expect(after.length, before.length);
    });

    test(
        'getOrCreateThreadForInfluencer creates a new thread when none '
        'exists yet', () async {
      final repo = MockOutreachRepository();
      final before = await repo.getAllThreads();
      final thread =
          await repo.getOrCreateThreadForInfluencer('inf_never_contacted');
      final after = await repo.getAllThreads();

      expect(thread.status, ThreadStatus.notContactedYet);
      expect(thread.influencerId, 'inf_never_contacted');
      expect(after.length, before.length + 1);
    });

    test('updateThreadStatus changes only that thread\'s status', () async {
      final repo = MockOutreachRepository();
      await repo.updateThreadStatus('thread_003', ThreadStatus.replied);

      final updated = await repo.getThreadById('thread_003');
      expect(updated!.status, ThreadStatus.replied);

      final untouched = await repo.getThreadById('thread_001');
      expect(untouched!.status, ThreadStatus.replied);
    });

    test('recordMessage stores the message and generates a unique id',
        () async {
      final repo = MockOutreachRepository();
      final before = await repo.getMessages('thread_001');

      final message = await repo.recordMessage(
        threadId: 'thread_001',
        direction: MessageDirection.outbound,
        subject: 'Contract signed',
        body: 'Great news, everything is finalized.',
        isAiDrafted: true,
        templateId: 'tmpl_003',
      );

      final after = await repo.getMessages('thread_001');
      expect(after.length, before.length + 1);
      expect(after.map((m) => m.id).toSet().length, after.length);
      expect(message.threadId, 'thread_001');
      expect(message.isAiDrafted, isTrue);
    });

    test('recordMessage defaults to the email method', () async {
      final repo = MockOutreachRepository();
      final message = await repo.recordMessage(
        threadId: 'thread_001',
        direction: MessageDirection.outbound,
        subject: 'Hi',
        body: 'Hello',
      );
      expect(message.method, ContactMethod.email);
      expect(message.peerAddress, isNull);
    });

    test('recordMessage keeps the method, peer address and an explicit time',
        () async {
      final repo = MockOutreachRepository();
      final received = DateTime(2026, 3, 1, 9, 30);

      final message = await repo.recordMessage(
        threadId: 'thread_002',
        direction: MessageDirection.inbound,
        subject: '',
        body: 'They replied on WhatsApp.',
        method: ContactMethod.whatsapp,
        peerAddress: '+201234567890',
        at: received,
      );

      expect(message.method, ContactMethod.whatsapp);
      expect(message.peerAddress, '+201234567890');
      expect(message.at, received);

      final stored = await repo.getMessages('thread_002');
      final logged = stored.firstWhere((m) => m.id == message.id);
      expect(logged.method, ContactMethod.whatsapp);
      expect(logged.peerAddress, '+201234567890');
      expect(logged.at, received);
    });

    test('getMessages returns only that thread\'s messages, oldest first',
        () async {
      final repo = MockOutreachRepository();
      final messages = await repo.getMessages('thread_001');

      expect(messages, isNotEmpty);
      expect(messages.every((m) => m.threadId == 'thread_001'), isTrue);
      for (var i = 1; i < messages.length; i++) {
        expect(
          messages[i].at.isAfter(messages[i - 1].at) ||
              messages[i].at.isAtSameMomentAs(messages[i - 1].at),
          isTrue,
        );
      }
    });
  });
}
