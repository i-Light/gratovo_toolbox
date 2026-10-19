// The Comms queue's items (comms_proposals, synced): what the engine proposed
// and what a person did with it.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/comms_protocol.dart';
import 'package:gratovo_toolbox/data/models/comms_proposal.dart';
import 'package:gratovo_toolbox/data/repositories/comms_proposal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_comms_proposal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_comms_proposal_repository.dart';

import 'memory_mirror.dart';

CommsProposal _proposal({
  String id = '',
  CommsQueueStatus status = CommsQueueStatus.proposed,
  DateTime? at,
}) =>
    CommsProposal(
      id: id,
      kind: CommsKind.reply,
      status: status,
      threadId: 't1',
      channelId: 'UC_a',
      engineStatus: CommsEngineStatus.needsHuman,
      situation: const {'reply_type': 'inf.asks_price_from_us'},
      steer: const {'english': 'nonnative'},
      action: 'send_message',
      why: 'Ask their rate first.',
      rules: const ['INF-PRICE-09'],
      needsHuman: const [CommsGate(what: 'price', detail: 'confirm')],
      subject: 'Re: hi',
      body: 'What do you charge?',
      followUpDays: 2,
      createdAt: at ?? DateTime.utc(2026, 10, 18, 9),
      updatedAt: at ?? DateTime.utc(2026, 10, 18, 9),
    );

void main() {
  for (final (name, make) in [
    ('mirror', () => MirrorCommsProposalRepository(MemoryMirror())),
    ('mock', MockCommsProposalRepository.new),
  ]) {
    group(name, () {
      late CommsProposalRepository repo;
      setUp(() => repo = make());

      test('a proposal is saved whole and read back', () async {
        final saved = await repo.save(_proposal());

        expect(saved.id, isNotEmpty);
        final read = (await repo.getById(saved.id))!;
        expect(read.kind, CommsKind.reply);
        expect(read.engineStatus, CommsEngineStatus.needsHuman);
        expect(read.situation['reply_type'], 'inf.asks_price_from_us');
        expect(read.steer, {'english': 'nonnative'});
        expect(read.rules, ['INF-PRICE-09']);
        expect(read.needsHuman.single.what, 'price');
        expect(read.body, 'What do you charge?');
        expect(read.followUpDays, 2);
      });

      test('the open queue is what still waits for a person, newest first',
          () async {
        await repo.save(_proposal(at: DateTime.utc(2026, 10, 18, 8)));
        final newer =
            await repo.save(_proposal(at: DateTime.utc(2026, 10, 18, 10)));
        final done = await repo.save(_proposal());
        await repo.decide(done.id, CommsQueueStatus.sent, decidedBy: 'u1');

        final open = await repo.getOpen();

        expect(open.length, 2);
        expect(open.first.id, newer.id);
      });

      test('a decision records who, when, and the text that went', () async {
        final saved = await repo.save(_proposal());

        await repo.decide(saved.id, CommsQueueStatus.sent,
            decidedBy: 'u1', subject: 'Re: hi', body: 'Edited text.');

        final read = (await repo.getById(saved.id))!;
        expect(read.status, CommsQueueStatus.sent);
        expect(read.decidedBy, 'u1');
        expect(read.decidedAt, isNotNull);
        expect(read.body, 'Edited text.');
      });

      test('drafts are counted from a moment on, whatever became of them',
          () async {
        await repo.save(_proposal(at: DateTime.utc(2026, 10, 17, 23)));
        await repo.save(_proposal(at: DateTime.utc(2026, 10, 18, 8)));
        final sent =
            await repo.save(_proposal(at: DateTime.utc(2026, 10, 18, 10)));
        await repo.decide(sent.id, CommsQueueStatus.sent);

        expect(await repo.countCreatedSince(DateTime.utc(2026, 10, 18)), 2);
      });
    });
  }

  test('the team gets the row with its JSON as JSON', () async {
    final db = MemoryMirror();
    final repo = MirrorCommsProposalRepository(db);

    await repo.save(_proposal());

    final queued = await db.getAll('SELECT payload FROM _outbox');
    final row =
        (jsonDecode(queued.single['payload']! as String) as Map)['row'] as Map;
    expect(row['rules'], ['INF-PRICE-09']);
    expect(row['needs_human'], [
      {'what': 'price', 'detail': 'confirm'}
    ]);
    expect(row['situation'], {'reply_type': 'inf.asks_price_from_us'});
    expect(row['kind'], 'reply');
    expect(row['status'], 'proposed');
    expect(row['engine_status'], 'needs_human');
  });
}
