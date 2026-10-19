import 'package:gratovo_toolbox/data/models/influencer.dart';

/// The "Scheduled for archive" side of the bulk clean tool.
///
/// [BulkRejectionRequest] (see `bulk_rejection.dart`) tags NEW channels and
/// starts their 7-day countdown. This acts on channels ALREADY tagged
/// rejected and already counting down — the ones sitting in the grace period
/// right now, `channels.archive_due_at is not null`. It cannot start a
/// countdown and it cannot tag a channel that isn't already tagged; all it can
/// do to a channel already in that state is finish the countdown early
/// ([ArchiveDueAction.archiveNow]) or cancel it ([ArchiveDueAction.undo]).
enum ArchiveDueAction {
  /// Moves the due date to now() and sweeps -- the countdown finishes today
  /// instead of whenever the remaining days run out. Still goes through
  /// `archive_due_channels`, so a channel with a live deal or outreach history
  /// is still refused, the same as the nightly sweep would refuse it.
  archiveNow,

  /// Clears every tag, the same as unchecking each one on a row by hand.
  /// `set_archive_due_at` then nulls `archive_due_at` itself, as a trigger
  /// side effect of the channel no longer reading as rejected — this is what
  /// "keep this channel after all" means for one row, done to many at once.
  undo;

  String get wire => switch (this) {
        ArchiveDueAction.archiveNow => 'archive_now',
        ArchiveDueAction.undo => 'undo',
      };
}

/// A request to act on every currently-due channel in a size range.
///
/// The three bounds narrow together exactly as they do on
/// [BulkRejectionRequest], but none is required here: the base population is
/// already bounded to channels somebody already decided to reject, not the
/// whole table, so "every channel currently due" is itself a safe request
/// rather than the "reject everything" mistake [BulkRejectionRequest.isValid]
/// exists to catch.
class BulkArchiveDueRequest {
  const BulkArchiveDueRequest({
    required this.action,
    this.minSubscribers,
    this.maxSubscribers,
    this.minMedianViews,
    this.maxMedianViews,
    this.minVideosLast30,
    this.label,
  });

  final ArchiveDueAction action;

  final int? minSubscribers;
  final int? maxSubscribers;
  final int? minMedianViews;
  final int? maxMedianViews;
  final int? minVideosLast30;

  /// Narrows the due population to channels carrying this rejecting tag.
  /// Null reaches every due channel regardless of which rejecting tag(s) it
  /// carries — the tool's original, and still default, behaviour.
  ///
  /// Why this exists: the due population can mix several rejecting reasons
  /// (`haramStuff`, `irrelevant`, `inactive` — see [ChannelTag.rejecting]),
  /// and "archive now" / "undo" used to be all-or-nothing across whichever mix
  /// happened to be due. A countdown started for one reason is not always one
  /// a person wants to act on in the same sweep as a countdown started for
  /// another.
  final ChannelTag? label;
}

/// What a [BulkArchiveDueRequest] did, or — on a dry run — would do.
class BulkArchiveDueOutcome {
  const BulkArchiveDueOutcome({
    required this.matched,
    required this.updated,
    required this.archived,
    required this.skippedProtected,
    required this.skippedUnknown,
    this.pendingIds = const [],
  });

  /// The same outcome with the sweep's numbers filled in — see
  /// [BulkRejectionOutcome.copyWith] for why this is the client's to report
  /// rather than the RPC's.
  BulkArchiveDueOutcome copyWith({
    int? archived,
    List<String>? pendingIds,
  }) {
    return BulkArchiveDueOutcome(
      matched: matched,
      updated: updated,
      archived: archived ?? this.archived,
      skippedProtected: skippedProtected,
      skippedUnknown: skippedUnknown,
      pendingIds: pendingIds ?? this.pendingIds,
    );
  }

  /// In range and eligible: what this run touched, or would touch.
  final int matched;

  /// Tags cleared ([ArchiveDueAction.undo]) or due dates moved to now()
  /// ([ArchiveDueAction.archiveNow]). Zero on a dry run.
  final int updated;

  /// Actually deleted. Zero for [ArchiveDueAction.undo], and zero for
  /// [ArchiveDueAction.archiveNow] until the deferred sweep finishes.
  final int archived;

  /// In range, but somebody has a deal or an outreach history with them --
  /// the same guard [BulkRejectionOutcome.skippedProtected] reports, applied
  /// here before either action touches a row.
  final int skippedProtected;

  /// In range of a bound that needs a number this channel does not have.
  final int skippedUnknown;

  /// Due, updated, and (for [ArchiveDueAction.archiveNow]) not yet deleted --
  /// the ids the caller sweeps itself, in batches. See
  /// [BulkRejectionOutcome.pendingIds] for why this split exists.
  final List<String> pendingIds;

  static const empty = BulkArchiveDueOutcome(
    matched: 0,
    updated: 0,
    archived: 0,
    skippedProtected: 0,
    skippedUnknown: 0,
  );

  static BulkArchiveDueOutcome fromJson(Map<String, dynamic> json) {
    int field(String name) => (json[name] as num?)?.toInt() ?? 0;
    final pending = json['pending_ids'];
    return BulkArchiveDueOutcome(
      pendingIds: pending is List
          ? [
              for (final id in pending)
                if (id != null) id.toString(),
            ]
          : const [],
      matched: field('matched'),
      updated: field('updated'),
      archived: field('archived'),
      skippedProtected: field('skipped_protected'),
      skippedUnknown: field('skipped_unknown'),
    );
  }
}
