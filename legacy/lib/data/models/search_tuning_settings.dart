import 'package:gratovo_toolbox/data/models/proxy_entry.dart';

/// A min/max pair for a randomized pacing delay (seconds) — the old
/// `ui.py` Settings tab's "stealth" range sliders (jitter, scroll delay,
/// etc.), each meant to be sampled randomly between the two bounds on every
/// request so the scraper doesn't look like a bot hitting YouTube on a
/// fixed cadence.
class DelayRange {
  const DelayRange({required this.min, required this.max});

  final double min;
  final double max;

  DelayRange copyWith({double? min, double? max}) {
    return DelayRange(min: min ?? this.min, max: max ?? this.max);
  }
}

/// One full set of the scraper's pacing knobs — the fields the "Pacing"
/// section has always shown. [SearchTuningSettings] holds two of these:
/// [SearchTuningSettings.pacing] ("Normal") and
/// [SearchTuningSettings.fastPacing] ("Fast"), shown as two tabs on the
/// Search Tuning card. `config.py`'s `Config.delay()` picks between the two
/// automatically, at the key level, based on whether IP rotation (a proxy
/// list or an AWS Gateway) is actually active for that run — see that
/// method's doc comment. This class carries no opinion about which profile
/// is "active"; that decision needs the proxy/AWS Gateway state too, which
/// lives outside this model (see `search_tuning_card.dart`'s
/// `_rotationActive`).
class PacingProfile {
  const PacingProfile({
    required this.humanScrollDelay,
    required this.jitterDelay,
    required this.recentVideosDelay,
    required this.fastSubCountCheckDelay,
    required this.foundChannelsDelay,
    required this.ipCooldown,
    required this.ipCooldownChance,
  });

  final DelayRange humanScrollDelay;
  final DelayRange jitterDelay;
  final DelayRange recentVideosDelay;
  final DelayRange fastSubCountCheckDelay;
  final DelayRange foundChannelsDelay;
  final DelayRange ipCooldown;

  /// 0.0–1.0 probability of triggering an IP cooldown pause on any given
  /// request, independent of the `ipCooldown` duration itself.
  final double ipCooldownChance;

  PacingProfile copyWith({
    DelayRange? humanScrollDelay,
    DelayRange? jitterDelay,
    DelayRange? recentVideosDelay,
    DelayRange? fastSubCountCheckDelay,
    DelayRange? foundChannelsDelay,
    DelayRange? ipCooldown,
    double? ipCooldownChance,
  }) {
    return PacingProfile(
      humanScrollDelay: humanScrollDelay ?? this.humanScrollDelay,
      jitterDelay: jitterDelay ?? this.jitterDelay,
      recentVideosDelay: recentVideosDelay ?? this.recentVideosDelay,
      fastSubCountCheckDelay:
          fastSubCountCheckDelay ?? this.fastSubCountCheckDelay,
      foundChannelsDelay: foundChannelsDelay ?? this.foundChannelsDelay,
      ipCooldown: ipCooldown ?? this.ipCooldown,
      ipCooldownChance: ipCooldownChance ?? this.ipCooldownChance,
    );
  }

  /// The historical "Normal" values -- unchanged from what this app has
  /// always shipped (see [SearchTuningSettings.defaults]'s own doc comment
  /// for their history).
  static const PacingProfile normalDefaults = PacingProfile(
    humanScrollDelay: DelayRange(min: 1.5, max: 3.5),
    jitterDelay: DelayRange(min: 2.5, max: 6.0),
    recentVideosDelay: DelayRange(min: 1.5, max: 4.0),
    fastSubCountCheckDelay: DelayRange(min: 0.5, max: 1.0),
    foundChannelsDelay: DelayRange(min: 4.0, max: 9.0),
    ipCooldown: DelayRange(min: 30.0, max: 90.0),
    ipCooldownChance: 0.6,
  );

  /// Starting point for the "Fast" tab: every request goes out under a
  /// different apparent IP when rotation is on (a proxy list or an AWS
  /// Gateway), so there is no single identity left to protect by pacing
  /// gently -- these are a rough 4-6x speed-up over [normalDefaults], not a
  /// measured optimum. `ipCooldownChance` is cut the most (60% -> 10%): its
  /// whole point is spacing out requests so *one* IP doesn't look automated,
  /// which stops mattering once each request already looks like it came
  /// from somewhere else. `ipCooldown`'s duration is shortened too, not
  /// zeroed -- if a candidate does get flagged, still give it a little room
  /// rather than immediately hammering it again on the next round-robin turn.
  /// Purely a starting value: editable like every other field, and only
  /// ever read by the scraper while rotation is actually on (see
  /// `PacingProfile`'s own doc comment).
  static const PacingProfile fastDefaults = PacingProfile(
    humanScrollDelay: DelayRange(min: 0.3, max: 0.8),
    jitterDelay: DelayRange(min: 0.5, max: 1.5),
    recentVideosDelay: DelayRange(min: 0.3, max: 1.0),
    fastSubCountCheckDelay: DelayRange(min: 0.1, max: 0.3),
    foundChannelsDelay: DelayRange(min: 0.5, max: 1.5),
    ipCooldown: DelayRange(min: 5.0, max: 15.0),
    ipCooldownChance: 0.1,
  );
}

/// The scraper's pacing/proxy tunables — everything the old `ui.py` Settings
/// tab exposed, now editable from Settings → Advanced / Search Tuning
/// (desktop-only, see `DesktopOnly`) and persisted for real to
/// `data/settings.json` (`LocalSearchTuningRepository`), the same file
/// `config.py` reads on every run. This settings object is a single row, not
/// a list — there is one shared tuning config the whole team's scraper runs
/// read, not one per user.
///
/// [handlesToSearchLimit] is still a real `config.py` value read straight out
/// of `data/settings.json`, but is deliberately no longer shown on the
/// Search Tuning card — it's a genuine duplicate of the search screen's own
/// "Max videos/search" override; see `search_tuning_card.dart`'s doc
/// comment. It stays in this model, unedited by the card, purely so a save
/// from it round-trips the file's existing value for that key rather than
/// resetting it to whatever a stale in-memory copy last held.
///
/// Two more values used to live here and don't any more:
///
///  * `minimumSubscribers` — a separate, never-enforced `settings.json` key
///    that only ever got copied into each keyword's recorded
///    search-settings snapshot, never actually applied as a filter anywhere
///    in the pipeline. The real, enforced subscriber filter is
///    `AutoCleanRule.minSubscribers` (`auto_clean_controller.dart`), which is
///    also the one shown in the app (the Auto-Clean panel).
///  * `recentVideosMonths` — same story: read out of `settings.json` and
///    carried into the search-settings snapshot, but nothing in the pipeline
///    ever read it back out to actually filter by recency, and (unlike
///    `handlesToSearchLimit`) it had no other editor duplicating it either.
///
/// Both removed rather than kept in sync, so this model only ever holds a
/// value something actually uses.
class SearchTuningSettings {
  const SearchTuningSettings({
    required this.handlesToSearchLimit,
    required this.pacing,
    required this.fastPacing,
    this.proxyRotationEnabled = false,
    this.includeDirectConnection = true,
    this.proxies = const [],
    this.parallelSearchEnabled = false,
    this.parallelMaxWorkers = 4,
    this.proxyMinGapSeconds,
    this.proxyMinGapJitter,
  });

  /// Max number of channel handles fetched per search run.
  final int handlesToSearchLimit;

  /// The "Normal" pacing tab — used whenever IP rotation is off.
  final PacingProfile pacing;

  /// The "Fast" pacing tab — only ever applied by the scraper while proxy
  /// rotation or the AWS Gateway is actually active; see
  /// `PacingProfile.fastDefaults`'s doc comment.
  final PacingProfile fastPacing;

  /// Whether `_request` (scrapetube.py) rotates through [proxies] at all.
  /// Off, or an empty/all-disabled list, means every request still goes out
  /// directly from this machine, exactly as before this feature existed.
  final bool proxyRotationEnabled;

  /// Whether this machine's own (no-proxy) connection is itself one of the
  /// rotation candidates, not just a fallback used when rotation is off.
  final bool includeDirectConnection;

  final List<ProxyEntry> proxies;

  /// Parallel search (`parallel.py`): several keywords at once, one per
  /// rotating connection (AWS gateway or proxy), at the Normal speed. Off by
  /// default, and nothing changes with it on unless there are at least two
  /// such connections.
  final bool parallelSearchEnabled;

  /// The most keywords worked at once, however many connections there are.
  final int parallelMaxWorkers;

  /// `proxies.min_gap_seconds` / `min_gap_jitter` in settings.json -- the
  /// floor between two requests to one gateway or proxy (`proxy_pool.py`).
  /// Not edited here; carried so saving this card does not drop a value set
  /// in the file by hand. Null: not set, the pipeline's own default applies.
  final double? proxyMinGapSeconds;
  final double? proxyMinGapJitter;

  /// Whether at least one outbound identity besides this machine's own is
  /// actually in rotation right now -- mirrors `config._proxy_rotation_active`
  /// (Python) exactly, so the UI's notion of "rotation active" (which gates
  /// the Fast tab, see `search_tuning_card.dart`) never drifts from what the
  /// scraper itself uses to choose a pacing profile. AWS Gateway's own
  /// enabled/deployed state lives in a separate provider/file
  /// (`awsGatewaySettingsProvider`), so it isn't part of this method --
  /// combine with that provider's own state at the call site.
  bool get proxyRotationActive {
    if (!proxyRotationEnabled) return false;
    return proxies.any((p) => p.enabled && p.host.trim().isNotEmpty);
  }

  SearchTuningSettings copyWith({
    int? handlesToSearchLimit,
    PacingProfile? pacing,
    PacingProfile? fastPacing,
    bool? proxyRotationEnabled,
    bool? includeDirectConnection,
    List<ProxyEntry>? proxies,
    bool? parallelSearchEnabled,
    int? parallelMaxWorkers,
  }) {
    return SearchTuningSettings(
      handlesToSearchLimit: handlesToSearchLimit ?? this.handlesToSearchLimit,
      pacing: pacing ?? this.pacing,
      fastPacing: fastPacing ?? this.fastPacing,
      proxyRotationEnabled: proxyRotationEnabled ?? this.proxyRotationEnabled,
      includeDirectConnection:
          includeDirectConnection ?? this.includeDirectConnection,
      proxies: proxies ?? this.proxies,
      parallelSearchEnabled:
          parallelSearchEnabled ?? this.parallelSearchEnabled,
      parallelMaxWorkers: parallelMaxWorkers ?? this.parallelMaxWorkers,
      proxyMinGapSeconds: proxyMinGapSeconds,
      proxyMinGapJitter: proxyMinGapJitter,
    );
  }

  /// How many AWS gateways and proxies a run would rotate through, given
  /// [gateways] deployed-and-enabled -- `config.rotating_connection_count`.
  int rotatingConnections({int gateways = 0}) {
    final usableProxies = proxyRotationEnabled
        ? proxies.where((p) => p.enabled && p.host.trim().isNotEmpty).length
        : 0;
    return usableProxies + gateways;
  }

  /// Keywords a run works at once -- `parallel.worker_count`.
  int parallelWorkers({int gateways = 0}) {
    if (!parallelSearchEnabled) return 1;
    final cap = parallelMaxWorkers.clamp(1, 8);
    return rotatingConnections(gateways: gateways).clamp(1, cap);
  }

  /// (Phase 5) The REAL values, copied directly from the actual
  /// `data/settings.json` on the user's machine — not the placeholder
  /// stand-ins this used to hold. `ip_cooldown`'s `chance` field in that file is `40`
  /// (i.e. 40, on a 0–100 scale, since the Settings UI shows it as a
  /// percentage) — converted to this class's 0.0–1.0 scale as `0.4`; every
  /// other field is a direct, unconverted copy. `data_path`/
  /// `found_channels_data_path` from that file aren't reflected here: they
  /// aren't part of this model at all — they're filesystem locations the
  /// Python side manages, not a tunable a person edits. `proxies` defaults
  /// to disabled/empty here, matching the real file before anyone has added
  /// a proxy.
  ///
  /// The delay ranges were widened (and `ip_cooldown`'s chance raised to 60%)
  /// when the scraper's pacing was hardened against being rate-limited: the
  /// old sub-second gaps were a request cadence no person produces, and the
  /// pipeline now backs off and stops rather than keep knocking once YouTube
  /// starts refusing. These stay a copy of `data/settings.json`, so they move
  /// when that file moves (now [PacingProfile.normalDefaults]). One key in
  /// that file has no field here yet: `channel_sweep_break`
  /// (`{"range": [40, 100], "every": 30}`) — the pause the pipeline takes
  /// every N channels so a long sweep is not one unbroken burst. Editing it
  /// means editing the file; adding it to this card needs a new l10n label,
  /// which is the only reason it is not here. It applies the same way under
  /// either pacing profile.
  static const SearchTuningSettings defaults = SearchTuningSettings(
    handlesToSearchLimit: 200,
    pacing: PacingProfile.normalDefaults,
    fastPacing: PacingProfile.fastDefaults,
  );
}
