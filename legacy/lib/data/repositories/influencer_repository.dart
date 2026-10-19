import 'package:gratovo_toolbox/data/models/edit_conflict.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/data/models/keyword_view_sample.dart';
import 'package:gratovo_toolbox/data/models/media_kit.dart';
import 'package:gratovo_toolbox/data/models/sponsor_sighting.dart';
import 'package:gratovo_toolbox/data/models/video.dart';

/// How the UI reads and mutates discovered channels.
///
/// Two implementations exist: an in-memory mock repo (what every screen
/// talks to until Phase 5) and a Supabase-backed one. Feature code
/// (screens, providers) only ever depends on this interface — see
/// repository_providers.dart, the single file Phase 5 touches to swap the
/// mock out.
abstract class InfluencerRepository {
  /// Every channel, unfiltered.
  ///
  /// Nothing on a screen calls this any more, and nothing new should. It reads
  /// the entire table: measured against 100,000 channels it returns 100,000
  /// rows and 35 MB, to answer questions that wanted a number or a page. The
  /// dashboard's tile now asks [countByVettingStatus], the outreach picker
  /// asks [getPage], and the tagged-image sweep pages through the tags it
  /// actually cares about.
  ///
  /// It survives because the mock repo's seeded demo data is genuinely "all of
  /// it" — eight rows — and because a caller that truly needs every channel is
  /// better served by an honest method than by paging in a loop it wrote
  /// itself.
  Future<List<Influencer>> getAll();

  /// How many channels sit at [status], counted by the database.
  ///
  /// Exists because the Dashboard's "new finds" tile used to be
  /// `getAll().where(...).length` — 35 MB over the wire, decoded into 100,000
  /// [Influencer] objects, to render one integer. This is a `HEAD` request
  /// with `count=exact` on Supabase and a `COUNT(*)` on the mirror; neither
  /// returns a row.
  Future<int> countByVettingStatus(VettingStatus status);

  /// Every (keyword, median views) pair across the roster, for channels with
  /// a measured median — what the Dashboard's keyword evaluation folds.
  ///
  /// Exists because that card used to be [getAll]: the whole roster decoded
  /// into [Influencer] objects, plus a second read for their keywords, to use
  /// two numbers from each — and it re-ran on every channel edit, sync pull
  /// and archive while the Dashboard was open. This is one query returning
  /// two columns and a flag, joined in the database.
  Future<List<KeywordViewSample>> keywordViewSamples();

  /// Every distinct cached-image URL among the stored videos of [channelIds],
  /// in one query per few hundred ids.
  ///
  /// For the tagged-image sweep, which used to ask [getRecentVideos] once per
  /// channel — the N+1 every other bulk read here was written to avoid — to
  /// collect nothing but thumbnail URLs.
  Future<List<String>> getVideoThumbnails(List<String> channelIds);

  /// How many channels are currently counting down to being archived — rows
  /// with `archive_due_at` set, counted by the database.
  ///
  /// A channel lands here the moment it is tagged haramStuff/irrelevant/
  /// inactive (see the `trg_channels_archive_due` trigger in
  /// `backend/schema.sql`) and leaves it either when the tag is removed or
  /// once the nightly `archive_due_channels` sweep actually archives it after
  /// the 7-day grace period. Feeds the Dashboard's "New finds" tile badge,
  /// following the same HEAD-request-with-`count=exact` /
  /// `COUNT(*)`-on-the-mirror shape as [countByVettingStatus].
  Future<int> countArchiveDue();

  /// One page of channels matching [query], sorted and filtered by the
  /// database rather than in memory. [offset] is a row offset, not a page
  /// number, so the caller decides its own page size.
  Future<InfluencerPage> getPage({
    required int offset,
    required int limit,
    InfluencerQuery query = const InfluencerQuery(),
  });

  Future<Influencer?> getById(String id);

  /// Recent uploads for personalization, as last fetched. In Phase 2 this
  /// just returns the seeded mock list; Phase 6 is what makes the Profile
  /// page's "Refresh" action actually re-fetch from YouTube.
  Future<List<Video>> getRecentVideos(String influencerId);

  /// The single most recent upload for each of [channelIds], in ONE query.
  ///
  /// Exists for the Influencers list's optional "show recent videos on the
  /// cards" mode. Asking [getRecentVideos] per card would be one request per
  /// visible channel — fifty requests to draw one screen, which is the exact
  /// N+1 the `influencer_rows` view was built to remove from this list in the
  /// first place.
  ///
  /// Channels with no stored videos are simply absent from the result rather
  /// than mapped to null, so a caller iterating the map never has to think
  /// about the difference.
  Future<Map<String, Video>> getLatestVideoPerChannel(List<String> channelIds);

  /// Every country code that at least one channel actually has, so the filter
  /// dropdown offers the twelve countries in the data instead of all 249.
  Future<List<String>> getCountries();

  /// Adds a channel by hand — the one someone found off a recommendation or a
  /// competitor's sponsor list that no keyword search has surfaced. Returns
  /// the id of the created row.
  Future<String> create(NewInfluencer draft);

  /// Every mutation below is a COMPARE-AND-SET, not a blind write.
  ///
  /// `base` is the value the editor was looking at when they started. The write
  /// only lands if the column still holds it; otherwise somebody changed it in
  /// between, this edit was composed without knowledge of theirs, and the
  /// result is [EditOutcome.conflict] with the column left untouched.
  ///
  /// This does NOT flag two people working on the same channel over time. If
  /// you can see a colleague's saved text, it is your base, and building on it
  /// applies silently however often that happens — see
  /// `backend/schema.sql` for the full definition and the tests that pin
  /// it.
  ///
  /// Every call site already computes this value: it is the same `before:` the
  /// activity log is given.
  Future<EditOutcome> updateVettingStatus(
    String id,
    VettingStatus status, {
    required VettingStatus base,
  });

  Future<EditOutcome> updateRelevanceCriteria(
    String id,
    List<String> criteria, {
    required List<String> base,
  });

  Future<EditOutcome> updateNotes(
    String id,
    String notes, {
    required String? base,
  });

  Future<EditOutcome> updatePipelineStage(
    String id,
    PipelineStage stage, {
    required PipelineStage base,
  });

  Future<EditOutcome> updateChannelTags(
    String id,
    List<ChannelTag> tags, {
    required List<ChannelTag> base,
  });

  /// Records one more outreach attempt against this channel.
  ///
  /// Deprecated: "contact attempts" is now a derived count of outbound
  /// outreach messages for this channel's thread (see the
  /// `outreach_outbound_count` column added to `influencer_rows` in
  /// `backend/schema.sql`). Nothing in the app calls this any
  /// more; kept on the interface so the Supabase RPC stays reachable for any
  /// older client build.
  @Deprecated(
    'Contact attempts are derived from the count of outbound outreach '
    'messages; see backend/schema.sql',
  )
  Future<void> incrementContactAttempts(String id);

  /// Stats the influencer sent us themselves. Pass null to clear.
  Future<EditOutcome> updateProvidedData(
    String id,
    Map<String, dynamic>? data, {
    required Map<String, dynamic>? base,
  });

  /// Archives this channel right now, instead of waiting out the remaining
  /// grace period.
  ///
  /// Two steps, and both are needed. The archive date moves to now, and then
  /// `archive_due_channels` is asked to sweep this one channel — reducing it
  /// to its tombstone and cascading away its videos, notes and contacts.
  ///
  /// It used to be only the first step, which meant the button called "Archive
  /// now" moved a deadline and nothing else: the channel stayed exactly where
  /// it was until the nightly cron ran at 03:17 UTC, up to a day later. That is
  /// not what anybody pressing it is asking for, and the confirmation dialog in
  /// front of it already spells out that the deletion is permanent and
  /// cascading — so the grace period is being waived deliberately, by a person,
  /// on one named channel.
  ///
  /// On the mirror path the sweep is queued rather than immediate, because a
  /// machine that is offline cannot run it. It goes out on the next sync pass —
  /// seconds, not a night — and until then the channel is tagged and overdue,
  /// which is precisely the state the nightly job exists to finish.
  ///
  /// Only meaningful on a channel already tagged rejected: the database trigger
  /// clears the date on any channel whose tags do not warrant one, so calling
  /// this on an untagged channel writes a date that is immediately erased. That
  /// is deliberate — it means this cannot become a second, tag-free route to a
  /// permanent delete.
  ///
  /// There is no matching "cancel". Cancelling is removing the rejecting tag,
  /// which [updateChannelTags] already does, and which is the honest way to say
  /// it: a channel that is still tagged `irrelevant` has not been reprieved,
  /// it has only been postponed.
  Future<void> archiveNow(String id);

  /// Replaces the whole contact list rather than adding or removing one.
  ///
  /// Whole-list is the right granularity here: the list is short, it is edited
  /// as a unit in one card, and per-contact writes would need stable ids on
  /// rows that today are just JSON. The cost is that two people adding a
  /// different contact at once is a conflict on the whole list rather than two
  /// independent additions — a decision for a human, not a lost write.
  /// Implementations are expected to run [InfluencerContact.normalize] so the
  /// stored value keeps its invariants regardless of the caller.
  Future<EditOutcome> updateContacts(
    String id,
    List<InfluencerContact> contacts, {
    required List<InfluencerContact> base,
  });

  /// Every channel the pipeline saw sponsors on, with their names — what
  /// "Brands seen sponsoring" is built from (fix #6).
  Future<List<SponsorSighting>> sponsorSightings();

  /// The creator's media kit (fix #4), as one value. Pass null to clear.
  /// Compare-and-set through `apply_channel_edit`, like [updateProvidedData].
  Future<EditOutcome> updateMediaKit(
    String id,
    MediaKit? kit, {
    required MediaKit? base,
  });

  /// House choice HC-08's flag. Pass null to clear. Compare-and-set.
  Future<EditOutcome> updateCreatorGender(
    String id,
    CreatorGender? gender, {
    required CreatorGender? base,
  });

  /// Assigns or unassigns who on the team owns this channel. A plain write,
  /// not compare-and-set — an owner assignment is a whole-value pick from a
  /// short roster list, not a field two people are likely to be mid-edit on
  /// at once.
  Future<void> updateOwner(String id, String? ownerId);

  /// Replaces the manual engagement entry as one unit — rate, note and the
  /// moment someone typed it in. A plain last-write-wins write, like
  /// [updateOwner]: these two new columns predate the compare-and-set
  /// conflict machinery `apply_channel_edit` covers in `backend/schema.sql`,
  /// and re-entering a number from a media kit is not a field worth
  /// building conflict detection for.
  Future<void> updateManualEngagement(
    String id, {
    required double? rate,
    required String? note,
  });
}
