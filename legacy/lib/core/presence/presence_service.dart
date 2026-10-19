import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/presence/editing_target.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// What a machine mid-search says about itself, once per keyword.
///
/// The "fake live progress" for a search that runs on somebody else's
/// machine: nothing is replicated row by row any more, so the only way to
/// see a teammate's run move is for them to say so. One presence update per
/// keyword finished is cheap — presence is event-driven — and it is enough
/// for the Dashboard to show who is searching what and how far along.
class SearchingStatus {
  const SearchingStatus({
    required this.keyword,
    required this.channelsFound,
    required this.startedAt,
    this.backoffRemainingSeconds,
    this.backoffReason,
  });

  /// The keyword being worked right now.
  final String keyword;

  /// Channels the run has found so far, across its keywords.
  final int channelsFound;

  final DateTime startedAt;

  /// Seconds left in a YouTube-imposed wait (rate limit / IP refusal /
  /// captcha), or null when the run isn't currently backing off. Lets other
  /// machines tell "still searching normally" apart from "stuck waiting out
  /// a block" instead of just seeing a keyword frozen in place.
  final int? backoffRemainingSeconds;

  /// Why the wait started — the raw reason text from the pipeline (e.g. "HTTP
  /// 429 from ...", "redirected to YouTube's captcha page"). Null whenever
  /// [backoffRemainingSeconds] is null.
  final String? backoffReason;

  Map<String, dynamic> toJson() => {
        'keyword': keyword,
        'channels_found': channelsFound,
        'started_at': startedAt.toUtc().toIso8601String(),
        if (backoffRemainingSeconds != null)
          'backoff_remaining_seconds': backoffRemainingSeconds,
        if (backoffReason != null) 'backoff_reason': backoffReason,
      };

  static SearchingStatus? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final keyword = raw['keyword'];
    final found = raw['channels_found'];
    final started = raw['started_at'];
    final backoffRemaining = raw['backoff_remaining_seconds'];
    final backoffReason = raw['backoff_reason'];
    if (keyword is! String) return null;
    return SearchingStatus(
      keyword: keyword,
      channelsFound: found is num ? found.toInt() : 0,
      startedAt: started is String
          ? DateTime.tryParse(started)?.toUtc() ?? DateTime.now().toUtc()
          : DateTime.now().toUtc(),
      backoffRemainingSeconds:
          backoffRemaining is num ? backoffRemaining.toInt() : null,
      backoffReason: backoffReason is String ? backoffReason : null,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is SearchingStatus &&
      other.keyword == keyword &&
      other.channelsFound == channelsFound &&
      other.startedAt == startedAt &&
      other.backoffRemainingSeconds == backoffRemainingSeconds &&
      other.backoffReason == backoffReason;

  @override
  int get hashCode => Object.hash(
        keyword,
        channelsFound,
        startedAt,
        backoffRemainingSeconds,
        backoffReason,
      );
}

/// A teammate whose machine is running a search.
class SearchingPeer {
  const SearchingPeer({
    required this.userId,
    required this.displayName,
    required this.colorHex,
    required this.status,
  });

  final String userId;
  final String displayName;
  final String colorHex;
  final SearchingStatus status;
}

/// Someone with the app open right now, whether or not they're editing or
/// searching anything — every connected client tracks `user_id`/
/// `display_name`/`color` unconditionally (`_publish`), so this is the list
/// [EditingPeer]/[SearchingPeer] can't answer on their own: a teammate who's
/// signed in but idle appears here and nowhere else. What the upload
/// dialog's online/offline roster is built from.
class OnlinePeer {
  const OnlinePeer({
    required this.userId,
    required this.displayName,
    required this.colorHex,
  });

  final String userId;
  final String displayName;
  final String colorHex;
}

/// Everyone currently online, and what each of them has open.
class PresenceState {
  const PresenceState({
    this.peers = const [],
    this.searching = const [],
    this.online = const [],
    this.isConnected = false,
  });

  /// Other people only — never yourself. Borders exist to warn you off work
  /// someone else is doing; a border around your own open field would be
  /// noise on every screen you use.
  final List<EditingPeer> peers;

  /// Other people's searches in progress. Same rule: never yourself — your
  /// own run has its own progress panel.
  final List<SearchingPeer> searching;

  /// Everyone with the app open, other people only, regardless of activity.
  final List<OnlinePeer> online;

  final bool isConnected;

  /// Everyone editing this entity, regardless of which field they are in.
  List<EditingPeer> forEntity(String type, String id) =>
      peers.where((p) => p.target.type == type && p.target.id == id).toList();

  /// Everyone editing this exact field.
  List<EditingPeer> forField(String type, String id, String field) => peers
      .where((p) =>
          p.target.type == type && p.target.id == id && p.target.field == field)
      .toList();

  PresenceState copyWith({
    List<EditingPeer>? peers,
    List<SearchingPeer>? searching,
    List<OnlinePeer>? online,
    bool? isConnected,
  }) =>
      PresenceState(
        peers: peers ?? this.peers,
        searching: searching ?? this.searching,
        online: online ?? this.online,
        isConnected: isConnected ?? this.isConnected,
      );
}

/// Reduces a presence channel's raw state (`channel.presenceState()`) into
/// typed peer lists, one entry per `user_id` — last one seen wins.
///
/// Two connections can legitimately exist for the same person at once: a
/// reconnect whose old socket hasn't timed out server-side yet, or a genuine
/// second device signed in as the same account. `presences` lists metas in
/// join order, so the last one seen here is the most recently (re)connected
/// — the one worth trusting over a stale, frozen one. Without this
/// reduction, a reconnect used to show up on the Dashboard as a duplicated
/// "searching now" row stuck on whatever keyword the dead connection last
/// announced.
///
/// The traversal is deliberately untyped. The realtime client's presence
/// state classes have been renamed across versions, and this feature is
/// cosmetic — a compile break here would take down the whole app over
/// borders. Every field is validated before use and anything malformed is
/// skipped, so a payload shape we do not recognise costs one missing border,
/// not a crash.
///
/// Takes the raw state directly (not a [RealtimeChannel]) so it is
/// unit-testable without a live channel — see `presence_service_test.dart`.
@visibleForTesting
({
  List<EditingPeer> peers,
  List<SearchingPeer> searching,
  List<OnlinePeer> online
}) buildPresenceLists(Iterable<dynamic> states) {
  final peersByUser = <String, EditingPeer>{};
  final searchingByUser = <String, SearchingPeer>{};
  final onlineByUser = <String, OnlinePeer>{};
  for (final dynamic entry in states) {
    final dynamic presences = entry.presences;
    if (presences is! Iterable) continue;
    for (final dynamic presence in presences) {
      final dynamic raw = presence.payload;
      if (raw is! Map) continue;

      final userId = raw['user_id'];
      if (userId is! String) continue;
      final displayName = raw['display_name'] is String
          ? raw['display_name'] as String
          : 'Someone';
      final colorHex =
          raw['color'] is String ? raw['color'] as String : '#3B82F6';

      onlineByUser[userId] = OnlinePeer(
        userId: userId,
        displayName: displayName,
        colorHex: colorHex,
      );

      final target = EditingTarget.fromJson(raw['editing']);
      if (target != null) {
        peersByUser[userId] = EditingPeer(
          userId: userId,
          displayName: displayName,
          colorHex: colorHex,
          target: target,
        );
      }
      final status = SearchingStatus.fromJson(raw['searching']);
      if (status != null) {
        searchingByUser[userId] = SearchingPeer(
          userId: userId,
          displayName: displayName,
          colorHex: colorHex,
          status: status,
        );
      }
    }
  }
  return (
    peers: peersByUser.values.toList(),
    searching: searchingByUser.values.toList(),
    online: onlineByUser.values.toList(),
  );
}

/// Owns the one realtime channel that carries "who is editing what".
///
/// TIER 1 of the three-tier model in backend/SETUP.md. This is Supabase
/// Realtime *Presence*, not database rows: each client broadcasts a small
/// blob over a websocket and everyone else receives it in well under a
/// second. Nothing is written to the database, so it costs no storage and no
/// row quota, and — the part that matters most — a person's presence
/// disappears automatically the moment they close the app or lose their
/// connection. There are no stale locks to expire, and no way for a crashed
/// client to leave a channel frozen.
///
/// The durable `edit_claims` table is the deliberate exception, for claims
/// that must survive a disconnect (a keyword mid-search, a channel locked
/// during contract negotiation). See `claim_entity()` in `backend/schema.sql` section 9.
class PresenceController extends Notifier<PresenceState> {
  RealtimeChannel? _channel;
  SupabaseClient? _client;
  EditingTarget? _target;
  SearchingStatus? _searching;
  Timer? _retryTimer;

  /// The shortest gap between two presence broadcasts.
  ///
  /// Realtime rate-limits presence messages per client, and this app announces
  /// a new target on every focus change — tabbing down a channel profile, or
  /// scrolling a list whose rows mount and unmount editing scopes, spends a
  /// dozen messages in a couple of seconds. The server's answer to that is
  /// `ClientPresenceRateLimitReached: :client_rate_limit_exceeded`, which drops
  /// the channel and takes every border on screen with it — and the reconnect
  /// spends more presence messages, which is how one burst turns into a channel
  /// that stays broken.
  ///
  /// Coalescing to the last target in each window costs a border up to a second
  /// late. Nobody can act on a border faster than that, and the alternative is
  /// not having one at all.
  static const _publishInterval = Duration(seconds: 1);

  /// When the last [track] actually went out, and the timer holding a target
  /// that arrived too soon after it.
  DateTime? _publishedAt;
  Timer? _publishTimer;

  /// How many times the current connection has dropped and retried in a row,
  /// reset the moment a subscribe succeeds. Drives the backoff below.
  int _retryAttempt = 0;

  /// Identity of the connection we currently want: client + who is signed in.
  /// A [build] that leaves this unchanged does nothing — see the note there.
  String? _wantToken;

  /// How many times [build] has run -- once per life of this notifier. A
  /// test pins that, because a rebuild is exactly what used to cause the rate
  /// limit (see [build]).
  @visibleForTesting
  int buildCount = 0;

  @override
  PresenceState build() {
    buildCount++;
    // Identity is LISTENED to here, never watched. A watched dependency
    // rebuilds this notifier, and a rebuild runs every `ref.onDispose` first
    // -- which tore the channel down. `currentSessionProvider` changes on
    // every auth event (the hourly token refresh included) and
    // `currentProfileProvider` then reloads (loading, then data): two or
    // three rebuilds in one burst, each a full leave + join + track. That
    // burst is what the server answered with "Client presence rate limit
    // exceeded", and the retry after it spent more of the same. Listening
    // keeps this build -- and the channel -- alive across all of that; only
    // a real change of who is signed in (or of the client) reconnects.
    ref.onDispose(_teardown);
    ref.listen(supabaseClientProvider, (_, __) => _syncIdentity());
    ref.listen(currentSessionProvider, (_, __) => _syncIdentity());
    ref.listen(currentProfileProvider, (_, __) => _syncIdentity());
    _syncIdentity();
    return const PresenceState();
  }

  /// Connects, reconnects or disconnects if -- and only if -- the identity
  /// this should broadcast as changed: client + who is signed in.
  void _syncIdentity() {
    final client = ref.read(supabaseClientProvider);
    final session = ref.read(currentSessionProvider);
    // Plain `.value`, not `.maybeWhen(data:)` / `.asData?.value`:
    // currentProfileProvider re-runs its fetch on every auth event, silent
    // token refreshes included, and for the duration of that reload the
    // AsyncValue reports `loading` even though the session is still valid and
    // the profile has not actually changed. `.value` keeps returning the last
    // loaded profile through a reload (AsyncValue retains it while loading), so
    // the token is unchanged and the dedup guard below correctly does nothing.
    // It only goes null on a real sign-out, when the provider resolves to null.
    final profile = ref.read(currentProfileProvider).value;
    final token = (client != null && session != null && profile != null)
        ? '${identityHashCode(client)}:${session.user.id}:${profile.id}'
        : null;

    // A session object is replaced on every token refresh; the user id in it
    // is not, so the token -- and this guard -- ignore refreshes.
    if (token == _wantToken) return;
    _wantToken = token;
    // Deferred: subscribing synchronously inside build() would mutate
    // provider state during its own construction.
    scheduleMicrotask(() {
      if (_wantToken != token) return;
      if (token == null) {
        _disconnect();
      } else {
        _connect(client!, profile!);
      }
    });
  }

  /// Signed out: stop broadcasting and forget whoever was on screen.
  void _disconnect() {
    _retryTimer?.cancel();
    _retryTimer = null;
    _publishTimer?.cancel();
    _publishTimer = null;
    _retryAttempt = 0;
    _disposeChannel();
    state = const PresenceState();
  }

  void _teardown() {
    _retryTimer?.cancel();
    _retryTimer = null;
    _publishTimer?.cancel();
    _publishTimer = null;
    _retryAttempt = 0;
    _wantToken = null;
    _disposeChannel();
  }

  void _disposeChannel() {
    final channel = _channel;
    final client = _client;
    _channel = null;
    if (channel == null) return;
    // No untrack() first, deliberately. Leaving a channel already withdraws
    // this client's presence from it, so untracking was a second presence
    // message spent to say what the unsubscribe below says anyway — and it was
    // spent on exactly the path that runs when the server has just refused us
    // for sending too many of them.
    //
    // Tearing down a channel that is already gone is not a problem worth
    // reporting — the goal is simply that it is no longer subscribed.
    //
    // removeChannel() unsubscribes AND drops the channel from the client's
    // registry. Plain unsubscribe() leaves it registered, so a run of
    // reconnects — every hot reload, every retry — piles up dead
    // 'gratovo:workspace' channels that still count against presence limits.
    final removal = client?.removeChannel(channel) ?? channel.unsubscribe();
    unawaited(removal.then<void>((_) {}, onError: (Object _) {}));
  }

  Future<void> _connect(SupabaseClient client, TeamMember profile) async {
    _client = client;
    _disposeChannel();

    // `self: false` keeps our own payload out of the sync callback, which is
    // exactly the "never border your own work" rule — enforced at the
    // transport rather than filtered later, so it cannot be forgotten.
    //
    // `key: profile.id` gives every connection from the same person the same
    // presence key, so a reconnect (a dropped socket, a hot reload) replaces
    // that person's entry instead of sitting alongside it as a second,
    // increasingly stale one — which is what used to show up on the
    // Dashboard as a duplicated "searching now" row frozen on an old
    // keyword. `_readPresence` below still collapses to one entry per
    // `user_id` on top of this, for the window between a reconnect and the
    // old socket's server-side timeout, where both can briefly coexist under
    // the same key.
    final channel = client.channel(
      'gratovo:workspace',
      opts: RealtimeChannelConfig(self: false, key: profile.id),
    );
    _channel = channel;

    channel
      ..onPresenceSync((_) => _readPresence(channel))
      ..onPresenceJoin((_) => _readPresence(channel))
      ..onPresenceLeave((_) => _readPresence(channel))
      ..subscribe((status, error) async {
        // A channel this controller has already let go of (replaced by a
        // reconnect, or removed on error below) still reports its own close.
        // That is not news about the connection that exists now.
        if (_channel != channel) return;
        if (status == RealtimeSubscribeStatus.subscribed) {
          _retryAttempt = 0;
          state = state.copyWith(isConnected: true);
          await _publish(profile);
        } else if (status == RealtimeSubscribeStatus.channelError ||
            status == RealtimeSubscribeStatus.closed) {
          state = state.copyWith(isConnected: false, peers: const []);
          if (error != null) {
            developer.log(
              'Presence channel dropped; retrying with backoff.',
              name: 'gratovo.presence',
              level: 900,
              error: error,
            );
          }
          // Presence failing must never break the app — it is an awareness
          // feature. Retry quietly, with exponential backoff from 15s, capped
          // at ~8 min.
          //
          // The floor matters as much as the growth. A presence rate limit is
          // measured over a window, so the first retry has to outlast the
          // window that refused us; the 5s this started from reconnected
          // inside it, earned the same refusal, and kept the limiter pinned —
          // which is how one burst of `track` calls turned into a channel that
          // never came back.
          //
          // And the floor only holds if this is the one retrying. Left alone,
          // realtime_client rejoins an errored channel by itself after 1, 2,
          // 4, 8 and then every 10 seconds -- all inside the window that
          // just refused us, so the limiter never got the quiet it needed.
          // Removing the channel now stops that timer; the fresh channel
          // below is the only way back.
          _disposeChannel();
          _retryAttempt = (_retryAttempt + 1).clamp(1, 6);
          final delay = Duration(seconds: 15 * (1 << (_retryAttempt - 1)));
          final token = _wantToken;
          _retryTimer?.cancel();
          _retryTimer = Timer(delay, () {
            // Still the same person, and nothing reconnected meanwhile.
            if (_wantToken == token && _channel == null) {
              _connect(client, profile);
            }
          });
        }
      });
  }

  /// Broadcasts the current target, or holds it until the window is open.
  ///
  /// Trailing rather than leading-only: the target somebody lands on is the one
  /// worth announcing, and the ones they passed through on the way are not.
  void _schedulePublish() {
    final profile = _profile();
    if (profile == null || _channel == null) return;

    final since =
        _publishedAt == null ? null : DateTime.now().difference(_publishedAt!);
    if (since == null || since >= _publishInterval) {
      _publishTimer?.cancel();
      _publishTimer = null;
      unawaited(_publish(profile));
      return;
    }

    _publishTimer ??= Timer(_publishInterval - since, () {
      _publishTimer = null;
      final latest = _profile();
      if (latest != null) unawaited(_publish(latest));
    });
  }

  TeamMember? _profile() => ref
      .read(currentProfileProvider)
      .maybeWhen(data: (p) => p, orElse: () => null);

  Future<void> _publish(TeamMember profile) async {
    final channel = _channel;
    if (channel == null) return;
    _publishedAt = DateTime.now();
    try {
      await channel.track({
        'user_id': profile.id,
        'display_name': profile.displayName,
        'color': TeamMember.colorToHex(profile.color),
        'editing': _target?.toJson(),
        'searching': _searching?.toJson(),
      });
    } catch (error) {
      developer.log('Could not publish presence.',
          name: 'gratovo.presence', level: 900, error: error);
    }
  }

  /// Reads the channel's current presence map into typed peers.
  void _readPresence(RealtimeChannel channel) {
    try {
      final result =
          buildPresenceLists(channel.presenceState() as Iterable<dynamic>);
      state = state.copyWith(
        peers: result.peers,
        searching: result.searching,
        online: result.online,
      );
    } catch (error) {
      developer.log('Could not read presence state.',
          name: 'gratovo.presence', level: 900, error: error);
    }
  }

  /// Announce what this person is now editing. Pass null when they stop.
  Future<void> setEditing(EditingTarget? target) async {
    if (_target == target) return;
    _target = target;
    _schedulePublish();
  }

  /// Announce that this machine is running a search, and how far it has
  /// got. Pass null when the run ends. Called once per keyword, not per
  /// channel — see [SearchingStatus].
  Future<void> setSearching(SearchingStatus? status) async {
    if (_searching == status) return;
    _searching = status;
    _schedulePublish();
  }

  /// Stop announcing [target], but only if it is still the current one —
  /// guards the case where a widget's dispose runs after a newer widget has
  /// already claimed something else, which would otherwise clear the wrong
  /// target.
  Future<void> clearEditing(EditingTarget target) async {
    if (_target != target) return;
    await setEditing(null);
  }
}

final presenceControllerProvider =
    NotifierProvider<PresenceController, PresenceState>(
  PresenceController.new,
);

/// Everyone editing a given entity right now. Watch this rather than the
/// whole [PresenceState] so a widget rebuilds only when the people on ITS
/// entity change, not whenever anyone anywhere moves.
///
/// `autoDispose` because the argument is an entity id: the Influencers list
/// alone asks for one of these per row, and without disposal every channel
/// ever scrolled past leaves a live family instance behind, each subscribed to
/// [presenceControllerProvider] for the rest of the session. A long vetting
/// session then turns every presence update into O(rows-ever-seen) work. With
/// disposal the set tracks what is actually on screen, and a row scrolling
/// back into view rebuilds it for the cost of one `where`.
final peersOnEntityProvider = Provider.autoDispose
    .family<List<EditingPeer>, ({String type, String id})>((ref, key) {
  return ref.watch(presenceControllerProvider).forEntity(key.type, key.id);
});

final peersOnFieldProvider = Provider.autoDispose
    .family<List<EditingPeer>, ({String type, String id, String field})>(
        (ref, key) {
  return ref
      .watch(presenceControllerProvider)
      .forField(key.type, key.id, key.field);
});

/// Every teammate whose machine is mid-search, for the Dashboard's
/// "who is searching" strip.
final searchingPeersProvider = Provider<List<SearchingPeer>>((ref) {
  return ref.watch(presenceControllerProvider.select((s) => s.searching));
});

/// Everyone with the app open right now, other people only — the Search
/// screen's upload dialog uses this to mark the team roster online/offline.
final onlinePeersProvider = Provider<List<OnlinePeer>>((ref) {
  return ref.watch(presenceControllerProvider.select((s) => s.online));
});
