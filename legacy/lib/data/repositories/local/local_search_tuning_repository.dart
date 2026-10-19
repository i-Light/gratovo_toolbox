import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/data/models/proxy_entry.dart';
import 'package:gratovo_toolbox/data/models/search_tuning_settings.dart';
import 'package:gratovo_toolbox/data/repositories/search_tuning_repository.dart';

/// The real, file-backed [SearchTuningRepository].
///
/// Reads and writes `data/settings.json` directly, the same file
/// `config.py` reads on every run (see that class's own doc comment for the
/// exact keys). Like [LocalSearchRepository], this is wired in unconditionally
/// (`repository_providers.dart`) rather than gated behind a mirror/desktop
/// check: [ScraperProcess.resolvePaths] already answers null on a platform
/// with no local pipeline, and this falls back to
/// [SearchTuningSettings.defaults] there, the same way the card behaved
/// before any of this was real.
///
/// "Normal" and "Fast" are each a `normal_pacing`/`fast_pacing` key holding
/// the same six sub-keys (`human_scroll_delay`, `jitter_delay`, ...) nested
/// one level down -- deliberately the same shape, since they're the same six
/// knobs under two profiles; see `config.Config.delay()` for how the Python
/// side picks between them. `catchup_videos_delay` and `channel_sweep_break`
/// are not part of either profile and stay at the top level -- they apply
/// the same way regardless of which pacing profile is active, so there is
/// nothing for this model to read or write for them; see `config.py`'s
/// `delay()` doc comment.
class LocalSearchTuningRepository implements SearchTuningRepository {
  const LocalSearchTuningRepository();

  @override
  Future<SearchTuningSettings> get() async {
    final paths = ScraperProcess.resolvePaths();
    if (paths == null) return SearchTuningSettings.defaults;
    final json = await PipelineSettings.readSharedSettings(paths);
    const d = SearchTuningSettings.defaults;
    final normalPacingJson = json['normal_pacing'];
    final fastPacingJson = json['fast_pacing'];
    return SearchTuningSettings(
      handlesToSearchLimit:
          _int(json, 'handles_to_search_limit', d.handlesToSearchLimit),
      pacing: _pacingProfile(
        normalPacingJson is Map
            ? normalPacingJson.cast<String, Object?>()
            : const {},
        d.pacing,
      ),
      fastPacing: _pacingProfile(
        fastPacingJson is Map
            ? fastPacingJson.cast<String, Object?>()
            : const {},
        d.fastPacing,
      ),
      proxyRotationEnabled: _proxiesEnabled(json, d.proxyRotationEnabled),
      includeDirectConnection: _includeDirect(json, d.includeDirectConnection),
      proxies: _proxyList(json),
      parallelSearchEnabled: _parallel(json)?['enabled'] == true,
      parallelMaxWorkers: switch (_parallel(json)?['max_workers']) {
        final num n => n.round(),
        _ => d.parallelMaxWorkers,
      },
      proxyMinGapSeconds: _proxyNumber(json, 'min_gap_seconds'),
      proxyMinGapJitter: _proxyNumber(json, 'min_gap_jitter'),
    );
  }

  @override
  Future<void> update(SearchTuningSettings settings) async {
    final paths = ScraperProcess.resolvePaths();
    if (paths == null) return;
    await PipelineSettings.writeSharedSettings(paths, {
      'handles_to_search_limit': {'value': settings.handlesToSearchLimit},
      'normal_pacing': _pacingJson(settings.pacing),
      'fast_pacing': _pacingJson(settings.fastPacing),
      'proxies': {
        'enabled': settings.proxyRotationEnabled,
        'include_direct': settings.includeDirectConnection,
        'list': settings.proxies.map((p) => p.toJson()).toList(),
        if (settings.proxyMinGapSeconds != null)
          'min_gap_seconds': settings.proxyMinGapSeconds,
        if (settings.proxyMinGapJitter != null)
          'min_gap_jitter': settings.proxyMinGapJitter,
      },
      'parallel_search': {
        'enabled': settings.parallelSearchEnabled,
        'max_workers': settings.parallelMaxWorkers,
      },
    });
  }

  static Map<Object?, Object?>? _parallel(Map<String, Object?> json) =>
      switch (json['parallel_search']) {
        final Map<Object?, Object?> m => m,
        _ => null,
      };

  static double? _proxyNumber(Map<String, Object?> json, String key) {
    final entry = json['proxies'];
    if (entry is Map && entry[key] is num) {
      return (entry[key] as num).toDouble();
    }
    return null;
  }

  static int _int(Map<String, Object?> json, String key, int fallback) {
    final entry = json[key];
    if (entry is Map && entry['value'] is num) {
      return (entry['value'] as num).round();
    }
    return fallback;
  }

  static bool _proxiesEnabled(Map<String, Object?> json, bool fallback) {
    final entry = json['proxies'];
    if (entry is Map && entry['enabled'] is bool) {
      return entry['enabled'] as bool;
    }
    return fallback;
  }

  static bool _includeDirect(Map<String, Object?> json, bool fallback) {
    final entry = json['proxies'];
    if (entry is Map && entry['include_direct'] is bool) {
      return entry['include_direct'] as bool;
    }
    return fallback;
  }

  static List<ProxyEntry> _proxyList(Map<String, Object?> json) {
    final entry = json['proxies'];
    if (entry is Map && entry['list'] is List) {
      return (entry['list'] as List)
          .whereType<Map>()
          .map((e) => ProxyEntry.fromJson(e.cast<String, Object?>()))
          .toList();
    }
    return const [];
  }

  /// Reads one [PacingProfile] out of [json] -- the top-level settings map
  /// for "Normal", or the `fast_pacing` sub-map for "Fast" (same six keys
  /// either way, so this one reader serves both).
  static PacingProfile _pacingProfile(
      Map<String, Object?> json, PacingProfile fallback) {
    return PacingProfile(
      humanScrollDelay:
          _range(json, 'human_scroll_delay', fallback.humanScrollDelay),
      jitterDelay: _range(json, 'jitter_delay', fallback.jitterDelay),
      recentVideosDelay:
          _range(json, 'recent_videos_delay', fallback.recentVideosDelay),
      fastSubCountCheckDelay: _range(
          json, 'fast_sub_count_check_delay', fallback.fastSubCountCheckDelay),
      foundChannelsDelay:
          _range(json, 'found_channels_delay', fallback.foundChannelsDelay),
      ipCooldown: _range(json, 'ip_cooldown', fallback.ipCooldown),
      ipCooldownChance: _cooldownChance(json, fallback.ipCooldownChance),
    );
  }

  static Map<String, Object?> _pacingJson(PacingProfile profile) => {
        'human_scroll_delay': _rangeJson(profile.humanScrollDelay),
        'jitter_delay': _rangeJson(profile.jitterDelay),
        'recent_videos_delay': _rangeJson(profile.recentVideosDelay),
        'fast_sub_count_check_delay':
            _rangeJson(profile.fastSubCountCheckDelay),
        'found_channels_delay': _rangeJson(profile.foundChannelsDelay),
        'ip_cooldown': {
          'range': [profile.ipCooldown.min, profile.ipCooldown.max],
          'chance': (profile.ipCooldownChance * 100).round(),
        },
      };

  static DelayRange _range(
      Map<String, Object?> json, String key, DelayRange fallback) {
    final entry = json[key];
    if (entry is Map && entry['range'] is List) {
      final range = entry['range'] as List;
      if (range.length == 2 && range[0] is num && range[1] is num) {
        return DelayRange(
          min: (range[0] as num).toDouble(),
          max: (range[1] as num).toDouble(),
        );
      }
    }
    return fallback;
  }

  static Map<String, Object?> _rangeJson(DelayRange range) => {
        'range': [range.min, range.max],
      };

  /// `ip_cooldown.chance` is stored 0-100 (the Settings UI shows it as a
  /// percentage); the model is 0.0-1.0.
  static double _cooldownChance(Map<String, Object?> json, double fallback) {
    final entry = json['ip_cooldown'];
    if (entry is Map && entry['chance'] is num) {
      return (entry['chance'] as num).toDouble() / 100;
    }
    return fallback;
  }
}
