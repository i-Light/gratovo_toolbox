import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/archived_channel.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_archive_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';

void main() {
  group('MockArchiveRepository', () {
    test('returns the seeded rows newest first by default', () async {
      final repo = MockArchiveRepository();
      final rows = await repo.getPage(offset: 0, limit: 50);
      expect(rows, hasLength(3));
      expect(rows.first.channelId, 'arc_003');
    });

    test('filters by label', () async {
      final repo = MockArchiveRepository();
      final rows = await repo.getPage(
        offset: 0,
        limit: 50,
        query: const ArchiveQuery(label: ChannelTag.haramStuff),
      );
      expect(rows, hasLength(1));
      expect(rows.single.handle, '@gamblingtipsdaily');
    });

    test('searches the handle case-insensitively', () async {
      final repo = MockArchiveRepository();
      final rows = await repo.getPage(
        offset: 0,
        limit: 50,
        query: const ArchiveQuery(search: 'TRACTOR'),
      );
      expect(rows.single.channelId, 'arc_002');
    });

    test('sorting ascending reverses the order', () async {
      final repo = MockArchiveRepository();
      final rows = await repo.getPage(
        offset: 0,
        limit: 50,
        query: const ArchiveQuery(
          sortBy: ArchiveSortBy.subscribers,
          descending: false,
        ),
      );
      expect(
        [for (final r in rows) r.subscriberCount],
        [9800, 51200, 184000],
      );
    });

    test('archivedIdsAmong answers for a batch, not one at a time', () async {
      final repo = MockArchiveRepository();
      final found = await repo.archivedIdsAmong(
        ['arc_001', 'inf_001', 'arc_003'],
      );
      expect(found, {'arc_001', 'arc_003'});
    });

    test('unarchive removes the tombstone', () async {
      final repo = MockArchiveRepository();
      await repo.unarchive('arc_001');
      expect(await repo.count(), 2);
      expect(await repo.archivedIdsAmong(['arc_001']), isEmpty);
    });

    // A channel whose uploads never had a view count recorded is a different
    // fact from one averaging zero views, and the archive keeps that
    // distinction rather than flattening it — the same rule the CRM calculator
    // follows.
    test('a null average is preserved, not turned into zero', () async {
      final repo = MockArchiveRepository();
      final rows = await repo.getPage(offset: 0, limit: 50);
      final dormant = rows.firstWhere((r) => r.channelId == 'arc_003');
      expect(dormant.medianViewsLast30, isNull);
    });

    test('the channel URL is rebuilt from the handle', () {
      final row = ArchivedChannel(
        channelId: 'x',
        handle: 'nohandleprefix',
        label: ChannelTag.irrelevant,
        archivedAt: DateTime.utc(2026, 8, 1),
      );
      expect(row.channelUrl, 'https://www.youtube.com/@nohandleprefix');
    });
  });

  // These pin the mock against `trg_channels_archive_due` in
  // backend/schema.sql. The two are meant to agree; a mock that gets this
  // wrong makes the countdown look right in tests and behave differently
  // against a real database.
  group('the archive countdown mirrors the database trigger', () {
    test('a rejecting tag starts a countdown', () async {
      final repo = MockInfluencerRepository();
      await _setTags(repo, [ChannelTag.irrelevant]);
      final after = await repo.getById('inf_001');
      expect(after!.isPendingArchive, isTrue);
      expect(after.daysUntilArchive, 6); // 7 days out, minus a partial day
    });

    test('removing the tag cancels it', () async {
      final repo = MockInfluencerRepository();
      await _setTags(repo, [ChannelTag.irrelevant]);
      await _setTags(repo, [ChannelTag.qualified]);
      expect((await repo.getById('inf_001'))!.isPendingArchive, isFalse);
    });

    // A channel somebody has argued about. The archive is not where a
    // disagreement gets settled.
    test('a rejecting tag alongside approved does not count down', () async {
      final repo = MockInfluencerRepository();
      await _setTags(repo, [ChannelTag.irrelevant, ChannelTag.qualified]);
      expect((await repo.getById('inf_001'))!.isPendingArchive, isFalse);
    });

    // `archiveNow` archives — it does not merely re-date. The button says
    // "Archive now", the dialog in front of it says the deletion is permanent
    // and cascading, and both the Supabase and mirror paths now run
    // `archive_due_channels` for the channel rather than leaving it to the
    // 03:17 UTC cron. The mock is the only implementation a test can watch the
    // whole of, so this is where that contract is pinned.
    test('archiveNow only applies to a channel that is tagged rejected',
        () async {
      final repo = MockInfluencerRepository();

      // Untagged: refused outright, the same way the trigger erases a date
      // written onto a channel whose tags do not warrant one.
      await repo.archiveNow('inf_001');
      final untouched = await repo.getById('inf_001');
      expect(untouched, isNotNull);
      expect(untouched!.isPendingArchive, isFalse);

      // Tagged: gone, not counting down.
      await _setTags(repo, [ChannelTag.haramStuff]);
      await repo.archiveNow('inf_001');
      expect(await repo.getById('inf_001'), isNull);
    });
  });

  group('Influencer.isRejectedBy', () {
    test('is false for no tags at all', () {
      expect(Influencer.isRejectedBy(const []), isFalse);
    });

    test('is true only when every tag is a rejection', () {
      expect(Influencer.isRejectedBy(const [ChannelTag.irrelevant]), isTrue);
      expect(Influencer.isRejectedBy(const [ChannelTag.haramStuff]), isTrue);
      expect(
        Influencer.isRejectedBy(
          const [ChannelTag.haramStuff, ChannelTag.irrelevant],
        ),
        isTrue,
      );
      expect(
        Influencer.isRejectedBy(
          const [ChannelTag.irrelevant, ChannelTag.undecided],
        ),
        isFalse,
      );
    });
  });
}

/// Sets the tags on the fixture channel, passing the base the repository's
/// compare-and-set requires and insisting the write actually landed.
///
/// Worth the ceremony: without the outcome check a refused write would leave
/// the tags unchanged, and every countdown assertion below would then be
/// testing the seed data rather than the trigger it is meant to pin.
Future<void> _setTags(
  MockInfluencerRepository repo,
  List<ChannelTag> tags,
) async {
  final before = (await repo.getById('inf_001'))!.channelTags;
  final outcome = await repo.updateChannelTags('inf_001', tags, base: before);
  expect(outcome.succeeded, isTrue);
}
