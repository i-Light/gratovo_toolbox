// Threads with a brand contact (fix #5/#6): outreach_threads.brand_id and
// contact_email. They live beside the channel threads without showing up in
// the channel-centric Outreach list.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/outreach_repository.dart';

import 'memory_mirror.dart';

void main() {
  for (final (name, make) in [
    ('mirror', () => MirrorOutreachRepository(MemoryMirror())),
    ('mock', MockOutreachRepository.new),
  ]) {
    group(name, () {
      late OutreachRepository repo;
      setUp(() => repo = make());

      test('one thread per brand contact, reused', () async {
        final first =
            await repo.getOrCreateThreadForBrand('b1', 'jack@runway.ml');
        final again =
            await repo.getOrCreateThreadForBrand('b1', 'Jack@Runway.ml');
        final other =
            await repo.getOrCreateThreadForBrand('b1', 'mia@runway.ml');

        expect(again.id, first.id, reason: 'addresses compare without case');
        expect(other.id, isNot(first.id));
        expect(first.isBrandThread, isTrue);
        expect(first.brandId, 'b1');
        expect(first.contactEmail, 'jack@runway.ml');
        expect((await repo.getThreadsForBrand('b1')).length, 2);
      });

      test('brand threads stay out of the channel thread list', () async {
        final channelThreads = (await repo.getAllThreads()).length;
        await repo.getOrCreateThreadForBrand('b2', 'x@brand.io');

        expect((await repo.getAllThreads()).length, channelThreads);
      });
    });
  }

  test('a brand thread is queued with its brand and contact', () async {
    final db = MemoryMirror();
    final repo = MirrorOutreachRepository(db);

    final thread = await repo.getOrCreateThreadForBrand('b1', 'jack@runway.ml');

    final queued = await db
        .getAll("SELECT payload FROM _outbox WHERE kind = 'row.upsert'");
    final row =
        (jsonDecode(queued.single['payload']! as String) as Map)['row'] as Map;
    expect(row['id'], thread.id);
    expect(row['brand_id'], 'b1');
    expect(row['contact_email'], 'jack@runway.ml');
    expect(row['channel_id'], isNull);
  });
}
