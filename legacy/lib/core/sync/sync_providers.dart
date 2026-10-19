import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_influencer_repository.dart';

/// The result of trying to open the local database at launch.
///
/// Deliberately shaped like [SupabaseBoot], and for the same reasons: opening
/// a database has to happen before the widget tree exists, it can fail, and
/// the failure must land somewhere a person can read rather than on a red
/// screen.
///
/// Unlike the old mirror, there is no networked fallback: the local database
/// IS the app's data. Without it the app runs on the in-memory mocks so that
/// it at least opens and Settings can say what went wrong.
class SyncBoot {
  const SyncBoot({this.engine, this.error});

  /// Null when the platform has no local database (web) or the file could not
  /// be opened.
  final SyncEngine? engine;

  final Object? error;

  bool get isReady => engine != null;
}

/// Defaults to "no engine" rather than throwing when it is not overridden,
/// unlike [supabaseBootProvider]: every widget test runs on mocks, and making
/// the unset case throw would put an override nobody reads at the top of each.
final syncBootProvider = Provider<SyncBoot>((ref) {
  return const SyncBoot();
});

final syncEngineProvider = Provider<SyncEngine?>((ref) {
  return ref.watch(syncBootProvider).engine;
});

/// Live sync state, for the card in Settings.
///
/// Seeded with the engine's current status so the first frame is right rather
/// than "unknown until something changes" — on a machine that has been running
/// for an hour, the next status event may be minutes away.
final syncStatusProvider = StreamProvider<SyncSnapshot>((ref) {
  final engine = ref.watch(syncEngineProvider);
  if (engine == null) return const Stream<SyncSnapshot>.empty();
  return engine.statusStream;
});

final syncSnapshotProvider = Provider<SyncSnapshot?>((ref) {
  final engine = ref.watch(syncEngineProvider);
  if (engine == null) return null;
  return ref.watch(syncStatusProvider).value ?? engine.status;
});

/// Keeps replication running exactly while somebody is signed in.
///
/// Watched by [localMirrorProvider], which every sync-backed repository reads,
/// so it stays alive for as long as anything is using the mirror — a provider
/// nothing watches is a provider that never builds, and this one's entire job
/// is its side effect.
///
/// Signing out disconnects and forgets the session's cursors
/// ([SyncEngine.forgetSession], which the Sign out button calls); the data
/// itself stays, because it is this machine's working copy and may hold
/// unsent edits.
final syncConnectionProvider = Provider<void>((ref) {
  final engine = ref.watch(syncEngineProvider);
  if (engine == null) return;

  final signedIn = ref.watch(isSignedInProvider);
  // Both are guarded, and neither is awaited. This is a provider body: a future
  // that completes with an error here has nowhere to go but the zone's
  // unhandled-error handler, and a synchronous throw would fail the *build* of
  // a provider the app shell watches — which is a red screen over the whole
  // app because a cache could not start replicating. The engine reports its own
  // failures through the status card; that is where they belong.
  unawaited(
      Future<void>.sync(() => signedIn ? engine.connect() : engine.disconnect())
          .catchError((Object _) {}));
});

/// The local database — the only thing the app reads and writes.
///
/// Available the moment the engine opened, signed in or not, synced or not:
/// an empty table on a fresh machine means "nothing here yet", and the sync
/// card is where "not synced yet" is reported. Signing in is what starts the
/// engine replicating; it is not what makes the data readable.
///
/// Null only when there is no engine (web, or the file could not be opened),
/// in which case every repository runs on its in-memory mock.
final localMirrorProvider = Provider<LocalSyncDb?>((ref) {
  final engine = ref.watch(syncEngineProvider);
  if (engine == null) return null;

  // Establishing the connection is a side effect of reading the database,
  // which keeps the two from being switched on separately.
  ref.watch(syncConnectionProvider);

  return engine.db;
});

/// Turns a finished download into a change announcement.
///
/// The missing half of local-first. Reads were already instant once the mirror
/// filled, but a pull that brought down a teammate's work wrote it to a file on
/// disk and told nobody: every screen that had already read its data went on
/// showing what it read at launch, and the only way to see the new rows was to
/// restart the app. Now a pull that wrote anything announces the domains the
/// mirror holds, and every list, count and chart re-reads itself.
///
/// Watched from the app shell so it lives as long as the session does — a
/// provider nothing watches never builds, and this one is nothing but its
/// side effect.
final mirrorChangeAnnouncerProvider = Provider<void>((ref) {
  // Seeded from the engine rather than from the listener's `previous`, which
  // is null on the first event of the session — and the first event is exactly
  // the one a pull that landed during launch arrives in. Comparing against a
  // revision this provider remembers itself cannot miss one.
  var lastRevision = ref.read(syncEngineProvider)?.status.dataRevision;

  ref.listen(syncStatusProvider, (_, next) {
    final after = next.value?.dataRevision;
    if (after == null || after == lastRevision) return;
    lastRevision = after;
    ref.bumpData(const {
      DataDomain.channels,
      DataDomain.videos,
      DataDomain.archive,
      DataDomain.conflicts,
      DataDomain.deals,
      DataDomain.brands,
      DataDomain.outreach,
      DataDomain.reminders,
      DataDomain.templates,
      DataDomain.activity,
      DataDomain.scratchpad,
      DataDomain.remoteSearchRequests,
    });
  });
});

/// The shortest gap between two catch-up syncs.
///
/// A search run pushes to Supabase after every keyword and every push arrives
/// here as a realtime notification, so without a floor a broad run would have
/// this machine downloading the delta every couple of seconds for an hour. Long
/// enough that a run costs a handful of passes rather than hundreds, short
/// enough that "the channels I am finding right now" show up while the run is
/// still going, which is the entire point of asking at all.
const _catchUpInterval = Duration(seconds: 20);

/// Asks the mirror to catch up when something says the server has moved.
///
/// The missing third of local-first. Reads were instant and a pull announced
/// itself, but nothing ever *asked* for a pull outside the three-hourly tick —
/// so on a machine running from the mirror, a search run's finds sat on the
/// server for up to three hours while the Influencers page, reading a local
/// file that did not have them, showed nothing new during the run or after it.
///
/// Deliberately a request rather than a command: [request] coalesces, so the
/// two callers (a realtime push saying the `channels` table changed, and the
/// search screen watching its own run) can both ask as often as they like
/// without either having to know about the other.
class MirrorCatchUp {
  MirrorCatchUp(this._ref);

  final Ref _ref;

  /// Runs for [_catchUpInterval] after each pass is started, and remembers
  /// whether anything asked during it.
  ///
  /// A timer rather than a timestamp so the whole thing is driven by one clock
  /// the test can wind forward, and so there is no "now" to get wrong.
  Timer? _cooldown;
  bool _asked = false;

  void dispose() {
    _cooldown?.cancel();
    _cooldown = null;
  }

  /// Whether an ask during the window mentioned the scraped tables, so the
  /// trailing pass forces the pipeline's pull past its freshness window.
  bool _scraped = false;

  /// Syncs now, or at the end of the current window if one just ran.
  ///
  /// [scraped] says the bucket changed (a teammate's search shared results),
  /// so the pass must run the pipeline's pull even if one ran a minute ago.
  void request({bool scraped = false}) {
    if (_ref.read(syncEngineProvider) == null) return;

    _scraped = _scraped || scraped;
    if (_cooldown != null) {
      // Trailing rather than dropped: the last ask in a busy stretch is the one
      // that knows about the most rows, and dropping it would leave the mirror
      // a keyword behind until the next three-hourly tick.
      _asked = true;
      return;
    }
    _run();
  }

  void _run() {
    final engine = _ref.read(syncEngineProvider);
    if (engine == null) return;

    _asked = false;
    final scraped = _scraped;
    _scraped = false;
    _cooldown = Timer(_catchUpInterval, () {
      _cooldown = null;
      if (_asked) _run();
    });
    // catchUp, not syncNow: this fires automatically, potentially once per
    // keyword a search finishes, and must defer to a search holding the
    // connection busy the way an explicit "sync now" button press should not.
    // See SyncEngine.catchUp's own doc comment for what calling syncNow here
    // used to do to a run.
    //
    // Errors are the engine's to report — it puts them in the status card and
    // retries on the next pass. Nothing here has anywhere better to put one.
    unawaited(engine.catchUp(scraped: scraped).catchError((Object _) {}));
  }
}

final mirrorCatchUpProvider = Provider<MirrorCatchUp>((ref) {
  final catchUp = MirrorCatchUp(ref);
  ref.onDispose(catchUp.dispose);
  return catchUp;
});

/// Who this machine files conflicts as.
///
/// Falls back to "someone" rather than to an empty string, because the name
/// goes straight into a sentence on the conflicts page — the same word
/// `apply_channel_edit` falls back to server-side, so a conflict filed locally
/// and one filed by the database read identically.
final syncActorProvider = Provider<SyncActor>((ref) {
  final session = ref.watch(currentSessionProvider);
  final profile = ref.watch(currentProfileProvider).value;
  return SyncActor(
    id: session?.user.id,
    name: profile?.displayName ?? 'someone',
  );
});
