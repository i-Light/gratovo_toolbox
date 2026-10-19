import 'package:flutter_riverpod/flutter_riverpod.dart';

/// One counter per kind of data, bumped by whoever changed it.
///
/// This exists because "refresh the other pages too" was, until now, a list of
/// `ref.invalidate(...)` calls written out at every mutation site. That list is
/// impossible to keep right: the writer of a tag editor has to know that the
/// influencer list, the dashboard tiles and the analytics charts all read
/// channels, and every new screen silently makes every existing list wrong.
/// Editing a tag on the profile page updated the profile and nothing else for
/// exactly that reason.
///
/// The direction is now inverted. A mutation says only *what kind of thing*
/// changed — `ref.bumpData({DataDomain.channels})` — and every provider that
/// reads that kind watches its counter and re-reads itself. A new screen wires
/// itself in by watching; no mutation site is ever touched again.
///
/// Nothing here holds data. The counters are a change signal, not a cache, so
/// there is no second copy of anything to drift from the database.
///
/// **Cost.** A bump only costs whatever is *currently being watched*. The whole
/// app lives in a `StatefulShellRoute.indexedStack`, so every visited tab stays
/// alive and its providers stay subscribed — which is both why nothing used to
/// refresh on its own and why an expensive read must not be hung directly off a
/// counter. Cheap reads (an indexed `COUNT`, a small list) watch their domain
/// directly; the one genuinely expensive read in the app — the dashboard's
/// aggregate over every channel — goes through [RefreshWhenVisible] instead, so
/// it recomputes when its tab is actually on screen rather than while somebody
/// is typing on another one.
enum DataDomain {
  /// The channel table: tags, stages, notes, contacts, newly found rows.
  channels,

  /// Per-channel video rows, and the 30-day rollups derived from them.
  videos,

  /// Durable edit locks on an entity (`edit_claims`), so one releasing is
  /// visible to whoever was waiting on it. Was `keywords` — "who is searching
  /// what right now" — until the pipeline's keyword-claim system was removed
  /// and left it with nothing to announce.
  editClaims,

  /// Search run progress.
  searchRuns,

  deals,
  brands,
  reminders,

  /// Campaigns and their shortlist entries — the brand profile's Campaigns
  /// section and the campaign detail screen both watch this.
  campaigns,

  /// Threads and messages.
  outreach,

  templates,
  writingRules,

  /// Archived channels, and the bulk cleans that add to them.
  archive,

  /// Refused edits waiting to be settled.
  conflicts,

  news,

  /// The action log.
  activity,

  /// The team scratchpad — one shared text box per person. On the realtime
  /// publication, so a save by anyone bumps this and every open Scratchpad
  /// page re-reads.
  scratchpad,

  /// The merge board (`client_merge_status`) — which teammates still have a
  /// local database a shipped reset moved aside. On the realtime publication,
  /// so one person resolving a merge updates everyone's Settings board.
  mergeStatus,

  /// Incoming/outgoing remote-search-request rows — bumped so the Search
  /// screen's upload dialog and the intake controller re-read after a pull
  /// brings in a new or updated one.
  remoteSearchRequests,

  /// The agency's own facts (`agency_settings`, one shared row): Settings,
  /// the engine's true claims, the boycott list and the daily target.
  agency,

  /// The Comms queue (`comms_proposals`): messages the engine proposed and
  /// what a person did with each.
  comms,
}

/// The counters themselves.
///
/// A plain `Map` replaced wholesale on each bump rather than a mutable one:
/// Riverpod compares states with `==`, and mutating in place would hand back an
/// object it considers unchanged.
class DataRevisionsNotifier extends Notifier<Map<DataDomain, int>> {
  @override
  Map<DataDomain, int> build() => const {};

  /// Records that [domains] now hold different data than they did.
  ///
  /// Call this *after* the write has landed, never before — a provider that
  /// re-reads on the strength of a write that then fails would show a value the
  /// database does not hold, which is the failure the whole mutation-guard layer
  /// exists to prevent.
  void bump(Iterable<DataDomain> domains) {
    if (domains.isEmpty) return;
    final next = Map<DataDomain, int>.of(state);
    for (final domain in domains) {
      next[domain] = (next[domain] ?? 0) + 1;
    }
    state = next;
  }
}

final dataRevisionsProvider =
    NotifierProvider<DataRevisionsNotifier, Map<DataDomain, int>>(
  DataRevisionsNotifier.new,
);

/// One domain's counter — what a provider watches to re-read itself.
///
/// Per-domain rather than the whole map, so a channel edit does not re-run the
/// deals list. `Provider` compares its result with `==`, so watching this
/// rebuilds only when *this* domain moves, even though the map behind it
/// changed for every bump.
final dataRevisionProvider = Provider.family<int, DataDomain>((ref, domain) {
  return ref.watch(dataRevisionsProvider)[domain] ?? 0;
});

/// `ref.bumpData({DataDomain.channels})` from a widget.
extension DataChangeWidgetRef on WidgetRef {
  void bumpData(Iterable<DataDomain> domains) =>
      read(dataRevisionsProvider.notifier).bump(domains);
}

/// The same, from inside a provider or controller.
extension DataChangeRef on Ref {
  void bumpData(Iterable<DataDomain> domains) =>
      read(dataRevisionsProvider.notifier).bump(domains);
}
