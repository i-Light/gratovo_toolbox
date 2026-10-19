import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/media_kit.dart';

/// What `channel_state.creator_gender` records, for house choice HC-08:
/// the agency avoids female creators entirely, couple channels included.
enum CreatorGender {
  male,
  female,
  couple,
  unknown;

  /// Out of scope under HC-08: never contacted, never pitched.
  bool get outOfScope =>
      this == CreatorGender.female || this == CreatorGender.couple;

  static CreatorGender? fromWire(String? value) => switch (value) {
        'male' => CreatorGender.male,
        'female' => CreatorGender.female,
        'couple' => CreatorGender.couple,
        'unknown' => CreatorGender.unknown,
        _ => null,
      };
}

/// Platforms a discovered channel can live on.
///
/// Only [youtube] is wired up today (the current Python pipeline is
/// YouTube-only per the owner's explicit scope call), but the field exists
/// on [Influencer] from day one so adding a second platform later is a new
/// enum value plus a new scraper, not a schema migration.
enum InfluencerPlatform {
  youtube;

  String get label => switch (this) {
        InfluencerPlatform.youtube => 'YouTube',
      };
}

/// Where a discovered channel stands in the *sourcing* funnel only.
///
/// Deliberately shallow. Everything past "should we even reach out to this
/// channel" — negotiation stage, won/lost, repeat engagements — lives on
/// [Deal], not here. An influencer can have
/// many deals over time, so a single "current stage" field on Influencer
/// would either get silently overwritten on every new engagement or need
/// its own history log duplicating what Deal already is. [Deal.stage]
/// across every [Deal] with this influencer's id *is* that history.
enum VettingStatus {
  newlyFound,
  shortlisted,
  rejected;
}

/// How far this channel has been carried through *outreach*, as one value on
/// the channel itself.
///
/// This looks like it overlaps [DealStage], and the distinction is worth being
/// precise about, because getting it wrong is what produces two sources of
/// truth. [DealStage] is the state of ONE negotiation with one brand, and a
/// channel can have several of those at once and many over time.
/// [PipelineStage] is the state of the CHANNEL: how far the agency has got
/// with this person at all. A channel can sit at `roster` while three separate
/// deals sit at three different stages, and it stays `roster` after all three
/// close.
///
/// Mirrors the `pipeline_stage` check constraint in `backend/schema.sql`
/// exactly, name for name — the column stores [wire], so renaming a value here
/// without migrating the column is what would silently start rejecting writes.
enum PipelineStage {
  isNew,
  contacted,
  interested,
  roster,
  negotiating,
  contract,
  awaitingDelivery,
  paid,
  lost;

  /// The wire value. Only [isNew] differs from [name], because `new` is a
  /// reserved word in Dart and cannot be an enum constant.
  String get wire => this == PipelineStage.isNew ? 'new' : name;

  static PipelineStage fromWire(String? value) {
    if (value == null || value == 'new') return PipelineStage.isNew;
    for (final stage in PipelineStage.values) {
      if (stage.name == value) return stage;
    }
    return PipelineStage.isNew;
  }
}

/// What a channel is ABOUT, as a fixed vocabulary rather than free text.
///
/// Deliberately hardcoded rather than a database-backed, admin-editable
/// table: adding a tag is a code change, which is what "admin only" means
/// here in practice, and it means every card, dialog, and filter resolves a
/// tag's label from [wire] at render time instead of storing the label as
/// data — renaming [ChannelTagPresentation.label] in one place is then the
/// entire rename, everywhere the tag appears.
enum ChannelTag {
  undecided,
  qualified,
  haramStuff,
  irrelevant,
  inactive;

  /// The wire value, identical to [name] for every value today — kept as its
  /// own getter (rather than using `.name` at call sites) so the vocabulary
  /// reads the same way as [PipelineStage.wire], and a future value that DOES
  /// need to differ from its Dart identifier is a one-line change here.
  String get wire => name;

  /// Null for anything unrecognized — including every pre-migration
  /// free-text tag ("tech", "fitness", ...) and the retired `approved` tag
  /// (migrated to [qualified] server-side) — so callers can drop legacy
  /// values instead of crashing on them.
  static ChannelTag? fromWire(String? value) {
    if (value == null) return null;
    for (final tag in ChannelTag.values) {
      if (tag.wire == value) return tag;
    }
    return null;
  }

  /// The tags that put a channel on the auto-archive path, in the order that
  /// decides which single label the archive keeps when a channel carries more
  /// than one of them — first in this list wins.
  ///
  /// This is the one place the "rejecting" vocabulary is written. Every card,
  /// dialog, filter, and the image-cache sweep reads it from here rather than
  /// repeating `[haramStuff, irrelevant, ...]`, and it mirrors
  /// `channel_is_rejected()` in `backend/schema.sql` — the two are edited
  /// together.
  static const List<ChannelTag> rejecting = [
    ChannelTag.haramStuff,
    ChannelTag.irrelevant,
    ChannelTag.inactive,
  ];

  /// Whether carrying this tag (with nothing non-rejecting alongside it) sends
  /// a channel toward archiving. See [rejecting] and [Influencer.isRejectedBy].
  bool get isRejecting => rejecting.contains(this);

  /// The single label a fully-rejected channel is archived under: the
  /// strongest rejecting tag it carries, per [rejecting]'s order. Null when the
  /// list holds no rejecting tag.
  static ChannelTag? archiveLabelFor(Iterable<ChannelTag> tags) {
    for (final tag in rejecting) {
      if (tags.contains(tag)) return tag;
    }
    return null;
  }
}

/// A discovered channel, before or after any deal has ever been made with
/// it. One row per channel, never duplicated across search runs (the
/// Python pipeline's `store.py` already dedupes by channel id — this model
/// assumes that's still true upstream).
class Influencer {
  const Influencer({
    required this.id,
    required this.handle,
    required this.channelUrl,
    required this.platform,
    required this.subscriberCount,
    required this.sourceKeywords,
    required this.vettingStatus,
    required this.discoveredAt,
    this.name,
    this.description,
    this.profilePicture,
    this.banner,
    this.country,
    this.lastVideoAt,
    this.medianViewsLast30,
    this.medianViewsAll,
    this.notes,
    this.relevanceCriteria = const [],
    this.pipelineStage = PipelineStage.isNew,
    this.contactAttempts = 0,
    this.channelTags = const [],
    this.lastDealAt,
    this.daysSinceLastDeal,
    this.videosLast30 = 0,
    this.providedData,
    this.lastFetchedAt,
    this.contacts = const [],
    this.archiveDueAt,
    this.ownerId,
    this.manualEngagementRate,
    this.manualEngagementNote,
    this.manualEngagementUpdatedAt,
    this.sponsoredRatio,
    this.seenBrands = const [],
    this.foundEmails = const [],
    this.mediaKit,
    this.creatorGender,
  });

  final String id;
  final String handle;
  final String channelUrl;
  final InfluencerPlatform platform;
  final int subscriberCount;

  /// ISO-3166 country code where known (the old pipeline resolves this from
  /// the channel's "About" page); null when YouTube doesn't expose it.
  final String? country;

  final DateTime? lastVideoAt;

  /// The trailing-30-day **median** per-video view count (`percentile_cont(0.5)`
  /// over uploads in the 30 days before we last fetched this channel's videos).
  /// A far better sourcing signal than raw subscriber count for a channel that
  /// has gone dormant or bought subscribers, and — unlike a mean — one viral
  /// upload does not drag it. Null when we have never measured the channel in
  /// that window.
  final int? medianViewsLast30;

  /// The median per-video view count over **every** stored video for this
  /// channel (no window). Only populated on the influencer details page, which
  /// computes it client-side from the videos it already loads; null everywhere
  /// else.
  final int? medianViewsAll;

  /// Every keyword this channel was ever found under. A channel can surface
  /// under more than one keyword across different search runs.
  final List<String> sourceKeywords;

  final VettingStatus vettingStatus;

  final DateTime discoveredAt;

  /// Free-text notes about this channel, carried across every deal round
  /// with them (contract quirks, past friction, "always replies late",
  /// etc.) — kept on the influencer rather than a specific deal since it's
  /// about the person/channel, not one negotiation.
  final String? notes;

  /// What the owner is looking for when reviewing this channel's recent
  /// videos for outreach personalization (e.g. "sponsorship mentions",
  /// "upload frequency") — explicitly user-configurable per the owner's
  /// requirement that video-relevance criteria not be hardcoded. Feeds the
  /// future AI email-draft prompt (Phase 3) alongside the template library.
  final List<String> relevanceCriteria;

  /// The channel's own display name, which is often nothing like its handle
  /// ("@mkbhd" vs "Marques Brownlee"). Nullable because a channel that has
  /// been discovered but not yet fetched has a handle and nothing else.
  final String? name;

  final String? description;
  final String? profilePicture;
  final String? banner;

  /// See [PipelineStage] for why this is not the same thing as a deal stage.
  final PipelineStage pipelineStage;

  /// How many times anyone has reached out to this channel. Shown as the
  /// status tag when there is no deal yet — "3 attempts" says considerably
  /// more about what to do next than "contacted" does.
  final int contactAttempts;

  /// What the channel is ABOUT, as distinct from where it stands in the
  /// funnel — see [ChannelTag].
  final List<ChannelTag> channelTags;

  final DateTime? lastDealAt;

  /// Whole days since the last deal closed; null when there has never been
  /// one. Computed by the `influencer_rows` view rather than here, so every
  /// client agrees on it and a device with a wrong clock cannot disagree with
  /// the rest of the team about how stale a relationship is.
  final int? daysSinceLastDeal;

  /// Uploads in the last 30 days, also from the view. Zero and "nobody has
  /// fetched this channel's videos" are genuinely indistinguishable here —
  /// [lastFetchedAt] is what separates them.
  final int videosLast30;

  /// Stats the influencer sent us themselves (audience geography split,
  /// channel analytics they screenshot over, and so on). Free-form because no
  /// two creators send the same shape, and pinning a schema on it would mean
  /// dropping whatever did not fit.
  final Map<String, dynamic>? providedData;

  /// When the pipeline last successfully refreshed this channel — the honest
  /// answer to "how old is this number?", which matters before quoting a
  /// subscriber count to a brand.
  final DateTime? lastFetchedAt;

  /// Every way this channel can be reached — see [InfluencerContact] for why
  /// this is a list and not an `email` column.
  final List<InfluencerContact> contacts;

  /// When this channel will be reduced to an archive record and deleted, or
  /// null when it is not on that path.
  ///
  /// Set by a database trigger 7 days out whenever the channel's tags become
  /// exclusively rejecting (every one in [ChannelTag.rejecting]), and cleared
  /// the moment they stop being — see `backend/schema.sql`.
  /// Never written by the app except to bring it forward ("archive now").
  ///
  /// The app surfaces this rather than leaving it silent. The 7 days exist as
  /// a grace period for a mis-tag, and a grace period nobody can see is not one
  /// — a channel would simply vanish, along with every video, note and contact
  /// on it, with nothing having warned anybody.
  final DateTime? archiveDueAt;

  /// Who on the team owns this channel relationship. Nullable: most
  /// channels start unassigned.
  final String? ownerId;

  /// A person's own read on this channel's engagement, typed in by hand —
  /// deliberately never fetched from an API. [manualEngagementRate] is
  /// whatever percentage they looked up and want on record (e.g. from the
  /// channel's own analytics screenshot); [manualEngagementNote] is
  /// free-text context for it ("per their media kit, June 2026").
  final double? manualEngagementRate;
  final String? manualEngagementNote;
  final DateTime? manualEngagementUpdatedAt;

  /// Share of the stored videos (the latest 15) that carry a sponsorship
  /// disclosure; null with none stored. Derived by the pipeline.
  final double? sponsoredRatio;

  /// Brands named in those disclosures — confident extractions only.
  final List<String> seenBrands;

  /// Addresses the creator publishes in the About text and the video
  /// descriptions, spelled-out forms included (fix #11). Derived by the
  /// pipeline; adding one to [contacts] is a person's click.
  final List<String> foundEmails;

  /// The creator's media kit, typed in (fix #4); null until somebody does.
  final MediaKit? mediaKit;

  /// HC-08's flag; null until somebody records it.
  final CreatorGender? creatorGender;

  /// Whole days until [archiveDueAt], floored at zero; null when not pending.
  ///
  /// Zero means "in the next sweep", not "never" — the nightly job may not have
  /// run yet. The UI says "today" for that rather than "in 0 days".
  int? get daysUntilArchive {
    final due = archiveDueAt;
    if (due == null) return null;
    final remaining = due.difference(DateTime.now().toUtc()).inDays;
    return remaining < 0 ? 0 : remaining;
  }

  bool get isPendingArchive => archiveDueAt != null;

  /// Whether this machine knows the channel exists but has not yet received
  /// its scraped details and videos.
  ///
  /// A channel found by a teammate arrives in two steps: its thin row from
  /// the shared catalog first, its full object (description, videos) on the
  /// next pull once it is in the bucket. In between, [lastFetchedAt] is null
  /// — no scrape has landed here — and the profile shows "details syncing"
  /// rather than an empty video list that reads as "this channel has none".
  bool get detailsPending => lastFetchedAt == null;

  /// The one to try first: whichever contact is marked primary, or failing
  /// that the first one recorded. Null when nobody has found a contact yet,
  /// which is a state worth showing plainly rather than papering over.
  InfluencerContact? get primaryContact {
    if (contacts.isEmpty) return null;
    for (final contact in contacts) {
      if (contact.isPrimary) return contact;
    }
    return contacts.first;
  }

  /// The single status tag this channel shows.
  ///
  /// Once a deal exists, days-since-last-deal supersedes every other status
  /// tag: for a channel already worked with, "112 days since the last deal" is
  /// the fact that decides what to do next, and leaving `roster` showing
  /// beside it competes for the same space with less information. This
  /// deliberately does NOT supersede [channelTags], which describe what the
  /// channel is about rather than where it stands.
  InfluencerStatusTag get statusTag {
    if (daysSinceLastDeal != null) {
      return InfluencerStatusTag.daysSinceDeal(daysSinceLastDeal!);
    }
    if (contactAttempts > 0) {
      return InfluencerStatusTag.attempts(contactAttempts);
    }
    return InfluencerStatusTag.stage(pipelineStage);
  }

  /// Whether this set of tags is what puts a channel on the archive path.
  ///
  /// Mirrors `public.channel_is_rejected` in `backend/schema.sql` exactly,
  /// and the two are meant to be edited together. The database is the authority
  /// — it is what actually sets the date — but the rule is needed here too, so
  /// the mock repository behaves like production and so the list can show a
  /// countdown the instant somebody tags a row rather than after a round trip.
  ///
  /// Both halves matter. At least one rejecting tag, and NOTHING else: a
  /// channel tagged both `irrelevant` and `qualified` is one people disagree
  /// about, and a permanent delete is not how a disagreement gets settled.
  static bool isRejectedBy(List<ChannelTag> tags) {
    if (tags.isEmpty) return false;
    return tags.every((tag) => tag.isRejecting);
  }

  /// Drops duplicates, preserving the order the rest were recorded in.
  static List<ChannelTag> normalizeChannelTags(List<ChannelTag> tags) {
    final seen = <ChannelTag>{};
    final result = <ChannelTag>[];
    for (final tag in tags) {
      if (seen.add(tag)) result.add(tag);
    }
    return result;
  }

  /// Best single line of identity: the real name when known, the handle
  /// otherwise.
  String get displayName =>
      (name != null && name!.trim().isNotEmpty) ? name!.trim() : handle;

  Influencer copyWith({
    VettingStatus? vettingStatus,
    String? notes,
    List<String>? relevanceCriteria,
    PipelineStage? pipelineStage,
    int? contactAttempts,
    List<ChannelTag>? channelTags,
    Map<String, dynamic>? providedData,
    List<InfluencerContact>? contacts,
    DateTime? archiveDueAt,
    MediaKit? mediaKit,
    CreatorGender? creatorGender,

    /// Tagging a channel back out of rejection clears the countdown, and a
    /// nullable named parameter cannot express "set this to null" on its own —
    /// passing null is indistinguishable from not passing it. Without this
    /// flag, un-rejecting a row would leave the list still counting down to an
    /// archive that is no longer coming.
    bool clearArchiveDueAt = false,
  }) {
    return Influencer(
      id: id,
      handle: handle,
      channelUrl: channelUrl,
      platform: platform,
      subscriberCount: subscriberCount,
      name: name,
      description: description,
      profilePicture: profilePicture,
      banner: banner,
      country: country,
      lastVideoAt: lastVideoAt,
      medianViewsLast30: medianViewsLast30,
      medianViewsAll: medianViewsAll,
      sourceKeywords: sourceKeywords,
      vettingStatus: vettingStatus ?? this.vettingStatus,
      discoveredAt: discoveredAt,
      notes: notes ?? this.notes,
      relevanceCriteria: relevanceCriteria ?? this.relevanceCriteria,
      pipelineStage: pipelineStage ?? this.pipelineStage,
      contactAttempts: contactAttempts ?? this.contactAttempts,
      channelTags: channelTags ?? this.channelTags,
      lastDealAt: lastDealAt,
      daysSinceLastDeal: daysSinceLastDeal,
      videosLast30: videosLast30,
      providedData: providedData ?? this.providedData,
      lastFetchedAt: lastFetchedAt,
      contacts: contacts ?? this.contacts,
      archiveDueAt:
          clearArchiveDueAt ? null : (archiveDueAt ?? this.archiveDueAt),
      ownerId: ownerId,
      manualEngagementRate: manualEngagementRate,
      manualEngagementNote: manualEngagementNote,
      manualEngagementUpdatedAt: manualEngagementUpdatedAt,
      sponsoredRatio: sponsoredRatio,
      seenBrands: seenBrands,
      foundEmails: foundEmails,
      mediaKit: mediaKit ?? this.mediaKit,
      creatorGender: creatorGender ?? this.creatorGender,
    );
  }
}

/// The one status tag a row shows, and which of the three kinds it is.
///
/// A tagged value rather than three nullable fields on the widget, so
/// [Influencer.statusTag]'s precedence rule is decided once, in the model, and
/// every surface that shows a status tag agrees with every other.
class InfluencerStatusTag {
  const InfluencerStatusTag._(this.kind, {this.stage, this.count});

  factory InfluencerStatusTag.stage(PipelineStage stage) =>
      InfluencerStatusTag._(InfluencerStatusTagKind.stage, stage: stage);

  factory InfluencerStatusTag.attempts(int count) =>
      InfluencerStatusTag._(InfluencerStatusTagKind.attempts, count: count);

  factory InfluencerStatusTag.daysSinceDeal(int days) =>
      InfluencerStatusTag._(InfluencerStatusTagKind.daysSinceDeal, count: days);

  final InfluencerStatusTagKind kind;
  final PipelineStage? stage;
  final int? count;
}

enum InfluencerStatusTagKind { stage, attempts, daysSinceDeal }
