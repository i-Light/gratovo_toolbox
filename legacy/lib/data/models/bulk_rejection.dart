import 'package:gratovo_toolbox/data/models/influencer.dart';

/// A request to tag every channel in a size range as rejected.
///
/// The bulk clean, offered on the Archive page and on the Search page. It
/// exists for one recurring job: a broad
/// keyword drags in several thousand channels too small to ever work with, and
/// clearing those a row at a time is twenty minutes of clicking, which in
/// practice means it does not happen and the influencer list stays unusable.
///
/// What it is NOT is a delete. It writes exactly what clicking `irrelevant` on
/// one row writes — a tag, and the countdown the database derives from it. The
/// deletion is still `archive_due_channels`, still on its own schedule, still
/// behind its own guards. [immediate] moves the date, not the mechanism.
class BulkRejectionRequest {
  const BulkRejectionRequest({
    this.minSubscribers,
    this.maxSubscribers,
    this.minMedianViews,
    this.maxMedianViews,
    this.minVideosLast30,
    this.firstSeenAfter,
    this.untouchedOnly = false,
    this.label = ChannelTag.irrelevant,
    this.immediate = false,
  });

  /// Inclusive. Null means unbounded on that side — but not every bound may be
  /// null at once: the database refuses a request open at both ends of both
  /// ranges, because a range that matches every channel is almost always a
  /// caller that forgot to pass its bounds, and the cost of being wrong is the
  /// whole table.
  final int? minSubscribers;
  final int? maxSubscribers;

  /// Inclusive bounds on the trailing-30-day median views, matched against
  /// `channels.median_views_last_30`.
  ///
  /// A second dimension rather than a replacement, and the two narrow together
  /// — a channel has to satisfy every bound that was actually set. Subscriber
  /// count alone is the wrong question surprisingly often: a channel with
  /// 80,000 subscribers whose videos do 300 views is dead, and one with 2,000
  /// subscribers doing 40,000 views a video is exactly who the agency wants.
  /// Rejecting on subscribers alone throws away the second and keeps the first.
  final int? minMedianViews;
  final int? maxMedianViews;

  /// Reject a channel that has fewer than this many videos published in the
  /// trailing 30 days, matched against `channels.videos_last_30`.
  ///
  /// A strict "fewer than", not an inclusive bound like the ranges above: the
  /// number you type is the floor a channel has to clear to be kept, so a
  /// channel sitting exactly on it survives. `videos_last_30` is never null —
  /// the column is `not null default 0` — so unlike the subscriber and
  /// average-views bounds this one has no "unknown" case to report.
  final int? minVideosLast30;

  /// Only channels first discovered at or after this instant.
  ///
  /// Null means the whole table, which is what the Archive page's dialog asks
  /// for — a person has read a count and is about to confirm it. The Search
  /// page's automatic post-run sweep always sets it, to the moment its run
  /// started, and that is what makes an unattended caller safe: it reaches
  /// exactly the channels that run brought in and cannot reach a channel found
  /// last week or one somebody has already decided to keep.
  ///
  /// A narrowing only. It never makes a request valid on its own — see
  /// [isValid].
  final DateTime? firstSeenAfter;

  /// Only channels nobody has touched: no tag, vetting still `newlyFound`,
  /// pipeline stage still `new`.
  ///
  /// The other way an unattended caller is kept safe, for when it has no
  /// discovery window to hide behind. The auto-clean's standing sweep runs
  /// over the whole roster — that is its job, since the channels that slip
  /// past the per-run gate are exactly the ones no run's window covers: a
  /// teammate's finds pulled in from the catalog, or a run that was killed
  /// before its own sweep. What it must never do is overrule a decision: a
  /// channel somebody tagged `qualified`, moved to `contacted` or so much as
  /// vetted has been looked at, and "too small by the rule" is no longer the
  /// last word on it. Those are skipped here the way a channel with a deal is
  /// skipped everywhere.
  ///
  /// A narrowing only, like [firstSeenAfter].
  final bool untouchedOnly;

  /// Why. The check constraint on `channel_archive.label` allows only the
  /// rejecting tags ([ChannelTag.rejecting]), and the RPC rejects anything else
  /// rather than writing a row the sweep would later choke on.
  final ChannelTag label;

  /// Skip the 7-day grace period and delete now.
  ///
  /// Off by default, and worth leaving off. The grace period is the only thing
  /// standing between a mistyped bound and an unrecoverable delete, and a
  /// mistyped bound here is thousands of channels rather than one.
  final bool immediate;

  /// At least one bound, on either range. Mirrors the check the RPC makes —
  /// which is the one that actually enforces it.
  ///
  /// [firstSeenAfter] is deliberately not enough. "Everything that run found",
  /// with no bound on size, is every new channel.
  bool get isValid =>
      minSubscribers != null ||
      maxSubscribers != null ||
      minMedianViews != null ||
      maxMedianViews != null ||
      minVideosLast30 != null;
}

/// What a [BulkRejectionRequest] did, or — on a dry run — would do.
///
/// The three `skipped` counts are the reason this is a record rather than a
/// bare integer. "4,812 matched" on its own does not tell anyone that 300 more
/// channels sat in the range and were left alone, and the difference between
/// the three reasons is the difference between "already handled", "a human
/// needs to look at this" and "we cannot answer the question you asked".
class BulkRejectionOutcome {
  const BulkRejectionOutcome({
    required this.matched,
    required this.tagged,
    required this.archived,
    required this.skippedAlreadyTagged,
    required this.skippedProtected,
    required this.skippedUnknownSize,
    this.pendingIds = const [],
  });

  /// The same outcome with the sweep's numbers filled in.
  ///
  /// Used by the repository once it has finished deleting the channels the RPC
  /// handed back: the count of what it actually archived is the client's to
  /// report, because the client is what did it.
  BulkRejectionOutcome copyWith({
    int? archived,
    List<String>? pendingIds,
  }) {
    return BulkRejectionOutcome(
      matched: matched,
      tagged: tagged,
      archived: archived ?? this.archived,
      skippedAlreadyTagged: skippedAlreadyTagged,
      skippedProtected: skippedProtected,
      skippedUnknownSize: skippedUnknownSize,
      pendingIds: pendingIds ?? this.pendingIds,
    );
  }

  /// In range and eligible: what the run touched, or would touch.
  final int matched;

  /// Actually tagged. Zero on a dry run.
  final int tagged;

  /// Actually deleted, counting only channels this request tagged. Zero unless
  /// [BulkRejectionRequest.immediate] was set.
  ///
  /// The sweep it triggers is table-wide by design — it also takes anything
  /// whose own fifteen days ran out — and crediting this operation with those
  /// deletions would overstate what the person just did.
  final int archived;

  /// In range, but already carrying a rejecting tag and so already counting
  /// down. Nothing to do.
  final int skippedAlreadyTagged;

  /// In range, but somebody has a deal or an outreach history with them. A
  /// rejected channel the agency has actually negotiated with is a
  /// contradiction for a human to settle, and archiving it would cascade the
  /// negotiation away with it — so the sweep refuses these, and this refuses
  /// them earlier so the number being confirmed is the number that will move.
  final int skippedProtected;

  /// Channels missing a number this request needs: no subscriber count when a
  /// subscriber bound was set, or no median views when a median-views bound
  /// was. They are in no range at all.
  ///
  /// Counted and reported rather than quietly excluded: "we do not know how
  /// many subscribers this channel has" is a different answer from "it is
  /// outside your range", and a tool that conflates the two is how a large
  /// channel whose count never parsed ends up deleted by an "under 1,000"
  /// sweep.
  final int skippedUnknownSize;

  /// Tagged, due now, and not yet deleted -- the ids the caller has to sweep
  /// itself, in batches.
  ///
  /// Empty on every path but one: an immediate clean asking the RPC to defer
  /// the sweep, which is what the app does and why. Deleting a channel is a
  /// row-by-row loop with a cascading delete in it, and a few thousand of them
  /// cannot finish inside a single PostgREST request's statement timeout -- so
  /// the tagging (one UPDATE) and the deleting (many small calls) are separated,
  /// and this is what carries the second half.
  ///
  /// Nothing is lost if the caller never comes back: these rows are tagged and
  /// already past their archive date, so the nightly sweep takes them.
  final List<String> pendingIds;

  static const empty = BulkRejectionOutcome(
    matched: 0,
    tagged: 0,
    archived: 0,
    skippedAlreadyTagged: 0,
    skippedProtected: 0,
    skippedUnknownSize: 0,
  );

  static BulkRejectionOutcome fromJson(Map<String, dynamic> json) {
    int field(String name) => (json[name] as num?)?.toInt() ?? 0;
    final pending = json['pending_ids'];
    return BulkRejectionOutcome(
      pendingIds: pending is List
          ? [
              for (final id in pending)
                if (id != null) id.toString(),
            ]
          : const [],
      matched: field('matched'),
      tagged: field('tagged'),
      archived: field('archived'),
      skippedAlreadyTagged: field('skipped_tagged'),
      skippedProtected: field('skipped_protected'),
      skippedUnknownSize: field('skipped_unknown'),
    );
  }
}

/// A bulk clean whose tagging landed and whose deletions did not finish.
///
/// Its own exception because the two halves have genuinely different outcomes
/// and "it failed" describes neither. The tags are committed: every matched
/// channel is rejected and due, so the nightly sweep will finish whatever this
/// did not, and re-running the clean would find nothing left to match. What
/// failed is only the deleting-now part, and how far it got is the thing
/// somebody needs to know before deciding whether to retry.
class BulkSweepFailure implements Exception {
  const BulkSweepFailure({
    required this.swept,
    required this.total,
    required this.cause,
    this.verb = 'tagged',
  });

  /// Channels actually deleted before the failure.
  final int swept;

  /// Channels that were tagged (or, for the "scheduled for archive" bulk
  /// action, already were and just had their due date moved to now()) — the
  /// size of the job either way.
  final int total;

  /// What happened to [total] before the sweep started. "tagged" for a fresh
  /// [BulkRejectionRequest]; "due" for [BulkArchiveDueRequest]'s archive-now
  /// action, where the channels were tagged already and this run only moved
  /// their date.
  final String verb;

  final Object cause;

  @override
  String toString() =>
      'BulkSweepFailure: $total channels $verb, deleted $swept of them before '
      'the server stopped answering. The remaining ${total - swept} are '
      'tagged and due; the nightly sweep will take them. Cause: $cause';
}
