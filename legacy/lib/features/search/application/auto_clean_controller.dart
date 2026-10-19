import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/core/sync/operation_log.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine_types.dart';
import 'package:gratovo_toolbox/core/sync/sync_providers.dart';
import 'package:gratovo_toolbox/data/models/bulk_rejection.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// What the pipeline does with a channel whose subscriber count falls in one of
/// the out-of-range bands, decided during the run before its videos are fetched.
///
/// The names are the wire values — they travel in `run_config.json` and are
/// read back by `config.py`'s `auto_clean_*_action`.
enum AutoCleanBandAction {
  /// Archive it now, on this machine, and sync the tombstone up. Only the
  /// subscriber count is kept. Nothing fetches its videos.
  sweep,

  /// Keep it, don't archive it, but skip its videos this run — the standing
  /// video backlog (`backfill_missing_videos`) picks them up later.
  delay,

  /// Do nothing special: treat it exactly like an in-range channel.
  off;

  String get wire => name;

  static AutoCleanBandAction fromWire(
      String? value, AutoCleanBandAction fallback) {
    for (final action in AutoCleanBandAction.values) {
      if (action.wire == value) return action;
    }
    return fallback;
  }
}

/// The standing rule for what a finished search is allowed to throw away.
///
/// A broad keyword run ends with several thousand channels, and most of them
/// were never worth having — too small to work with, or large but abandoned.
/// Clearing those by hand is the job nobody does, so the list stays unusable.
/// This is that job stated once, in advance, and applied the moment the results
/// land.
///
/// It is deliberately a *rule*, not a saved search: nothing about it is
/// per-run. You decide once what "not worth having" means for this agency, and
/// every run from then on is filtered by it.
///
/// Two things act on it. The post-run **sweep** ([requestFor]) hands the whole
/// rule — both ranges, the videos floor — to the Supabase RPC once a run ends.
/// The pipeline **gate** ([toRunConfigJson]) gets only the subscriber range,
/// forwarded on the Start button, and applies it mid-run: channels below
/// [belowMinAction] and above [aboveMaxAction] never cost a video scrape.
class AutoCleanRule {
  const AutoCleanRule({
    this.enabled = false,
    this.minSubscribers,
    this.maxSubscribers,
    this.minMedianViews,
    this.maxMedianViews,
    this.minVideosLast30,
    this.belowMinAction = AutoCleanBandAction.sweep,
    this.aboveMaxAction = AutoCleanBandAction.delay,
    this.label = ChannelTag.irrelevant,
  });

  /// Off until somebody turns it on, and off is the honest default. This runs
  /// unattended against results nobody has looked at yet; it should never be
  /// something a person discovers happening.
  final bool enabled;

  /// Inclusive bounds. Null is an open end. The two ranges narrow together —
  /// a channel has to be inside every bound that is set — which is the only
  /// way the rule can say the thing people actually mean: "too small to work
  /// with AND nobody is watching".
  final int? minSubscribers;
  final int? maxSubscribers;
  final int? minMedianViews;
  final int? maxMedianViews;

  /// Reject a channel that posted fewer than this many videos in the last 30
  /// days — matched against `channels.videos_last_30`. A floor, not a range:
  /// the number is the minimum a channel has to clear to be kept.
  final int? minVideosLast30;

  /// What the pipeline gate does with a channel *below* [minSubscribers] and
  /// *above* [maxSubscribers], decided mid-run before its videos are fetched.
  /// Only these two bands travel to the pipeline — the average-views and
  /// videos floor need data the gate does not have yet, and stay with the
  /// post-run sweep. Defaults: sweep the small ones, delay the big ones.
  final AutoCleanBandAction belowMinAction;
  final AutoCleanBandAction aboveMaxAction;

  /// Why they were rejected. The same two the archive's check constraint
  /// allows; anything else is a request the database refuses.
  final ChannelTag label;

  /// Whether this rule describes anything at all — a subscriber range, an
  /// average-views range, or a videos floor.
  bool get hasBounds =>
      hasSubscriberRange ||
      minMedianViews != null ||
      maxMedianViews != null ||
      minVideosLast30 != null;

  /// The subscriber keep-band is the one thing both the pipeline gate and the
  /// post-run sweep need; without it there is nothing to gate on and the
  /// average-views rule has no band to attach to.
  bool get hasSubscriberRange =>
      minSubscribers != null || maxSubscribers != null;

  bool get isActive => enabled && hasBounds;

  /// Whether the pipeline gate has anything to do: enabled, and with a
  /// subscriber bound whose band is not turned off.
  bool get gatesPipeline =>
      enabled &&
      ((minSubscribers != null && belowMinAction != AutoCleanBandAction.off) ||
          (maxSubscribers != null &&
              aboveMaxAction != AutoCleanBandAction.off));

  /// The subscriber range and its per-band actions, for `run_config.json`.
  /// Null when there is nothing for the pipeline to act on — the caller then
  /// omits the `auto_clean` key entirely and the pipeline behaves as before.
  Map<String, Object?>? toRunConfigJson() {
    if (!enabled || (minSubscribers == null && maxSubscribers == null)) {
      return null;
    }
    return {
      'enabled': true,
      'min_subscribers': minSubscribers,
      'max_subscribers': maxSubscribers,
      'below_min_action': belowMinAction.wire,
      'above_max_action': aboveMaxAction.wire,
      'label': label.wire,
    };
  }

  /// The post-run sweep, as up to five RPC calls against the run's own finds.
  ///
  /// Both the subscriber field and the average-views field are *keep* bands, so
  /// rejecting on one means rejecting what is **outside** it — which the RPC (a
  /// single inclusive range) cannot express in one call, hence a list:
  ///
  ///   * below the subscriber band → reject `<= minSubscribers - 1`, but only
  ///     if [belowMinAction] is [AutoCleanBandAction.sweep]. `delay`/`off`
  ///     leave nothing for the sweep to do — the pipeline gate already handled
  ///     the deferral, and a deferred channel is not a rejected one.
  ///   * above the subscriber band → reject `>= maxSubscribers + 1`, only if
  ///     [aboveMaxAction] is `sweep`.
  ///   * below / above the average-views band → reject the outside on each
  ///     side. Always after the run, never at the gate: a channel's average
  ///     views are not known until its videos have been read.
  ///   * the videos floor → reject a channel posting fewer than
  ///     [minVideosLast30] in 30 days. A floor, not a band.
  ///
  /// [firstSeenAfter] is always the moment the run started — what keeps an
  /// unattended sweep to the channels that run actually brought in. `immediate`
  /// is hard-coded false: the 7-day grace period is the only thing between a
  /// mistyped bound and an unrecoverable cascade.
  List<BulkRejectionRequest> requestsFor(DateTime firstSeenAfter) =>
      _requests(firstSeenAfter: firstSeenAfter, untouchedOnly: false);

  /// The standing sweep: the same rule, over the whole roster, restricted to
  /// channels nobody has touched.
  ///
  /// The per-run sweep and the pipeline's gate only ever see a run's own
  /// finds, on the machine that ran it. Everything else on the roster is
  /// outside both: a teammate's finds pulled in from the catalog (their rule
  /// may be off, or lower), a run killed before this app saw it end, a run
  /// that was restarted so the catch-up only swept the last one. Any of those
  /// leaves channels sitting live below the band the rule says to throw
  /// away, and "below the band" is the one thing the rule is supposed to
  /// make impossible to see.
  ///
  /// No window, so [BulkRejectionRequest.untouchedOnly] is the safety
  /// instead: a channel with a tag, a vetting status or a stage has been
  /// looked at and is left alone. The countdown and the deal/outreach guards
  /// are as before.
  List<BulkRejectionRequest> standingRequests() =>
      _requests(firstSeenAfter: null, untouchedOnly: true);

  List<BulkRejectionRequest> _requests({
    required DateTime? firstSeenAfter,
    required bool untouchedOnly,
  }) {
    final requests = <BulkRejectionRequest>[];
    BulkRejectionRequest reject({
      int? maxSubscribers,
      int? minSubscribers,
      int? maxMedianViews,
      int? minMedianViews,
      int? minVideosLast30,
    }) {
      return BulkRejectionRequest(
        maxSubscribers: maxSubscribers,
        minSubscribers: minSubscribers,
        maxMedianViews: maxMedianViews,
        minMedianViews: minMedianViews,
        minVideosLast30: minVideosLast30,
        firstSeenAfter: firstSeenAfter,
        untouchedOnly: untouchedOnly,
        label: label,
        immediate: false,
      );
    }

    final subMin = minSubscribers;
    final subMax = maxSubscribers;
    if (subMin != null &&
        subMin > 0 &&
        belowMinAction == AutoCleanBandAction.sweep) {
      requests.add(reject(maxSubscribers: subMin - 1));
    }
    if (subMax != null && aboveMaxAction == AutoCleanBandAction.sweep) {
      requests.add(reject(minSubscribers: subMax + 1));
    }

    final avgMin = minMedianViews;
    final avgMax = maxMedianViews;
    if (avgMin != null && avgMin > 0) {
      requests.add(reject(maxMedianViews: avgMin - 1));
    }
    if (avgMax != null) {
      requests.add(reject(minMedianViews: avgMax + 1));
    }

    if (minVideosLast30 != null) {
      requests.add(reject(minVideosLast30: minVideosLast30));
    }
    return requests;
  }

  AutoCleanRule copyWith({
    bool? enabled,
    int? Function()? minSubscribers,
    int? Function()? maxSubscribers,
    int? Function()? minMedianViews,
    int? Function()? maxMedianViews,
    int? Function()? minVideosLast30,
    AutoCleanBandAction? belowMinAction,
    AutoCleanBandAction? aboveMaxAction,
    ChannelTag? label,
  }) {
    return AutoCleanRule(
      enabled: enabled ?? this.enabled,
      minSubscribers:
          minSubscribers != null ? minSubscribers() : this.minSubscribers,
      maxSubscribers:
          maxSubscribers != null ? maxSubscribers() : this.maxSubscribers,
      minMedianViews:
          minMedianViews != null ? minMedianViews() : this.minMedianViews,
      maxMedianViews:
          maxMedianViews != null ? maxMedianViews() : this.maxMedianViews,
      minVideosLast30:
          minVideosLast30 != null ? minVideosLast30() : this.minVideosLast30,
      belowMinAction: belowMinAction ?? this.belowMinAction,
      aboveMaxAction: aboveMaxAction ?? this.aboveMaxAction,
      label: label ?? this.label,
    );
  }

  Map<String, Object?> toJson() => {
        'enabled': enabled,
        'min_subscribers': minSubscribers,
        'max_subscribers': maxSubscribers,
        'min_median_views': minMedianViews,
        'max_median_views': maxMedianViews,
        'min_videos_last_30': minVideosLast30,
        'below_min_action': belowMinAction.wire,
        'above_max_action': aboveMaxAction.wire,
        'label': label.wire,
      };

  /// Anything unreadable falls back to the default — which is *off*. A rule
  /// restored from a half-written or older payload must never come back on
  /// with bounds it did not have.
  static AutoCleanRule fromJson(Map<String, Object?> json) {
    int? number(String key) {
      final value = json[key];
      return value is num ? value.toInt() : null;
    }

    return AutoCleanRule(
      enabled: json['enabled'] == true,
      minSubscribers: number('min_subscribers'),
      maxSubscribers: number('max_subscribers'),
      minMedianViews: number('min_median_views'),
      maxMedianViews: number('max_median_views'),
      minVideosLast30: number('min_videos_last_30'),
      belowMinAction: AutoCleanBandAction.fromWire(
          json['below_min_action'] as String?, AutoCleanBandAction.sweep),
      aboveMaxAction: AutoCleanBandAction.fromWire(
          json['above_max_action'] as String?, AutoCleanBandAction.delay),
      label: rejectingLabel(json['label'] as String?),
    );
  }

  /// The stored label, clamped to one the archive can actually hold.
  ///
  /// `ChannelTag.fromWire` will happily hand back `qualified` or `undecided`,
  /// and `channel_archive.label`'s check constraint allows neither — so a rule
  /// carrying one would not do the wrong thing, it would fail every sweep from
  /// then on with a constraint error nobody is watching for. Anything that is
  /// not a rejecting tag ([ChannelTag.rejecting]) falls back to `irrelevant`;
  /// this is the boundary where a hand-edited or older stored payload comes in.
  static ChannelTag rejectingLabel(String? wire) {
    final tag = ChannelTag.fromWire(wire);
    return (tag != null && tag.isRejecting) ? tag : ChannelTag.irrelevant;
  }
}

/// Where [AutoCleanRuleNotifier] resolves and persists the rule -- abstracted
/// so a test can swap in [NoopAutoCleanRuleStore] rather than have every test
/// that so much as reads [autoCleanRuleProvider] perform real file IO against
/// whatever `data/settings.local.json`/`settings.json` happen to be on the
/// machine running the suite. [ScraperProcess.resolvePaths] finds the real
/// project root by walking up from the working directory, which a checkout's
/// own `flutter test` run satisfies just as well as a real install does --
/// there is no "test mode" that turns it off on its own.
abstract class AutoCleanRuleStore {
  /// This machine's own override (`settings.local.json`'s `auto_clean`
  /// entry), or null if it hasn't set one / there is no local pipeline here.
  Future<Map<String, Object?>?> readLocal();

  /// The shared, committed default (`settings.json`'s `auto_clean` entry).
  Future<Map<String, Object?>?> readShared();

  /// Overwrites this machine's own `auto_clean` entry. A no-op wherever
  /// there is no local pipeline to write it to (web, or [readLocal] would
  /// have found nothing to begin with).
  Future<void> writeLocal(Map<String, Object?> autoCleanJson);
}

/// The real [AutoCleanRuleStore], backed by [ScraperProcess]'s file bridge.
class LocalFileAutoCleanRuleStore implements AutoCleanRuleStore {
  const LocalFileAutoCleanRuleStore();

  @override
  Future<Map<String, Object?>?> readLocal() async {
    final paths = ScraperProcess.resolvePaths();
    if (paths == null) return null;
    final json = await PipelineSettings.readLocalSettings(paths);
    final value = json['auto_clean'];
    return value is Map ? value.cast<String, Object?>() : null;
  }

  @override
  Future<Map<String, Object?>?> readShared() async {
    final paths = ScraperProcess.resolvePaths();
    if (paths == null) return null;
    final json = await PipelineSettings.readSharedSettings(paths);
    final value = json['auto_clean'];
    return value is Map ? value.cast<String, Object?>() : null;
  }

  @override
  Future<void> writeLocal(Map<String, Object?> autoCleanJson) async {
    final paths = ScraperProcess.resolvePaths();
    if (paths == null) return;
    await PipelineSettings.writeLocalSettings(
        paths, {'auto_clean': autoCleanJson});
  }
}

/// Touches no disk at all -- what a test overrides [autoCleanRuleStoreProvider]
/// to, unless the test is specifically about persistence.
class NoopAutoCleanRuleStore implements AutoCleanRuleStore {
  const NoopAutoCleanRuleStore();

  @override
  Future<Map<String, Object?>?> readLocal() async => null;

  @override
  Future<Map<String, Object?>?> readShared() async => null;

  @override
  Future<void> writeLocal(Map<String, Object?> autoCleanJson) async {}
}

final autoCleanRuleStoreProvider = Provider<AutoCleanRuleStore>((ref) {
  return const LocalFileAutoCleanRuleStore();
});

/// Legacy `SharedPreferences` key a rule used to be stored under, before this
/// moved to `data/settings.local.json`. Only ever read once, by
/// [AutoCleanRuleNotifier._migrateFromSharedPreferencesIfNeeded], to carry an
/// already-configured rule forward onto disk rather than silently reverting
/// it to the shared default the first time the app launches post-upgrade.
const _autoCleanRuleKey = 'search.autoCleanRule';

/// What a machine reaches for when neither it nor the team has ever set a
/// rule anywhere -- no `settings.local.json` override, and, implausibly,
/// no `auto_clean` block in the committed `settings.json` either (the file
/// always ships with one; this is the fallback of the fallback).
///
/// Deliberately *on*, with a wide keep-band: 50k–5M subscribers is the range
/// this agency actually works with, and the request was to have it apply out of
/// the box rather than wait to be discovered and switched on. Below the band is
/// swept during the run; above it is only deferred.
const defaultAutoCleanRule = AutoCleanRule(
  enabled: true,
  minSubscribers: 50000,
  maxSubscribers: 5000000,
);

/// The `startedAt` of the most recent run the rule has already been applied to.
/// What stops [AutoCleanRunner._catchUpOnLastRun] from re-sweeping the same run
/// on every single launch.
const _sweptThroughKey = 'search.autoCleanSweptThrough';

/// Holds the rule and persists it, because a rule you have to re-enter every
/// launch is one that is never on when it matters.
///
/// Backed by `data/settings.local.json` (this machine's own `auto_clean`
/// entry) rather than `SharedPreferences`, falling back to the shared,
/// committed `settings.json`'s `auto_clean` block when this machine hasn't
/// set its own -- the same two-file, local-overrides-shared shape
/// `config.py`'s `Config.__init__` already uses (`LOCAL_SETTINGS_PATH` over
/// `SETTINGS_PATH`). Chosen over the shared file on purpose: everyone's own
/// rule can differ (see [_resolveRule]'s doc comment), but everyone starts
/// from the same default.
///
/// [_watchTimer] polls both files every [_watchInterval] so a change made
/// outside this running app -- hand-editing either file, or a rule this
/// notifier itself just wrote landing back on disk -- is picked up live, with
/// no restart needed; see [_checkForExternalChange].
class AutoCleanRuleNotifier extends Notifier<AutoCleanRule> {
  Timer? _watchTimer;

  /// Completes once the persisted rule has been read (or found absent) and
  /// `state` is whatever this machine actually has — as opposed to
  /// [defaultAutoCleanRule], which is what `state` is from [build] until then.
  ///
  /// What an unattended caller awaits before acting on the rule at launch.
  /// The built-in default is *on*, with a 50K floor; a person whose own rule
  /// is off, or set higher or lower, must not have the default swept over
  /// their roster in the second before their file is read.
  final Completer<void> _ready = Completer<void>();
  Future<void> get ready => _ready.future;

  /// The last rule this notifier itself either loaded or wrote, as JSON.
  /// [_checkForExternalChange] compares each poll's disk read against this
  /// rather than applying it unconditionally -- otherwise this machine's own
  /// write reads back as "external change" three seconds later and the
  /// timer would spend its whole life reapplying what is already current.
  String? _lastSeenJson;

  /// True for the span of an in-flight [_persist] write. [_checkForExternalChange]
  /// skips its turn while this is set, so a poll tick that starts mid-write
  /// -- reading the file after `state`/[_lastSeenJson] already moved but
  /// before the new bytes have landed -- cannot see that in-between disk
  /// content and revert `state` right back to what the person just changed.
  bool _persisting = false;

  static const _watchInterval = Duration(seconds: 3);

  @override
  AutoCleanRule build() {
    final store = ref.watch(autoCleanRuleStoreProvider);
    ref.onDispose(() => _watchTimer?.cancel());
    unawaited(_loadPersisted(store));
    return defaultAutoCleanRule;
  }

  Future<void> _loadPersisted(AutoCleanRuleStore store) async {
    try {
      await _migrateFromSharedPreferencesIfNeeded(store);
      final rule = await _resolveRule(store);
      if (rule != null) {
        state = rule;
        _lastSeenJson = jsonEncode(rule.toJson());
      }
    } catch (error, stackTrace) {
      // Left off rather than guessed at. This decides what an unattended sweep
      // does; a half-understood rule is worse than no rule.
      developer.log(
        'Failed to load the auto-clean rule; leaving it at the built-in default.',
        name: 'gratovo.search',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
    if (!_ready.isCompleted) _ready.complete();
    _watchTimer = Timer.periodic(
      _watchInterval,
      (_) => unawaited(_checkForExternalChange(store)),
    );
  }

  /// One-time carry-forward: a rule saved from before this notifier moved off
  /// `SharedPreferences` moves onto this machine's `settings.local.json`
  /// instead of silently reverting to the shared default. No-ops once this
  /// machine has a local `auto_clean` entry either way (already migrated, or
  /// the person has since set one directly on disk) -- migration only ever
  /// fills an empty slot, never overwrites one.
  Future<void> _migrateFromSharedPreferencesIfNeeded(
    AutoCleanRuleStore store,
  ) async {
    if (await store.readLocal() != null) return;
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_autoCleanRuleKey);
    if (saved == null) return;
    final decoded = jsonDecode(saved);
    if (decoded is! Map) return;
    final rule = AutoCleanRule.fromJson(Map<String, Object?>.from(decoded));
    await store.writeLocal(rule.toJson());
    await prefs.remove(_autoCleanRuleKey);
  }

  /// This machine's own override (`settings.local.json`) if it has set one,
  /// otherwise the shared, committed default (`settings.json`) -- mirrors
  /// `config.py`'s `_auto_clean` fallback exactly, so the rule the pipeline
  /// gate resolves for a bare `python search.py` run and the rule this panel
  /// shows agree even when the app never forwarded one via `run_config.json`.
  /// Null only if neither has an `auto_clean` entry at all.
  Future<AutoCleanRule?> _resolveRule(AutoCleanRuleStore store) async {
    final local = await store.readLocal();
    if (local != null) return AutoCleanRule.fromJson(local);
    final shared = await store.readShared();
    if (shared != null) return AutoCleanRule.fromJson(shared);
    return null;
  }

  /// Polls rather than a native file-system watch -- the same tradeoff
  /// `active_search_run_controller.dart` makes for the same reason: a plain
  /// interval behaves identically across every editor's save strategy (some
  /// replace-by-rename rather than write-in-place, which a watch can see as a
  /// delete) and every platform this app runs on, for a pair of files too
  /// small for the extra read to matter.
  Future<void> _checkForExternalChange(AutoCleanRuleStore store) async {
    if (_persisting) return;
    final rule = await _resolveRule(store);
    if (rule == null) return;
    final encoded = jsonEncode(rule.toJson());
    if (encoded == _lastSeenJson) return;
    _lastSeenJson = encoded;
    state = rule;
  }

  Future<void> _persist(AutoCleanRule rule) async {
    state = rule;
    _lastSeenJson = jsonEncode(rule.toJson());
    _persisting = true;
    try {
      await ref.read(autoCleanRuleStoreProvider).writeLocal(rule.toJson());
    } catch (error, stackTrace) {
      developer.log(
        'Failed to persist the auto-clean rule.',
        name: 'gratovo.search',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    } finally {
      _persisting = false;
    }
  }

  Future<void> setEnabled(bool value) =>
      _persist(state.copyWith(enabled: value));

  Future<void> setMinSubscribers(int? value) =>
      _persist(state.copyWith(minSubscribers: () => value));

  Future<void> setMaxSubscribers(int? value) =>
      _persist(state.copyWith(maxSubscribers: () => value));

  Future<void> setMinMedianViews(int? value) =>
      _persist(state.copyWith(minMedianViews: () => value));

  Future<void> setMaxMedianViews(int? value) =>
      _persist(state.copyWith(maxMedianViews: () => value));

  Future<void> setMinVideosLast30(int? value) =>
      _persist(state.copyWith(minVideosLast30: () => value));

  Future<void> setBelowMinAction(AutoCleanBandAction value) =>
      _persist(state.copyWith(belowMinAction: value));

  Future<void> setAboveMaxAction(AutoCleanBandAction value) =>
      _persist(state.copyWith(aboveMaxAction: value));

  Future<void> setLabel(ChannelTag value) =>
      _persist(state.copyWith(label: value));

  /// House choice HC-18 (INF-QUAL-07): no size cap, anyone with about 50k
  /// average views. Sets the views floor to the same "about 50k" the profile's
  /// pre-screen uses and clears both upper caps. The subscriber floor and the
  /// videos floor are left alone — they save scraping and drop dead channels,
  /// they do not cap size — and so is whether the rule is on.
  Future<void> applyHouseViewBar() => _persist(state.copyWith(
        minMedianViews: () => kHouseViewFloor,
        maxMedianViews: () => null,
        maxSubscribers: () => null,
      ));
}

/// HC-18's "about 50k average views", as a floor ([meetsViewBar] in
/// media_kit.dart lets the same 45k through).
const int kHouseViewFloor = 45000;

final autoCleanRuleProvider =
    NotifierProvider<AutoCleanRuleNotifier, AutoCleanRule>(
  AutoCleanRuleNotifier.new,
);

/// What the last automatic sweep did, so the page can say it out loud.
///
/// Kept rather than shown once and forgotten: an action nobody authorised in
/// the moment has to leave a trace on the screen where it was configured, or
/// the only evidence it ran is channels quietly missing from a list.
class AutoCleanReport {
  const AutoCleanReport({
    required this.at,
    required this.outcome,
    this.error,
  });

  final DateTime at;

  /// Null when the run failed.
  final BulkRejectionOutcome? outcome;
  final Object? error;

  bool get failed => error != null;
}

/// Applies [AutoCleanRule] to a finished run's results.
///
/// One `apply` call, not the dialog's check-then-confirm pair. The two-step
/// flow exists so a person reads a count before agreeing to it, and there is no
/// person here — a dry run first would only be a number nobody looks at, at the
/// cost of the two calls describing different sets of rows.
///
/// What replaces that safety is narrower reach: the discovery window pins the
/// sweep to this run's own finds, the tag is a 7-day countdown rather than a
/// delete, and the RPC's own guards still refuse channels with a deal or an
/// outreach history.
///
/// Plus one **standing sweep** over the whole roster ([sweepStanding]), which
/// has no window and is narrowed by [BulkRejectionRequest.untouchedOnly]
/// instead. The per-run sweep and the pipeline's gate between them cover a
/// run's own finds on the machine that ran it, and nothing else — so a
/// teammate's finds arriving from the catalog, or a run this app never saw
/// end, sat live below the floor with the rule on and nothing to apply it. The
/// standing sweep is what makes "below the band" mean "archived or counting
/// down" on every row, however it arrived. See
/// [AutoCleanRule.standingRequests].
class AutoCleanRunner extends Notifier<AutoCleanReport?> {
  /// The debounce behind [scheduleStandingSweep]. A sync pass that lands a
  /// teammate's segment bumps the revision several times in a row; one scan
  /// after the last of them is the same answer as one scan after each.
  static const _standingDelay = Duration(seconds: 5);

  Timer? _standingTimer;
  bool _standingInFlight = false;
  bool _standingAgain = false;

  @override
  AutoCleanReport? build() {
    ref.onDispose(() => _standingTimer?.cancel());
    // The trigger lives here, not on the Search page.
    //
    // It used to be a `ref.listen` inside `SearchScreen.build`, which meant
    // the sweep only happened if the person was still looking at the Search
    // page at the moment the run ended. A discovery run is precisely the thing
    // you start and then go and do something else during -- so the rule that
    // exists because "clearing those by hand is the job that does not get
    // done" was itself only done when somebody was watching. Kept alive from
    // the app shell (`app_shell.dart`) so it is listening for the whole
    // session, and the Search page now only *reports* what it did.
    ref.listen<SearchRun?>(activeSearchRunControllerProvider, (previous, next) {
      if (next == null) return;
      if (previous?.status != SearchRunStatus.running) return;
      if (!next.status.isFinished) return;
      unawaited(runFor(next));
    });

    // Whatever a sync pull brought in — a teammate's finds most of all, which
    // no run on this machine will ever sweep. The same revision the
    // announcer in `sync_providers.dart` turns into a data-change bump;
    // listened to directly rather than through that bump because the bump
    // also fires for this runner's own tagging, and a sweep that re-runs on
    // its own writes is a scan for nothing.
    var lastRevision = ref.read(syncEngineProvider)?.status.dataRevision;
    ref.listen(syncStatusProvider, (_, next) {
      final after = next.value?.dataRevision;
      if (after == null || after == lastRevision) return;
      lastRevision = after;
      scheduleStandingSweep();
    });

    // A rule that changed — the floor raised, or the whole thing switched
    // on — should reach the roster without waiting for the next pull. This
    // also fires when the persisted rule loads at launch, which is fine: the
    // launch sweep below awaits that load, and the debounce folds the two.
    ref.listen(autoCleanRuleProvider, (_, __) => scheduleStandingSweep());

    // The runs no session ever saw end — see [_catchUpOnLastRun] — and then
    // the roster as a whole, once the rule on disk has actually been read.
    unawaited(_catchUpOnLastRun().then((_) => sweepStanding()));
    return null;
  }

  /// Runs [sweepStanding] after a short quiet period. Safe to call as often
  /// as anything likes; only the last call in a burst does a scan.
  void scheduleStandingSweep() {
    _standingTimer?.cancel();
    _standingTimer = Timer(_standingDelay, () => unawaited(sweepStanding()));
  }

  /// Applies the rule to every untouched channel on the roster — see
  /// [AutoCleanRule.standingRequests] for what that reaches and why.
  ///
  /// Serialised: a call while one is in flight is remembered and run once
  /// after, not started alongside. The two would scan the same rows and
  /// tag the same ids twice — harmless in effect, but two writes and two
  /// outbox entries for one decision.
  ///
  /// Reports into the panel only when it tagged something or failed. A
  /// standing sweep that found nothing to do is the normal case after the
  /// first one, and overwriting a run's report with "0 matched" every few
  /// minutes would bury the sweep somebody is actually looking for.
  Future<AutoCleanReport?> sweepStanding() async {
    if (!ref.mounted) return null;
    if (_standingInFlight) {
      _standingAgain = true;
      return null;
    }
    _standingInFlight = true;
    try {
      await ref.read(autoCleanRuleProvider.notifier).ready;
      // Every `await` here is a gap the session can end in — the app shell
      // that keeps this alive closing, or a test's container being torn down.
      if (!ref.mounted) return null;
      final rule = ref.read(autoCleanRuleProvider);
      if (!rule.enabled) return null;
      final requests = rule.standingRequests();
      if (requests.isEmpty) return null;

      AutoCleanReport? report;
      for (final request in requests) {
        final next = await _apply(request, reason: 'standing');
        if (!ref.mounted) return null;
        report = _merge(report, next);
        if (next.failed) break;
      }
      if (report != null &&
          (report.failed || (report.outcome?.tagged ?? 0) > 0)) {
        state = report;
      }
      return report;
    } finally {
      _standingInFlight = false;
      if (_standingAgain) {
        _standingAgain = false;
        scheduleStandingSweep();
      }
    }
  }

  /// Runs the rule against [run], or does nothing and returns null.
  ///
  /// Does nothing when the rule is off or bounded by nothing, when the run has
  /// not ended, or when it found no channels — in the last case there is
  /// provably nothing in the window, and a sweep that runs anyway is a
  /// destructive call made for no reason.
  ///
  /// **Any ended run, not only a clean one.** This used to require
  /// [SearchRunStatus.completed], and in practice that meant the rule almost
  /// never ran: a discovery run is long, and the ordinary way one ends is
  /// somebody pressing Stop or closing the app — which is `stopped`, or the
  /// `interrupted` a killed process' row is reconciled to. Those runs found
  /// channels; a rule that silently declines to filter them is a rule that
  /// does not work, which is exactly what was reported.
  ///
  /// Widening it costs nothing in safety, because the safety was never in the
  /// status. `firstSeenAfter` pins the sweep to this run's own discovery
  /// window, so a run that fell over having found nothing matches nothing —
  /// and the bounds, the 7-day countdown and the RPC's deal/outreach guards
  /// are all unchanged.
  Future<AutoCleanReport?> runFor(SearchRun run) async {
    final rule = ref.read(autoCleanRuleProvider);
    if (!rule.enabled) return null;
    if (!run.status.isFinished) return null;
    if (run.channelsFound <= 0) return null;

    // A keep-band rejects what is outside it, which is up to two calls; the
    // average-views rule is a third. Applied one after another, their outcomes
    // summed into the single report the panel shows.
    final requests = rule.requestsFor(run.startedAt);
    if (requests.isEmpty) return null;

    AutoCleanReport? report;
    for (final request in requests) {
      final next = await _apply(request);
      report = _merge(report, next);
      if (next.failed) break;
    }
    state = report;
    // Recorded whether or not it succeeded. A failed sweep that is retried on
    // every launch is a destructive call repeating itself unattended against a
    // window nobody is re-reading; the panel shows the failure, and the Archive
    // page's bulk clean is the deliberate way to try again.
    unawaited(_recordSwept(run.startedAt));
    return report;
  }

  /// Folds one more call's outcome into the running report. A failure anywhere
  /// wins — a partial sweep that also reported an error is an error.
  AutoCleanReport _merge(AutoCleanReport? soFar, AutoCleanReport next) {
    final a = soFar?.outcome;
    final b = next.outcome;
    if (soFar == null) return next;
    if (next.failed || a == null || b == null) {
      return AutoCleanReport(
        at: next.at,
        outcome: next.failed ? null : (b ?? a),
        error: next.error ?? soFar.error,
      );
    }
    return AutoCleanReport(
      at: next.at,
      outcome: BulkRejectionOutcome(
        matched: a.matched + b.matched,
        tagged: a.tagged + b.tagged,
        archived: a.archived + b.archived,
        skippedAlreadyTagged: a.skippedAlreadyTagged + b.skippedAlreadyTagged,
        skippedProtected: a.skippedProtected + b.skippedProtected,
        skippedUnknownSize: a.skippedUnknownSize + b.skippedUnknownSize,
      ),
    );
  }

  /// Sweeps the last run this machine did, if the app never got to see it end.
  ///
  /// The live listener above only fires on a `running` → finished transition
  /// that this session actually witnessed. A run whose process is killed with
  /// the app — the app closed mid-run, a crash, the machine shutting down —
  /// produces no such transition in any session: not in the one that died, and
  /// not in the next one, which starts with no live run at all. Its channels
  /// were therefore never swept, and nothing would ever sweep them.
  ///
  /// So on launch, ask the local `runs` table what the last run was. Combined
  /// with `store.reconcile_stale_runs` — which closes out a row whose process
  /// is gone — a killed run reads back here as ended, and gets the sweep it
  /// missed.
  ///
  /// One caveat, stated rather than papered over: the sweep matches
  /// `first_seen_at` on the *server*, so a channel the run found but never
  /// managed to push is outside what this can reach. The pipeline pushes after
  /// every keyword, so that is the tail of one keyword at worst — and the
  /// Archive page's bulk clean is the deliberate way to catch it.
  Future<void> _catchUpOnLastRun() async {
    // The rule on disk, not the built-in default `state` starts as — see
    // [AutoCleanRuleNotifier.ready].
    await ref.read(autoCleanRuleProvider.notifier).ready;
    if (!ref.mounted) return;
    if (!ref.read(autoCleanRuleProvider).enabled) return;

    final SearchRun? run;
    try {
      run = await ref.read(searchRepositoryProvider).getCurrentRun();
    } catch (_) {
      // No local pipeline on this platform, or an unreadable database. There is
      // simply nothing to catch up on.
      return;
    }
    if (run == null || !run.status.isFinished || run.channelsFound <= 0) return;

    final swept = await _lastSwept();
    if (swept != null && !run.startedAt.isAfter(swept)) return;
    if (!ref.mounted) return;

    await runFor(run);
  }

  Future<DateTime?> _lastSwept() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_sweptThroughKey);
      return saved == null ? null : DateTime.tryParse(saved);
    } catch (_) {
      // Unreadable: treated as "never swept". The window and the bounds still
      // apply, so the worst case is one repeat of a sweep that is idempotent —
      // a channel already carrying the tag is skipped by the RPC.
      return null;
    }
  }

  Future<void> _recordSwept(DateTime startedAt) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _sweptThroughKey,
        startedAt.toUtc().toIso8601String(),
      );
    } catch (error, stackTrace) {
      developer.log(
        'Could not record which run the auto-clean has swept through.',
        name: 'gratovo.search',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  /// [reason] is for the log only: `run` for a finished run's own window,
  /// `standing` for the roster-wide sweep.
  Future<AutoCleanReport> _apply(
    BulkRejectionRequest request, {
    String reason = 'run',
  }) async {
    // The unattended caller, so the log matters more here than anywhere: this
    // runs when a search finishes, reports into a card somebody may never open,
    // and never throws. Without a line on disk, an auto-clean that has been
    // failing for a fortnight looks exactly like one that had nothing to do.
    ref.logOperation(
      'autoClean.apply',
      reason == 'standing'
          ? 'Applying the auto-clean rule to the whole roster.'
          : 'Applying the auto-clean rule to a finished run.',
      fields: {
        'reason': reason,
        'untouchedOnly': request.untouchedOnly,
        'immediate': request.immediate,
        'label': request.label.wire,
        'minSubs': request.minSubscribers,
        'maxSubs': request.maxSubscribers,
        'minMedianViews': request.minMedianViews,
        'maxMedianViews': request.maxMedianViews,
        'minVideos30': request.minVideosLast30,
        'firstSeenAfter': request.firstSeenAfter?.toUtc().toIso8601String(),
      },
    );
    try {
      final outcome = await ref
          .read(archiveRepositoryProvider)
          .bulkReject(request, dryRun: false);
      // Tagging a channel rejected is a channel change, and the countdown it
      // starts is what the Archive page reads. Both, for the same reason the
      // dialog's callers bump both — and only when something was written:
      // the standing sweep runs after every pull, and a bump for a sweep that
      // matched nothing would have every list on every tab re-read for no
      // change.
      if (outcome.tagged > 0) {
        ref.bumpData(const {DataDomain.archive, DataDomain.channels});
      }
      ref.logOperation(
        'autoClean.apply.done',
        'The auto-clean rule finished.',
        fields: {
          'matched': outcome.matched,
          'tagged': outcome.tagged,
          'archived': outcome.archived,
          'skippedTagged': outcome.skippedAlreadyTagged,
          'skippedProtected': outcome.skippedProtected,
          'skippedUnknown': outcome.skippedUnknownSize,
        },
      );
      return AutoCleanReport(at: DateTime.now(), outcome: outcome);
    } catch (error, stackTrace) {
      ref.logOperation(
        'autoClean.apply.failed',
        'The auto-clean rule did not run.',
        level: SyncLogLevel.error,
        error: error,
        stackTrace: stackTrace,
      );
      // Reported, never rethrown. This is a side effect of a search finishing,
      // and a failure here must not read to the user as the search failing.
      return AutoCleanReport(at: DateTime.now(), outcome: null, error: error);
    }
  }
}

final autoCleanRunnerProvider =
    NotifierProvider<AutoCleanRunner, AutoCleanReport?>(AutoCleanRunner.new);
