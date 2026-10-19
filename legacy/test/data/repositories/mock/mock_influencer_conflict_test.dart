import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/edit_conflict.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';

/// The Dart half of the rules `backend/tests/test_12_conflicts.sql` pins on the
/// database side. Both implementations of the compare-and-set have to agree, or
/// a mock-backed widget test proves nothing about the real thing.
///
/// The cases are chosen from the definition rather than from the code: a
/// conflict is *an edit written against a value that is no longer there*, not
/// two people touching the same field.
void main() {
  const id = 'inf_001';

  Future<String?> notesOf(MockInfluencerRepository repo) async =>
      (await repo.getById(id))!.notes;

  group('sequential collaboration never conflicts', () {
    test('editing on top of what a colleague saved applies', () async {
      final repo = MockInfluencerRepository();
      final original = await notesOf(repo);

      // Sara saves.
      expect(
        (await repo.updateNotes(id, 'Sara was here.', base: original))
            .succeeded,
        isTrue,
      );

      // I open the page afterwards, so *her* text is my base.
      final mine = await notesOf(repo);
      expect(mine, 'Sara was here.');
      final outcome =
          await repo.updateNotes(id, 'Sara was here. So was Omar.', base: mine);

      expect(outcome, EditOutcome.applied);
      expect(await notesOf(repo), 'Sara was here. So was Omar.');
    });

    test('and again, indefinitely, in either direction', () async {
      final repo = MockInfluencerRepository();
      for (var i = 0; i < 10; i++) {
        final base = await notesOf(repo);
        final outcome = await repo.updateNotes(id, 'round $i', base: base);
        expect(outcome, EditOutcome.applied, reason: 'round $i');
      }
      expect(await notesOf(repo), 'round 9');
    });
  });

  group('a stale base conflicts', () {
    test('two edits from the same base: the second is refused', () async {
      final repo = MockInfluencerRepository();
      final shared = await notesOf(repo);

      expect(await repo.updateNotes(id, 'hers', base: shared),
          EditOutcome.applied);
      expect(await repo.updateNotes(id, 'his', base: shared),
          EditOutcome.conflict);

      // The refused value must not be on the record. A conflict that still
      // wrote would be a lost update wearing a warning label.
      expect(await notesOf(repo), 'hers');
    });

    test('the same value from both sides settles itself', () async {
      final repo = MockInfluencerRepository();
      final shared = await notesOf(repo);

      await repo.updateNotes(id, 'agreed', base: shared);
      expect(
          await repo.updateNotes(id, 'agreed', base: shared), EditOutcome.auto);
      expect(await notesOf(repo), 'agreed');
    });

    test('an edit that changes nothing is a no-op, not a write', () async {
      final repo = MockInfluencerRepository();
      final shared = await notesOf(repo);
      expect(await repo.updateNotes(id, shared ?? '', base: shared),
          EditOutcome.noop);
    });

    test('null and empty text are the same fact', () async {
      final repo = MockInfluencerRepository();
      await repo.updateNotes(id, '', base: await notesOf(repo));
      expect(await repo.updateNotes(id, '', base: null), EditOutcome.noop);
    });
  });

  group('the check is per field, not per row', () {
    test('a stage edit does not invalidate a pending notes edit', () async {
      final repo = MockInfluencerRepository();
      final before = (await repo.getById(id))!;

      // Sara changes the stage after I loaded the page but before I save my
      // notes. On a row-level token (`updated_at`) my save would now be
      // refused — which is the false conflict this design exists to avoid.
      await repo.updatePipelineStage(id, PipelineStage.interested,
          base: before.pipelineStage);

      expect(
        await repo.updateNotes(id, 'my paragraph', base: before.notes),
        EditOutcome.applied,
      );
    });
  });

  group('list comparison is order-insensitive', () {
    test('reordered tags are not a conflict', () async {
      final repo = MockInfluencerRepository();
      final before = (await repo.getById(id))!.channelTags;

      await repo.updateChannelTags(
        id,
        [ChannelTag.qualified, ChannelTag.undecided],
        base: before,
      );

      // Somebody else holds the same two tags, listed the other way round.
      // That is the same set, so their edit builds on it rather than diverging.
      final outcome = await repo.updateChannelTags(
        id,
        [ChannelTag.qualified],
        base: [ChannelTag.undecided, ChannelTag.qualified],
      );
      expect(outcome, EditOutcome.applied);
    });

    test('reordered relevance criteria are not a conflict', () async {
      final repo = MockInfluencerRepository();
      await repo.updateRelevanceCriteria(id, ['a', 'b'],
          base: (await repo.getById(id))!.relevanceCriteria);

      final outcome = await repo
          .updateRelevanceCriteria(id, ['a', 'b', 'c'], base: ['b', 'a']);
      expect(outcome, EditOutcome.applied);
    });

    // Contacts are ordered on purpose: the first one is the one the app
    // reaches for, so moving a contact to the front is a real change and must
    // not be absorbed as "the same set". This mirrors `canonical_edit_value`,
    // which sorts tags and criteria and deliberately does not sort contacts.
    test('reordered contacts ARE a change', () async {
      final repo = MockInfluencerRepository();
      const a =
          InfluencerContact(method: ContactMethod.email, value: 'a@x.com');
      const b =
          InfluencerContact(method: ContactMethod.email, value: 'b@x.com');

      final before = (await repo.getById(id))!.contacts;
      await repo.updateContacts(id, const [a, b], base: before);

      expect(await repo.updateContacts(id, const [b, a], base: const [a, b]),
          EditOutcome.applied);
      expect((await repo.getById(id))!.contacts.first.value, 'b@x.com');
    });
  });

  test('editing a channel that is gone reports missing, not conflict',
      () async {
    final repo = MockInfluencerRepository();
    expect(await repo.updateNotes('no_such_channel', 'x', base: null),
        EditOutcome.missing);
  });
}
