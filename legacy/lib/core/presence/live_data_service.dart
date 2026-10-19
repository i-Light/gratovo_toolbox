import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/sync/sync_providers.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// The one live channel, `gratovo:live`, and what rides on it.
///
/// Two things, and deliberately no more:
///
///   * `postgres_changes` on **`scratchpads`** — the only table left in the
///     publication (see `backend/schema.sql` §19). The team edits the same
///     shared text boxes and a save has to show up within a second or two.
///   * a client **Broadcast**, event `data`, sent by whichever machine just
///     finished uploading something or sharing a search's results. Payload:
///     `{"tables": [...]}`. One message per human action — a bulk clean of
///     three thousand channels is one message, not three thousand row events
///     — which is what keeps the Realtime quota out of the picture.
///
/// Everything else used to be replicated (`channels`, `runs`, `edit_claims`,
/// `client_merge_status`) and each of those cost one message per row change
/// per connected client. A search run alone burned a third of a month's
/// budget in two afternoons. Nothing bulk-written is replicated any more:
/// the scraped tables travel through the R2 catalog, the typed-in tables
/// through the sync engine's pulls, and this channel only says "go and pull".
///
/// The reaction to either is to ask the engine to catch up and to ANNOUNCE
/// on the change bus (`core/events/data_change_bus.dart`), never to patch a
/// local copy from a payload: the pull is what brings the rows, and the
/// announcement it makes when it lands is the one with data behind it.
class LiveDataController extends Notifier<int> {
  /// How long the pushes have to stop before a batch is announced.
  static const _quietPeriod = Duration(milliseconds: 400);

  /// The longest a change may sit unannounced, however busy the stream is —
  /// see [_schedule].
  static const _maxWait = Duration(seconds: 2);

  RealtimeChannel? _channel;
  Timer? _debounce;
  Timer? _deadline;
  Timer? _retryTimer;
  StreamSubscription<Set<String>>? _uploads;

  /// How many times this subscription has dropped and been retried in a row,
  /// reset by the next successful subscribe. Drives the backoff in [_connect].
  int _retryAttempt = 0;

  /// The client this controller is currently subscribed with, kept so a retry
  /// can reconnect without asking the provider again — a retry is not a rebuild
  /// and must not behave like one.
  SupabaseClient? _client;

  /// What has changed since the last flush — see [_schedule].
  final Set<DataDomain> _pending = {};

  /// Whether a pending flush should ask the pipeline for the catalog too.
  bool _pendingScraped = false;

  @override
  int build() {
    final client = ref.watch(supabaseClientProvider);
    final session = ref.watch(currentSessionProvider);
    final engine = ref.watch(syncEngineProvider);

    ref.onDispose(_teardown);

    if (client != null && session != null) {
      scheduleMicrotask(() => _connect(client));
      // Our own uploads, told to everyone else. The engine reports which
      // tables a drained queue touched; that becomes one Broadcast per
      // drain, and a drain is one human action's worth of writes.
      if (engine != null) {
        _uploads = engine.uploadedTables.listen(announce);
      }
    }
    return 0;
  }

  /// Tells the other machines that [tables] changed on the server (or, for
  /// the scraped tables, in the bucket), so they pull now rather than on
  /// their next tick. One message; nothing if the channel is not up.
  ///
  /// Public because the search run controller calls it too: a finished
  /// keyword's results reach the bucket through Python, which has no
  /// Supabase client, so the app announces on the pipeline's behalf.
  void announce(Set<String> tables) {
    final channel = _channel;
    if (channel == null || tables.isEmpty) return;
    unawaited(channel.sendBroadcastMessage(
      event: 'data',
      payload: {'tables': tables.toList()},
    ).then<void>((_) {}, onError: (Object error) {
      developer.log('Could not announce a data change.',
          name: 'gratovo.live', level: 900, error: error);
    }));
  }

  void _teardown() {
    _debounce?.cancel();
    _debounce = null;
    _deadline?.cancel();
    _deadline = null;
    _retryTimer?.cancel();
    _retryTimer = null;
    _uploads?.cancel();
    _uploads = null;
    _pending.clear();
    _pendingScraped = false;
    final channel = _channel;
    final client = _client;
    _channel = null;
    _client = null;
    if (channel != null) {
      // removeChannel, not a plain unsubscribe: it unsubscribes AND drops the
      // channel from the client's registry. Leaving it registered means a run
      // of reconnects — every retry below, every hot reload — piles up dead
      // 'gratovo:live' channels on one client, all of them still counted
      // against the realtime quota. The same reasoning, and the same fix, as
      // PresenceController's own teardown.
      final removal = client?.removeChannel(channel) ?? channel.unsubscribe();
      unawaited(removal.then<void>((_) {}, onError: (Object _) {}));
    }
  }

  Future<void> _connect(SupabaseClient client) async {
    final uploads = _uploads;
    _uploads = null;
    _teardown();
    _uploads = uploads;
    _client = client;
    final channel = client.channel(
      'gratovo:live',
      // Our own broadcasts are not echoed back: the drain that sent one has
      // already announced locally, and the pull it would trigger has just
      // happened.
      opts: const RealtimeChannelConfig(self: false),
    );
    _channel = channel;

    channel.onPostgresChanges(
      event: PostgresChangeEvent.all,
      schema: 'public',
      table: 'scratchpads',
      callback: (_) => _schedule(const {DataDomain.scratchpad}, scraped: false),
    );

    channel.onBroadcast(
      event: 'data',
      callback: (payload) {
        final raw = payload['tables'];
        final tables = <String>{
          if (raw is List)
            for (final table in raw) '$table',
        };
        final domains = domainsForTables(tables);
        if (domains.isEmpty) return;
        _schedule(domains, scraped: tables.any(kScrapedTables.contains));
      },
    );

    channel.subscribe((status, error) {
      if (status == RealtimeSubscribeStatus.subscribed) {
        _retryAttempt = 0;
        return;
      }
      if (status != RealtimeSubscribeStatus.channelError &&
          status != RealtimeSubscribeStatus.closed) {
        return;
      }
      // Our own teardown reports `closed` on the way out — a sign-out, a
      // rebuild, a reconnect that has already replaced this subscription.
      // Nothing has dropped in that case and there is nothing to retry; the
      // channel this callback belongs to is simply no longer the current one.
      if (_channel != channel) return;

      if (error != null) {
        developer.log('Live data channel dropped; retrying with backoff.',
            name: 'gratovo.live', level: 900, error: error);
      }

      // Retried: losing this channel does not look like a failure from the
      // outside — every screen keeps rendering the rows it read when it
      // opened, and the person finds out when they act on data that stopped
      // being true an hour ago. The ladder is PresenceController's,
      // deliberately: the two channels ride the same socket and fail
      // together, and a 15-second floor doubling to ~8 minutes is what stops
      // a rate limit or a rejected token from being hammered at by both.
      _retryAttempt = (_retryAttempt + 1).clamp(1, 6);
      final delay = Duration(seconds: 15 * (1 << (_retryAttempt - 1)));
      _retryTimer?.cancel();
      _retryTimer = Timer(delay, () {
        // Only if nothing has replaced this subscription in the meantime — a
        // sign-out, a rebuild, or a retry that already got through.
        if (_channel != channel) return;
        final client = _client;
        if (client == null) return;
        unawaited(_connect(client));
      });
    });
  }

  /// Coalesces a burst into one catch-up. Three machines finishing keywords
  /// in the same minute is three broadcasts and should be one pull.
  ///
  /// [_deadline] is why there are two timers rather than one. A plain
  /// debounce only fires once the pushes stop, and during a busy stretch
  /// they do not; the deadline is armed by the *first* event of a batch and
  /// never extended, so a sustained stream is announced every [_maxWait]
  /// instead of never.
  void _schedule(Set<DataDomain> domains, {required bool scraped}) {
    _pending.addAll(domains);
    _pendingScraped = _pendingScraped || scraped;
    _debounce?.cancel();
    _debounce = Timer(_quietPeriod, _flush);
    _deadline ??= Timer(_maxWait, _flush);
  }

  void _flush() {
    _debounce?.cancel();
    _debounce = null;
    _deadline?.cancel();
    _deadline = null;
    if (_pending.isEmpty) return;
    final domains = Set<DataDomain>.of(_pending);
    final scraped = _pendingScraped;
    _pending.clear();
    _pendingScraped = false;

    // An announcement on its own changes nothing: every list re-reads a
    // local database that does not have the rows this message is about.
    // The catch-up is what turns "the server has new rows" into "this app
    // can see them", and the pull that lands announces itself again — the
    // announcement that actually has data behind it. The bump below is for
    // the scratchpad, whose rows the replicated change already implies.
    ref.read(mirrorCatchUpProvider).request(scraped: scraped);

    ref.bumpData(domains);
    state = state + 1;
  }
}

final liveDataControllerProvider =
    NotifierProvider<LiveDataController, int>(LiveDataController.new);

/// The tables whose rows travel through the R2 catalog rather than Supabase.
/// A broadcast naming one of them means "run the pipeline's pull".
const Set<String> kScrapedTables = {
  'channels',
  'videos',
  'channel_keywords',
  'channel_archive',
  'keywords',
};

/// Which parts of the app a change to these tables invalidates.
Set<DataDomain> domainsForTables(Set<String> tables) => {
      for (final table in tables)
        ...switch (table) {
          'channels' || 'channel_keywords' || 'keywords' => const {
              DataDomain.channels,
              DataDomain.searchRuns,
            },
          'videos' => const {DataDomain.videos, DataDomain.channels},
          'channel_archive' => const {DataDomain.archive, DataDomain.channels},
          'channel_state' => const {DataDomain.channels},
          'edit_conflicts' => const {DataDomain.conflicts},
          'deals' => const {DataDomain.deals, DataDomain.channels},
          'brands' => const {DataDomain.brands},
          'outreach_threads' || 'outreach_messages' => const {
              DataDomain.outreach,
              DataDomain.channels,
            },
          'email_templates' => const {DataDomain.templates},
          'writing_rules' => const {DataDomain.writingRules},
          'follow_up_reminders' => const {DataDomain.reminders},
          'activity_log' => const {DataDomain.activity},
          'scratchpads' => const {DataDomain.scratchpad},
          'agency_settings' => const {DataDomain.agency},
          'comms_proposals' => const {DataDomain.comms},
          _ => const <DataDomain>{},
        },
    };
