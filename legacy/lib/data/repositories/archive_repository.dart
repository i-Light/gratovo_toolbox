import 'package:gratovo_toolbox/data/models/archived_channel.dart';
import 'package:gratovo_toolbox/data/models/bulk_archive_due.dart';
import 'package:gratovo_toolbox/data/models/bulk_rejection.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/keyword_view_sample.dart';

/// Reads the archive, plus the writes that change what is in it: [bulkReject]
/// and [unarchive] change which rows exist, and [updateLabel] corrects the
/// reason on a row that stays.
///
/// Deliberately has no `archive(...)` method, and [bulkReject] is not one in
/// disguise. Archiving is not something a screen does — it is what the
/// archive sweep does (`sweepDueArchives` in `local_archive.dart`, run on
/// every sync tick), 7 days after a channel is tagged. A screen's side of
/// that is only ever *tagging*, which is an ordinary channel-tags edit
/// through [InfluencerRepository.updateChannelTags], and bringing the date
/// forward, which is [InfluencerRepository.archiveNow].
///
/// An `archive()` here would offer a second route to a permanent, cascading
/// delete that skipped the grace period the whole design is built around.
/// [bulkReject] does the first of those two things — tagging — to many rows at
/// once, and reaches the delete only through the same sweep everything else
/// does.
abstract class ArchiveRepository {
  /// One page of archived channels, filtered and sorted by the database.
  Future<List<ArchivedChannel>> getPage({
    required int offset,
    required int limit,
    ArchiveQuery query = const ArchiveQuery(),
  });

  /// Every archived channel, unfiltered and unpaged.
  ///
  /// The honest method for a caller that genuinely needs the whole table rather
  /// than a page of it — the Dashboard's keyword evaluation, which folds each
  /// archived channel's [ArchivedChannel.foundVia] keywords back into the live
  /// keyword breakdown so a search term is scored on what it found, not only on
  /// what survived vetting. Same shape and same reasoning as
  /// [InfluencerRepository.getAll]: `channel_archive` is small by construction
  /// (it is what is left after the bulk was deleted), so this is one read, and a
  /// caller paging in a loop it wrote itself would only be reimplementing it
  /// worse.
  Future<List<ArchivedChannel>> getAll();

  /// Every (keyword, median views) pair across the archive — one per entry in
  /// each tombstone's [ArchivedChannel.foundVia], for tombstones with a
  /// measured median. The archived half of the Dashboard's keyword
  /// evaluation; see [InfluencerRepository.keywordViewSamples] for why this
  /// is a query rather than a fold over [getAll].
  Future<List<KeywordViewSample>> keywordViewSamples();

  /// How many rows the archive holds in total, ignoring any filter.
  Future<int> count();

  /// Whether these channel ids are archived.
  ///
  /// Batched rather than one call per id: the influencer list needs this for a
  /// whole page at once, and asking per row is the N+1 the `influencer_rows`
  /// view exists to keep out of that screen.
  Future<Set<String>> archivedIdsAmong(List<String> channelIds);

  /// Corrects the rejecting label on an already-archived row.
  ///
  /// [label] must be one of [ChannelTag.rejecting]; anything else is refused.
  /// Not a compare-and-set: the Archive page has no conflict UI, this is a
  /// rare correction rather than a contested field, and two people fixing the
  /// same stale label land on the same answer.
  Future<void> updateLabel(String channelId, ChannelTag label);

  /// Removes the tombstone, so the channel can be discovered again.
  ///
  /// This does NOT restore anything — there is nothing to restore. The videos,
  /// notes and contacts were deleted when it was archived and are gone. All
  /// this does is stop the pipeline skipping the channel, so the next search
  /// that finds it treats it as new.
  ///
  /// Called from [InfluencerRepository.create] when somebody re-adds an
  /// archived channel by hand, which is the agreed way back: a search never
  /// resurrects a rejected channel, a person deliberately can.
  Future<void> unarchive(String channelId);

  /// Tags every channel in a subscriber range as rejected, in one statement.
  ///
  /// The Archive page's bulk clean — see [BulkRejectionRequest] for what it
  /// does and, more importantly, what it does not.
  ///
  /// **Call it with `dryRun: true` first.** The dry run is not a nicety: this
  /// starts a countdown to a permanent, cascading delete on an unbounded number
  /// of rows, and the only thing between a mistyped bound and losing thousands
  /// of channels is a person having seen the count before agreeing to it. Both
  /// the database function and the dialog default to the dry run for that
  /// reason.
  ///
  /// [onSweepProgress] is called as an immediate clean deletes its channels,
  /// with how many are gone and how many there are in total. The deletions go
  /// in batches so the dialog has something to show; a destructive operation
  /// that shows nothing for a while is one people kill halfway through.
  ///
  /// [shouldStop] is checked between batches. Stopping is a real answer rather
  /// than an abort: everything already tagged stays tagged and due, so the
  /// sweep on the next sync tick finishes whatever the batches did not.
  Future<BulkRejectionOutcome> bulkReject(
    BulkRejectionRequest request, {
    bool dryRun = true,
    void Function(int swept, int total)? onSweepProgress,
    bool Function()? shouldStop,
  });

  /// Acts on channels that are ALREADY tagged rejected and already counting
  /// down — the "Scheduled for archive" side of the same bulk clean tool. See
  /// [BulkArchiveDueRequest] for what [ArchiveDueAction.archiveNow] and
  /// [ArchiveDueAction.undo] do and why neither one is a fresh rejection.
  ///
  /// Same two-step shape as [bulkReject]: call with `dryRun: true` first and
  /// show the count, because [ArchiveDueAction.archiveNow] starts a permanent,
  /// cascading delete the same as [bulkReject] does, just on channels that
  /// were already headed there.
  ///
  /// [onSweepProgress] and [shouldStop] mean the same thing they do on
  /// [bulkReject], and only apply to [ArchiveDueAction.archiveNow] — an
  /// [ArchiveDueAction.undo] is one UPDATE with nothing to batch.
  Future<BulkArchiveDueOutcome> bulkManageArchiveDue(
    BulkArchiveDueRequest request, {
    bool dryRun = true,
    void Function(int swept, int total)? onSweepProgress,
    bool Function()? shouldStop,
  });
}
