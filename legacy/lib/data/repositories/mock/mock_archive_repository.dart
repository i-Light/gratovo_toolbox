import 'package:gratovo_toolbox/data/models/archived_channel.dart';
import 'package:gratovo_toolbox/data/models/bulk_archive_due.dart';
import 'package:gratovo_toolbox/data/models/bulk_rejection.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/keyword_view_sample.dart';
import 'package:gratovo_toolbox/data/repositories/archive_repository.dart';

/// In-memory archive, used when there is no client or nobody is signed in.
///
/// Seeded rather than empty, for the reason every mock here is: an empty
/// archive and a broken archive look identical on screen, and the page's whole
/// job is to show rows.
///
/// The filtering and sorting below deliberately match what
/// the local repository reads, including the channel_id
/// tie-break — a mock that pages differently from production is a mock that
/// hides paging bugs rather than surfacing them.
class MockArchiveRepository implements ArchiveRepository {
  MockArchiveRepository();

  final List<ArchivedChannel> _rows = [
    ArchivedChannel(
      channelId: 'arc_001',
      handle: '@gamblingtipsdaily',
      label: ChannelTag.haramStuff,
      subscriberCount: 184000,
      medianViewsLast30: 22400,
      videosFound: 15,
      foundAt: DateTime.utc(2026, 1, 10),
      archivedAt: DateTime.utc(2026, 7, 5),
      // A keyword that only ever brought in rejected channels — it shows on the
      // keyword card only once "Archived" is ticked.
      foundVia: [
        ArchiveKeywordHit(
          keyword: 'gambling tips',
          discoveredAt: DateTime.utc(2026, 1, 10),
        ),
      ],
    ),
    ArchivedChannel(
      channelId: 'arc_002',
      handle: '@vintagetractorrestoration',
      label: ChannelTag.irrelevant,
      subscriberCount: 51200,
      medianViewsLast30: 8100,
      videosFound: 9,
      foundAt: DateTime.utc(2025, 11, 22),
      archivedAt: DateTime.utc(2026, 7, 17),
      // Shares a keyword with a live channel, so "easy recipes" carries both a
      // live and an archived segment on the keyword card.
      foundVia: [
        ArchiveKeywordHit(
          keyword: 'easy recipes',
          discoveredAt: DateTime.utc(2025, 11, 22),
        ),
      ],
    ),
    ArchivedChannel(
      channelId: 'arc_003',
      handle: '@dormantcookingchannel',
      label: ChannelTag.irrelevant,
      subscriberCount: 9800,
      // Two recent uploads on record, neither of which ever had a view count
      // fetched — so the average is null, not zero, the same distinction the
      // CRM calculator makes.
      medianViewsLast30: null,
      videosFound: 2,
      foundAt: DateTime.utc(2026, 3, 4),
      archivedAt: DateTime.utc(2026, 8, 12),
    ),
  ];

  @override
  Future<List<ArchivedChannel>> getPage({
    required int offset,
    required int limit,
    ArchiveQuery query = const ArchiveQuery(),
  }) async {
    final search = query.search.trim().toLowerCase();
    final matches = [
      for (final row in _rows)
        if ((search.isEmpty || row.handle.toLowerCase().contains(search)) &&
            (query.label == null || row.label == query.label))
          row,
    ]..sort((a, b) {
        final compared = switch (query.sortBy) {
          ArchiveSortBy.archivedAt => a.archivedAt.compareTo(b.archivedAt),
          ArchiveSortBy.handle => a.handle.compareTo(b.handle),
          ArchiveSortBy.subscribers =>
            (a.subscriberCount ?? -1).compareTo(b.subscriberCount ?? -1),
          ArchiveSortBy.medianViews =>
            (a.medianViewsLast30 ?? -1).compareTo(b.medianViewsLast30 ?? -1),
          ArchiveSortBy.videosFound =>
            (a.videosFound ?? -1).compareTo(b.videosFound ?? -1),
        };
        if (compared != 0) return query.descending ? -compared : compared;
        return a.channelId.compareTo(b.channelId);
      });

    if (offset >= matches.length) return const [];
    return matches.sublist(offset, (offset + limit).clamp(0, matches.length));
  }

  @override
  Future<List<ArchivedChannel>> getAll() async => List.unmodifiable(_rows);

  @override
  Future<List<KeywordViewSample>> keywordViewSamples() async => [
        for (final row in _rows)
          if (row.medianViewsLast30 case final views?)
            for (final hit in row.foundVia)
              KeywordViewSample(keyword: hit.keyword, medianViews: views),
      ];

  @override
  Future<int> count() async => _rows.length;

  @override
  Future<Set<String>> archivedIdsAmong(List<String> channelIds) async {
    final wanted = channelIds.toSet();
    return {
      for (final row in _rows)
        if (wanted.contains(row.channelId)) row.channelId,
    };
  }

  @override
  Future<void> updateLabel(String channelId, ChannelTag label) async {
    final index = _rows.indexWhere((row) => row.channelId == channelId);
    if (index != -1) _rows[index] = _rows[index].copyWith(label: label);
  }

  @override
  Future<void> unarchive(String channelId) async {
    _rows.removeWhere((row) => row.channelId == channelId);
  }

  @override
  Future<BulkRejectionOutcome> bulkReject(
    BulkRejectionRequest request, {
    bool dryRun = true,
    void Function(int swept, int total)? onSweepProgress,
    bool Function()? shouldStop,
  }) async {
    // Nothing, on purpose, rather than a plausible-looking number.
    //
    // Bulk rejection operates on the LIVE channel table, which this repository
    // does not have — it holds three already-archived rows and nothing to
    // reject. Every other mock here seeds data because an empty screen and a
    // broken screen look the same; this one is the opposite case. A mock that
    // reported "4,812 channels would be tagged" against a database it cannot
    // see would be a rehearsal of a destructive action whose numbers are
    // invented, and somebody would eventually believe them.
    return BulkRejectionOutcome.empty;
  }

  @override
  Future<BulkArchiveDueOutcome> bulkManageArchiveDue(
    BulkArchiveDueRequest request, {
    bool dryRun = true,
    void Function(int swept, int total)? onSweepProgress,
    bool Function()? shouldStop,
  }) async {
    // Same reasoning as [bulkReject]: this acts on `channels.archive_due_at`,
    // which this repository -- three already-archived rows and nothing
    // currently counting down -- has no version of to report honestly.
    return BulkArchiveDueOutcome.empty;
  }
}
