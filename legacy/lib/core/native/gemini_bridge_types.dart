/// The platform-independent half of the Gemini bridge — no `dart:io` here,
/// so it compiles on web and is what `gemini_bridge_io.dart` and
/// `gemini_bridge_stub.dart` both build on, the way `scraper_process_types.dart`
/// underlies the two `ScraperProcess`es.
///
/// Three things live here: the bridge's [GeminiBridgeState], the abstract
/// [GeminiBridge] with every typed helper already written in terms of the one
/// raw [GeminiBridge.call], and the per-machine [GeminiBridgeSettings]. The
/// helpers are here rather than on the io class so a test's fake bridge gets
/// them for free by scripting `call` alone — and so the method names and
/// parameter keys the Python side must answer to are spelled out in exactly
/// one file.
library;

import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/gemini_protocol.dart';
import 'package:shared_preferences/shared_preferences.dart';

export 'package:gratovo_toolbox/core/native/gemini_protocol.dart';

/// Where the daemon is in its life.
enum GeminiBridgePhase {
  /// Not started, or stopped on request.
  stopped,

  /// The process is being spawned and its first line awaited — or a restart
  /// after a crash is counting down.
  starting,

  /// The daemon is up and listening on its port; no extension has connected.
  listening,

  /// The extension is connected. [GeminiBridgeState.status] carries the last
  /// `bridge.status` seen.
  connected,

  /// The daemon could not be started, or died too many times.
  /// [GeminiBridgeState.message] says why.
  failed,
}

/// The bridge's state as the UI reads it: a phase, and what goes with it.
class GeminiBridgeState {
  const GeminiBridgeState._(
    this.phase, {
    this.port,
    this.status,
    this.message,
  });

  const GeminiBridgeState.stopped() : this._(GeminiBridgePhase.stopped);
  const GeminiBridgeState.starting() : this._(GeminiBridgePhase.starting);
  const GeminiBridgeState.listening({int? port})
      : this._(GeminiBridgePhase.listening, port: port);
  GeminiBridgeState.connected(GeminiBridgeStatus status)
      : this._(GeminiBridgePhase.connected, status: status, port: status.port);
  const GeminiBridgeState.failed(String message)
      : this._(GeminiBridgePhase.failed, message: message);

  final GeminiBridgePhase phase;
  final int? port;

  /// The last `bridge.status` while [GeminiBridgePhase.connected]; null
  /// otherwise.
  final GeminiBridgeStatus? status;

  /// Why, for [GeminiBridgePhase.failed].
  final String? message;

  bool get isStopped => phase == GeminiBridgePhase.stopped;
  bool get isStarting => phase == GeminiBridgePhase.starting;
  bool get isListening => phase == GeminiBridgePhase.listening;
  bool get isConnected => phase == GeminiBridgePhase.connected;
  bool get isFailed => phase == GeminiBridgePhase.failed;

  /// The daemon process is alive, extension or not.
  bool get isUp => isListening || isConnected;

  /// The signed-in account, when the extension has reported one.
  GeminiAccount? get account => status?.status?.account;

  /// The model on the switcher, when the extension has reported one.
  String? get modelName => status?.status?.modelName;

  /// The same phase with a fresher status object — what a `status` event
  /// updates without changing anything else.
  GeminiBridgeState withStatus(GeminiBridgeStatus status) =>
      GeminiBridgeState.connected(status);

  @override
  String toString() =>
      'GeminiBridgeState(${phase.name}${message == null ? '' : ': $message'})';
}

/// The long-lived Gemini daemon, as every caller sees it.
///
/// One instance per app, held by `geminiBridgeProvider`. It starts lazily —
/// the first [call] spawns the process — so an app that never drafts with
/// Gemini never pays for a Python interpreter, and the web build (which gets
/// the stub) never tries.
///
/// The typed helpers below are the app's whole vocabulary with the daemon:
/// every method name and parameter key the Python side has to answer to is
/// spelled here and nowhere else.
abstract class GeminiBridge {
  /// Whether this platform can run the daemon at all. False on the stub.
  bool get isAvailable;

  GeminiBridgeState get state;

  /// Every state change, as a broadcast stream. The current value is [state].
  Stream<GeminiBridgeState> get stateChanges;

  /// Every event the daemon forwards (`hello`, `job`, `status`, `log`) plus its
  /// own `daemon` events.
  Stream<GeminiEvent> get events;

  /// The absolute path of `pipeline/gemini_extension` on this machine — what
  /// somebody types into `chrome://extensions` → Load unpacked. Null where
  /// there is no pipeline folder to point at.
  String? get extensionDir;

  /// Starts the daemon if it is not running. Resolves once the daemon has
  /// printed its first `daemon` event, and throws [GeminiBridgeException]
  /// (failure [GeminiFailure.unavailable]) if it could not.
  Future<void> ensureStarted();

  /// One request, correlated by id, answered by the daemon's response.
  ///
  /// Starts the daemon first if needed. Throws [GeminiBridgeException] for an
  /// `ok: false` response, for a daemon that is not running and cannot be
  /// started, and for a call that outlives [timeout].
  Future<Map<String, Object?>> call(
    String method, [
    Map<String, Object?> params = const {},
    Duration? timeout,
  ]);

  /// Sends `bridge.shutdown`, then kills the process if it is still there
  /// three seconds later. Idempotent.
  Future<void> stop();

  /// Everything an action needs before it can run: the daemon up, and — when
  /// Settings names an account that must be signed in — that account
  /// confirmed, once per daemon session.
  Future<void> prepareForAction();

  // ---- proxied / bridge-level -------------------------------------------

  /// `bridge.status` — never throws on the Python side, so a failure here is
  /// the daemon itself being unreachable.
  Future<GeminiBridgeStatus> status() async =>
      GeminiBridgeStatus.fromJson(await call('bridge.status'));

  /// `diagnostics` — proxied to the extension.
  Future<GeminiDiagnostics> diagnostics() async =>
      GeminiDiagnostics.fromJson(await call('diagnostics'));

  /// `bridge.ensure_account` — switches `/u/N/` until [match] (a name or
  /// email substring, case-insensitive) is the signed-in account.
  Future<GeminiAccount> ensureAccount(String match) async {
    final result = await call(
      'bridge.ensure_account',
      {'match': match},
      _accountTimeout,
    );
    return GeminiAccount.fromJson(result) ?? const GeminiAccount();
  }

  /// `bridge.heal` — applies suggestion [pick] from the diagnostics for
  /// [element] as a new first selector override.
  Future<GeminiHealResult> heal(String element, {int pick = 0}) async =>
      GeminiHealResult.fromJson(
        await call('bridge.heal', {'element': element, 'pick': pick}),
      );

  /// `open` — brings up a Gemini tab (reusing one if it exists).
  Future<Map<String, Object?>> openGemini({String? url, bool focus = true}) =>
      call('open', {
        if (url != null && url.isNotEmpty) 'url': url,
        'focus': focus,
      });

  /// `queue_list`.
  Future<List<GeminiJob>> queueList() async {
    final result = await call('queue_list');
    return [
      for (final raw in asList(result['jobs']))
        if (raw is Map) GeminiJob.fromJson(raw.cast<String, Object?>()),
    ];
  }

  /// `queue_add`.
  Future<GeminiJob> queueAdd(
    String prompt, {
    bool newChat = true,
    String? model,
    Map<String, Object?> meta = const {},
  }) async =>
      GeminiJob.fromJson(await call('queue_add', {
        'prompt': prompt,
        'newChat': newChat,
        if (model != null && model.isNotEmpty) 'model': model,
        if (meta.isNotEmpty) 'meta': meta,
      }));

  /// `queue_cancel`.
  Future<GeminiJob> queueCancel(String jobId) async =>
      GeminiJob.fromJson(await call('queue_cancel', {'jobId': jobId}));

  // ---- browser, window and add-on (bridge.*) -----------------------------
  //
  // None of these prepares an account: they are what makes an extension
  // connection exist in the first place, and `prepareForAction` needs one.

  /// `bridge.browser_info` — which browsers are here, which is selected, and
  /// what state the add-on is in. The daemon never fails it: trouble is in the
  /// add-on's message and the per-browser fields.
  ///
  /// [browser], [browserPath] and [profileMode] are Settings' values; every
  /// browser call carries them, so a change applies at once without
  /// restarting the daemon. Null leaves the daemon's default.
  Future<GeminiBrowserInfo> browserInfo({
    GeminiBrowserKind? browser,
    String? browserPath,
    GeminiProfileMode? profileMode,
  }) async =>
      GeminiBrowserInfo.fromJson(await call(
        'bridge.browser_info',
        _browserParams(browser, browserPath, profileMode),
        _browserInfoTimeout,
      ));

  /// The browser settings as call params; absent keys mean "daemon default".
  static Map<String, Object?> _browserParams(
    GeminiBrowserKind? browser,
    String? browserPath,
    GeminiProfileMode? profileMode,
  ) =>
      {
        if (browser != null) 'browser': browser.wire,
        if (browserPath != null && browserPath.trim().isNotEmpty)
          'browserPath': browserPath.trim(),
        if (profileMode != null) 'profileMode': profileMode.wire,
      };

  /// `bridge.ensure_window` — makes "the extension is connected and a Gemini
  /// tab exists" true, launching [browser] and installing the add-on as
  /// needed; idempotent. [browser] null means the daemon's own selection.
  /// [focus] brings the window to the front (to sign in), which a background
  /// launch must not do.
  ///
  /// Not being able to get there is not an exception: read
  /// [GeminiWindowResult.connected], [GeminiWindowResult.steps] and
  /// [GeminiWindowResult.message]. [timeout] is the daemon's own budget; this
  /// side waits [_ensureWindowGrace] longer so the daemon's answer, which says
  /// which step stalled, arrives before this side gives up.
  Future<GeminiWindowResult> ensureWindow({
    GeminiBrowserKind? browser,
    bool focus = false,
    Duration timeout = const Duration(seconds: 45),
    String? url,
    String? browserPath,
    GeminiProfileMode? profileMode,
  }) async {
    final timeoutS = timeout.inSeconds < 1 ? 1 : timeout.inSeconds;
    return GeminiWindowResult.fromJson(await call(
      'bridge.ensure_window',
      {
        ..._browserParams(browser, browserPath, profileMode),
        'focus': focus,
        'timeoutS': timeoutS,
        if (url != null && url.trim().isNotEmpty) 'url': url.trim(),
      },
      Duration(seconds: timeoutS) + _ensureWindowGrace,
    ));
  }

  /// `bridge.install_addon` — gets the add-on into [browser] (the daemon's
  /// own selection when null) by the best method [mode] allows, or updates it;
  /// [force] reinstalls even when it looks current. Failures that are the
  /// browser's doing (`ADDON_UNSIGNED`, `ADDON_INSTALL_FAILED`) arrive as a
  /// [GeminiBridgeException].
  Future<GeminiAddonStatus> installAddon({
    GeminiBrowserKind? browser,
    GeminiAddonMode mode = GeminiAddonMode.auto,
    bool force = false,
    String? browserPath,
    GeminiProfileMode? profileMode,
  }) async =>
      GeminiAddonStatus.fromJson(await call(
        'bridge.install_addon',
        {
          ..._browserParams(browser, browserPath, profileMode),
          'mode': mode.wire,
          'force': force,
        },
        _installAddonTimeout,
      ));

  // ---- actions (prompts live in Python) ----------------------------------

  /// `action.gem_create` — makes a new gem in the signed-in account and
  /// returns where it is. [model] is selected for it when given.
  Future<GemResult> createGem({
    required String name,
    required String description,
    required String instructions,
    String? model,
    int timeoutS = _gemTimeoutS,
  }) async {
    await prepareForAction();
    return GemResult.fromJson(await call(
      'action.gem_create',
      {
        'name': name,
        'description': description,
        'instructions': instructions,
        if (model != null && model.trim().isNotEmpty) 'model': model.trim(),
        'timeoutS': timeoutS,
      },
      _gemDeadline(timeoutS),
    ));
  }

  /// `action.gem_update` — changes the given fields of [gem] (its URL or id)
  /// and leaves the others alone; [GemResult.changed] says which took.
  Future<GemResult> updateGem(
    String gem, {
    String? name,
    String? description,
    String? instructions,
    int timeoutS = _gemTimeoutS,
  }) async {
    await prepareForAction();
    return GemResult.fromJson(await call(
      'action.gem_update',
      {
        'gem': gem.trim(),
        if (name != null) 'name': name,
        if (description != null) 'description': description,
        if (instructions != null) 'instructions': instructions,
        'timeoutS': timeoutS,
      },
      _gemDeadline(timeoutS),
    ));
  }

  /// `action.gem_read` — [gem] (URL or id) as its editor shows it.
  Future<GemDetails> readGem(
    String gem, {
    int timeoutS = _gemReadTimeoutS,
  }) async {
    await prepareForAction();
    return GemDetails.fromJson(await call(
      'action.gem_read',
      {'gem': gem.trim(), 'timeoutS': timeoutS},
      _gemDeadline(timeoutS),
    ));
  }

  /// `action.generate_keywords` — one keyword per line from Gemini, deduped
  /// against [avoid] on the Python side as well as here.
  ///
  /// With [chats] above 1 the request is split across that many separate new
  /// chats, each asked for [perChat] keywords under its own one of [angles]
  /// and told what the earlier ones found. Then [timeoutS] is the allowance
  /// for EACH chat, and progress arrives as `progress` events on
  /// [GeminiBridge.events]. Some chats failing is [KeywordsResult.partial],
  /// not an exception; all of them failing throws.
  Future<KeywordsResult> generateKeywords({
    required String topic,
    int count = 100,
    List<String> exclusions = const [],
    List<String> styles = const [],
    String? language,
    List<String> avoid = const [],
    String? notes,
    String? gem,
    String? model,
    bool newChat = true,
    int timeoutS = _actionTimeoutS,
    int? chats,
    int? perChat,
    List<String> angles = const [],
  }) async {
    await prepareForAction();
    final chatCount = chats == null || chats < 1 ? 1 : chats;
    return KeywordsResult.fromJson(await call(
      'action.generate_keywords',
      {
        'topic': topic,
        'count': count,
        if (exclusions.isNotEmpty) 'exclusions': exclusions,
        if (styles.isNotEmpty) 'styles': styles,
        if (language != null && language.isNotEmpty) 'language': language,
        if (avoid.isNotEmpty) 'avoid': avoid,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
        if (chats != null) 'chats': chats,
        if (perChat != null) 'perChat': perChat,
        if (angles.isNotEmpty) 'angles': angles,
        ..._actionOptions(gem: gem, model: model, newChat: newChat),
        'timeoutS': timeoutS,
      },
      // The chats run one after another in the one Gemini tab.
      _actionDeadline(timeoutS * chatCount),
    ));
  }

  /// `action.classify_channel`.
  Future<ClassifyResult> classifyChannel({
    required Map<String, Object?> channel,
    required String niche,
    List<String> criteria = const [],
    String? gem,
    String? model,
    bool newChat = true,
    int timeoutS = _actionTimeoutS,
  }) async {
    await prepareForAction();
    return ClassifyResult.fromJson(await call(
      'action.classify_channel',
      {
        'channel': channel,
        'niche': niche,
        if (criteria.isNotEmpty) 'criteria': criteria,
        ..._actionOptions(gem: gem, model: model, newChat: newChat),
        'timeoutS': timeoutS,
      },
      _actionDeadline(timeoutS),
    ));
  }

  /// The optional params every Gemini-calling action shares (DAEMON.md §3):
  /// only the ones with a value, so the daemon's own defaults apply.
  static Map<String, Object?> _actionOptions({
    String? gem,
    String? model,
    required bool newChat,
  }) =>
      {
        if (gem != null && gem.trim().isNotEmpty) 'gem': gem.trim(),
        if (model != null && model.trim().isNotEmpty) 'model': model.trim(),
        'newChat': newChat,
      };

  /// The daemon's own default for `timeoutS`.
  static const _actionTimeoutS = 240;

  /// An action's own timeout plus room for the daemon to open a gem, set a
  /// model, and parse the reply — so the daemon's `TIMEOUT` (which names the
  /// phase that stalled) arrives before this side gives up on it.
  static Duration _actionDeadline(int timeoutS) =>
      Duration(seconds: timeoutS + 60);

  /// `ensure_account` may walk ten `/u/N/` URLs, each a page load.
  static const _accountTimeout = Duration(minutes: 3);

  /// `browser_info` only looks (registry, files, a version string).
  static const _browserInfoTimeout = Duration(seconds: 30);

  /// `install_addon` may start a browser, wait for it, and talk to it.
  static const _installAddonTimeout = Duration(seconds: 120);

  /// Room for the daemon's answer to `ensure_window` (which names the step
  /// that stalled) to beat this side's own clock.
  static const _ensureWindowGrace = Duration(seconds: 30);

  /// A gem is a form filled in on a page and saved: creating or changing one
  /// gets as long as a draft, reading one is a page load.
  static const _gemTimeoutS = 180;
  static const _gemReadTimeoutS = 90;
  static Duration _gemDeadline(int timeoutS) =>
      Duration(seconds: timeoutS + 60);
}

// ---- settings ----------------------------------------------------------------

const _portKey = 'gratovo.gemini.port';
const _accountMatchKey = 'gratovo.gemini.accountMatch';
const _defaultModelKey = 'gratovo.gemini.defaultModel';
const _browserKey = 'gratovo.gemini.browser';
const _browserPathKey = 'gratovo.gemini.browserPath';
const _profileModeKey = 'gratovo.gemini.profileMode';
const _autoStartKey = 'gratovo.gemini.autoStart';
const _autoOpenWindowKey = 'gratovo.gemini.autoOpenWindow';
const _keywordsGemKey = 'gratovo.gemini.keywordsGem';
const _keywordChatsKey = 'gratovo.gemini.keywordChats';
const _keywordsPerChatKey = 'gratovo.gemini.keywordsPerChat';
const _lastAccountNameKey = 'gratovo.gemini.lastAccountName';
const _lastAccountEmailKey = 'gratovo.gemini.lastAccountEmail';
const _lastAccountIndexKey = 'gratovo.gemini.lastAccountIndex';

/// Keys an older build wrote and this one no longer reads: the drafter and QA
/// gems went with the old drafting path (decision old-files). Removed on the
/// next save so they do not linger on disk.
const _retiredKeys = ['gratovo.gemini.drafterGem', 'gratovo.gemini.qaGem'];

/// How this machine's Gemini bridge is set up — per device, in
/// `shared_preferences`, the same way `PythonEnvironmentSettings` is and for
/// the same reason: which Google account is signed into which Chrome profile
/// is a fact about one person's machine, not a team setting.
class GeminiBridgeSettings {
  /// Matched case-insensitively as a substring of the menu label ("3.1 Pro").
  /// Pro by default because the skill prompts are long, and on the live page
  /// (2026-09) Flash answered one with a blanket refusal while Pro drafted
  /// cleanly.
  static const defaultModelName = 'Pro';

  const GeminiBridgeSettings({
    this.port = defaultPort,
    this.accountMatch = '',
    this.defaultModel = defaultModelName,
    this.browser = GeminiBrowserKind.firefox,
    this.browserPath = '',
    this.profileMode = GeminiProfileMode.managed,
    this.autoStart = true,
    this.autoOpenWindow = true,
    this.keywordsGem = '',
    this.keywordChats = defaultKeywordChats,
    this.keywordsPerChat = defaultKeywordsPerChat,
    this.lastAccountName = '',
    this.lastAccountEmail = '',
    this.lastAccountIndex,
  });

  /// The port the daemon listens on and the extension's popup is set to.
  static const defaultPort = 8765;

  /// Chats per multi-chat keyword batch, and the most `action.generate_keywords`
  /// accepts (DAEMON.md: `chats` is 1–8).
  static const defaultKeywordChats = 4;
  static const maxKeywordChats = 8;

  /// Keywords asked of each chat of a batch.
  static const defaultKeywordsPerChat = 25;

  final int port;

  /// A name or email substring the signed-in Google account must match
  /// before any action runs; blank means any account will do.
  final String accountMatch;

  /// The model to select before every action, e.g. `Pro`. Blank leaves the
  /// switcher as it is.
  final String defaultModel;

  /// The browser Gemini is opened in. Firefox by default: it is the fastest
  /// of the three at taking the long prompts the actions paste in, and the
  /// only one whose add-on the app can install without a click in the
  /// browser's own UI.
  final GeminiBrowserKind browser;

  /// The browser's executable. Blank means "find it".
  final String browserPath;

  /// [GeminiProfileMode.managed] is a dedicated profile the app owns, so
  /// nothing of the person's own browsing is touched; [GeminiProfileMode.existing]
  /// uses the browser's default profile, and only while that browser is not
  /// already running.
  final GeminiProfileMode profileMode;

  /// Start the daemon when the app launches, instead of on first use.
  final bool autoStart;

  /// When no Gemini window is connected, open one — at launch and before any
  /// Gemini action — instead of failing with "extension not connected".
  final bool autoOpenWindow;

  /// The keyword generator's gem (URL or id). Blank means "plain chat, with
  /// the skill file prepended by the daemon".
  final String keywordsGem;

  /// How many separate new chats one keyword batch is split across…
  final int keywordChats;

  /// …and how many keywords each of them is asked for.
  final int keywordsPerChat;

  /// The Google account last seen signed in — learned from the connection,
  /// never typed, so the card can still say who Gemini belongs to while the
  /// browser is closed. Blank / null until one has been seen.
  final String lastAccountName;
  final String lastAccountEmail;

  /// That account's `/u/N/` slot, when the page reported one.
  final int? lastAccountIndex;

  bool get hasAccountMatch => accountMatch.trim().isNotEmpty;
  bool get hasKeywordsGem => keywordsGem.trim().isNotEmpty;

  /// Null rather than blank, so it slots straight into an action's optional
  /// `gem`/`model` params.
  String? get keywordsGemOrNull => _orNull(keywordsGem);
  String? get defaultModelOrNull => _orNull(defaultModel);

  static String? _orNull(String value) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  /// [lastAccountIndex] cannot be cleared by passing null (that means "keep
  /// it"), so [clearLastAccountIndex] says "forget it".
  GeminiBridgeSettings copyWith({
    int? port,
    String? accountMatch,
    String? defaultModel,
    GeminiBrowserKind? browser,
    String? browserPath,
    GeminiProfileMode? profileMode,
    bool? autoStart,
    bool? autoOpenWindow,
    String? keywordsGem,
    int? keywordChats,
    int? keywordsPerChat,
    String? lastAccountName,
    String? lastAccountEmail,
    int? lastAccountIndex,
    bool clearLastAccountIndex = false,
  }) =>
      GeminiBridgeSettings(
        port: port ?? this.port,
        accountMatch: accountMatch ?? this.accountMatch,
        defaultModel: defaultModel ?? this.defaultModel,
        browser: browser ?? this.browser,
        browserPath: browserPath ?? this.browserPath,
        profileMode: profileMode ?? this.profileMode,
        autoStart: autoStart ?? this.autoStart,
        autoOpenWindow: autoOpenWindow ?? this.autoOpenWindow,
        keywordsGem: keywordsGem ?? this.keywordsGem,
        keywordChats: keywordChats ?? this.keywordChats,
        keywordsPerChat: keywordsPerChat ?? this.keywordsPerChat,
        lastAccountName: lastAccountName ?? this.lastAccountName,
        lastAccountEmail: lastAccountEmail ?? this.lastAccountEmail,
        lastAccountIndex: clearLastAccountIndex
            ? null
            : lastAccountIndex ?? this.lastAccountIndex,
      );

  /// The settings as `shared_preferences` holds them. Every key is read on its
  /// own and a value of the wrong type counts as absent: one corrupted entry
  /// must cost that setting its default, not every setting theirs.
  static GeminiBridgeSettings fromPrefs(SharedPreferences prefs) {
    T? read<T>(String key) {
      try {
        final value = prefs.get(key);
        return value is T ? value : null;
      } catch (_) {
        return null;
      }
    }

    return GeminiBridgeSettings(
      port: read<int>(_portKey) ?? defaultPort,
      accountMatch: read<String>(_accountMatchKey) ?? '',
      // Only an ABSENT key falls back to Pro; a blank the person saved on
      // purpose ("leave the switcher alone") stays blank.
      defaultModel: read<String>(_defaultModelKey) ?? defaultModelName,
      browser: GeminiBrowserKind.fromWire(read<String>(_browserKey)),
      browserPath: read<String>(_browserPathKey) ?? '',
      profileMode: GeminiProfileMode.fromWire(read<String>(_profileModeKey)),
      autoStart: read<bool>(_autoStartKey) ?? true,
      autoOpenWindow: read<bool>(_autoOpenWindowKey) ?? true,
      keywordsGem: read<String>(_keywordsGemKey) ?? '',
      keywordChats: (read<int>(_keywordChatsKey) ?? defaultKeywordChats)
          .clamp(1, maxKeywordChats),
      keywordsPerChat:
          _positive(read<int>(_keywordsPerChatKey)) ?? defaultKeywordsPerChat,
      lastAccountName: read<String>(_lastAccountNameKey) ?? '',
      lastAccountEmail: read<String>(_lastAccountEmailKey) ?? '',
      lastAccountIndex: read<int>(_lastAccountIndexKey),
    );
  }

  static int? _positive(int? value) =>
      value != null && value > 0 ? value : null;

  Future<void> _writeTo(SharedPreferences prefs) async {
    await prefs.setInt(_portKey, port);
    await prefs.setString(_accountMatchKey, accountMatch);
    for (final key in _retiredKeys) {
      await prefs.remove(key);
    }
    await prefs.setString(_defaultModelKey, defaultModel);
    await prefs.setString(_browserKey, browser.wire);
    await prefs.setString(_browserPathKey, browserPath);
    await prefs.setString(_profileModeKey, profileMode.wire);
    await prefs.setBool(_autoStartKey, autoStart);
    await prefs.setBool(_autoOpenWindowKey, autoOpenWindow);
    await prefs.setString(_keywordsGemKey, keywordsGem);
    await prefs.setInt(_keywordChatsKey, keywordChats);
    await prefs.setInt(_keywordsPerChatKey, keywordsPerChat);
    await prefs.setString(_lastAccountNameKey, lastAccountName);
    await prefs.setString(_lastAccountEmailKey, lastAccountEmail);
    final index = lastAccountIndex;
    if (index == null) {
      await prefs.remove(_lastAccountIndexKey);
    } else {
      await prefs.setInt(_lastAccountIndexKey, index);
    }
  }
}

/// Holds [GeminiBridgeSettings] and keeps them in `shared_preferences`.
///
/// `build()` has to return the defaults at once — the provider is read
/// synchronously all over the UI — and loads the saved values a moment later.
/// That gap used to be a data-loss window: anything that called [update] in it
/// (a card built from the defaults it saw first, a boot task saving a learned
/// account) persisted defaults over the saved values, and the late load then
/// overwrote whatever [update] had just set. Every write here therefore waits
/// for the load first ([ready]), and [edit] applies a change to what was
/// LOADED rather than to whatever the caller happened to hold.
class GeminiBridgeSettingsNotifier extends Notifier<GeminiBridgeSettings> {
  /// The load [build] started; already complete for a notifier whose `build`
  /// was replaced (tests override it), so nothing waits on a load that never
  /// runs.
  Future<void> _ready = Future<void>.value();
  bool _loaded = true;

  /// Bumped when a build ends (dispose or rebuild): a load or write left over
  /// from an earlier build must not touch this one's state.
  int _epoch = 0;
  bool _disposed = false;

  /// Writes are chained so two edits in quick succession land on disk in the
  /// order they were made — the later one wins on every key.
  Future<void> _writes = Future<void>.value();

  @override
  GeminiBridgeSettings build() {
    _disposed = false;
    _loaded = false;
    final epoch = _epoch;
    ref.onDispose(() {
      _epoch++;
      _disposed = true;
    });
    _ready = _loadPersisted(epoch);
    return const GeminiBridgeSettings();
  }

  /// Completes once the saved values are in [state] (or could not be read, in
  /// which case the defaults stay and a warning is logged). Never fails.
  Future<void> get ready => _settled();

  Future<void> _settled() async {
    // A rebuild while waiting starts a newer load; wait for that one too.
    Future<void> waited;
    do {
      waited = _ready;
      await waited;
    } while (!identical(waited, _ready));
  }

  Future<void> _loadPersisted(int epoch) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (epoch != _epoch) return;
      state = GeminiBridgeSettings.fromPrefs(prefs);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to load persisted Gemini bridge settings; keeping defaults.',
        name: 'gratovo.gemini.settings',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    } finally {
      if (epoch == _epoch) _loaded = true;
    }
  }

  /// Replaces the settings. Waits for the saved values to load first, so the
  /// load cannot land on top of this and undo it — but [settings] is taken as
  /// given: a caller that built it from a stale copy writes that copy. Use
  /// [edit] when only some fields are being changed.
  Future<void> update(GeminiBridgeSettings settings) async {
    // Once loaded this stays synchronous, as it always was: the state moves
    // before the first await, for a caller that does not await it.
    if (!_loaded) await _settled();
    if (_disposed) return;
    state = settings;
    await _persist(settings);
  }

  /// Applies [change] to the LOADED settings and persists the result — the
  /// safe way to change a field or two from anywhere that might run before
  /// the load finishes (a boot task, a card that has not been rebuilt yet).
  Future<void> edit(
    GeminiBridgeSettings Function(GeminiBridgeSettings current) change,
  ) async {
    if (!_loaded) await _settled();
    if (_disposed) return;
    await update(change(state));
  }

  Future<void> _persist(GeminiBridgeSettings settings) {
    final write = _writes.then((_) => _write(settings));
    _writes = write;
    return write;
  }

  /// Never throws — a failure to save is logged and the in-memory settings
  /// stay, the same as before — so the chain in [_persist] cannot be broken by
  /// one bad write.
  Future<void> _write(GeminiBridgeSettings settings) async {
    try {
      await settings._writeTo(await SharedPreferences.getInstance());
    } catch (error, stackTrace) {
      developer.log(
        'Failed to persist Gemini bridge settings.',
        name: 'gratovo.gemini.settings',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }
}

final geminiBridgeSettingsProvider =
    NotifierProvider<GeminiBridgeSettingsNotifier, GeminiBridgeSettings>(
  GeminiBridgeSettingsNotifier.new,
);

/// Mirrors the bridge's [GeminiBridge.state] into a provider so widgets can
/// `ref.watch` it. Shared by the io and stub providers, which differ only in
/// which bridge they hand it.
class GeminiBridgeStateNotifier extends Notifier<GeminiBridgeState> {
  GeminiBridgeStateNotifier(this._bridgeOf);

  final GeminiBridge Function(Ref ref) _bridgeOf;

  @override
  GeminiBridgeState build() {
    final bridge = _bridgeOf(ref);
    final subscription = bridge.stateChanges.listen((next) => state = next);
    ref.onDispose(subscription.cancel);
    return bridge.state;
  }
}
