/// The JSON contract between `pipeline/gemini_bridge` (the daemon) and this
/// app — `pipeline/gemini_bridge/DAEMON.md` is the authority, and
/// `PROTOCOL.md` §3/§4 for the shapes the daemon proxies from the extension.
///
/// Pure Dart, no `dart:io` — the same split as `gmail_protocol.dart` beside
/// it: the process lives in `gemini_bridge_io.dart`, and everything about what
/// the daemon *said* lives here, so every parse is unit-testable without a
/// Python interpreter or a browser.
///
/// Every result here tolerates a missing or null field. The shapes come out
/// of a browser page that Google redesigns without notice, and a diagnostics
/// object with one unexpected `null` in it is exactly the one somebody needs
/// to read — throwing on it would hide the report about the breakage behind
/// a second breakage.
library;

import 'dart:convert';

/// Why a bridge call failed, in terms the UI can act on.
///
/// The extension's codes (`PROTOCOL.md` §2), the daemon's own (`DAEMON.md`
/// §2), and two of this app's: [unavailable] for an interpreter that never
/// spoke the protocol at all, [unknown] for a code this build has no case for.
enum GeminiFailure {
  // ---- the extension's (PROTOCOL.md §2) ----

  /// No `gemini.google.com` tab, and opening one was not possible.
  noTab,

  /// The tab exists but its content script did not answer.
  tabNotReady,

  /// The tab is on a sign-in page or the landing page.
  signedOut,

  /// None of the locator strategies matched — the self-healing case, and the
  /// one the Diagnostics panel exists for.
  elementNotFound,

  /// The page itself is showing an error (a toast, "Something went wrong", a
  /// usage limit).
  geminiError,

  /// Gemini is still generating and the call did not ask to interrupt.
  busy,
  timeout,
  sendNotAccepted,
  typeFailed,
  modelNotFound,
  badParams,
  internal,

  // ---- the daemon's (DAEMON.md §2) ----

  /// The daemon is up but no extension is connected to it.
  extensionNotConnected,

  /// `bridge.ensure_account` walked `/u/0..9` without a match.
  accountNotFound,

  /// `bridge.heal` had nothing to apply.
  noSuggestion,

  /// Gemini answered but the reply could not be parsed into the action's
  /// result shape.
  actionParseFailed,

  /// Gemini answered with its generic refusal ("I'm having a hard time
  /// fulfilling your request") twice in a row — a long skill prompt on a
  /// small model, usually; a gem or the Pro model takes it.
  actionRefused,

  /// An action needed a skill file from `data/gemini skills/` that is absent.
  skillFileMissing,

  // ---- the daemon's, added with the browser and gem work (DAEMON.md §2) ----

  /// The configured browser is not installed, or its path is not a browser.
  browserNotFound,

  /// Release Firefox refuses an unsigned permanent add-on, and no temporary
  /// install was possible either.
  addonUnsigned,

  /// Installing or updating the add-on failed.
  addonInstallFailed,

  /// The browser process did not start, or exited straight away.
  browserLaunchFailed,

  /// An element of the gem editor could not be found — the self-healing case
  /// again, for the gem pages: the details are the standard element
  /// diagnostics.
  gemUiNotFound,

  /// The gem editor did not accept the save.
  gemSaveFailed,

  /// The daemon has the method registered but no implementation behind it
  /// yet ("not implemented yet").
  notImplemented,

  // ---- this app's ----

  /// The interpreter never produced protocol lines — missing Python, a
  /// missing `pipeline/` folder, an import that blew up before `main()`, or
  /// the stub on a platform with no processes at all.
  unavailable,

  /// Anything reported that this app does not have a case for.
  unknown;

  static GeminiFailure fromCode(String? code) => switch (code) {
        'NO_TAB' => GeminiFailure.noTab,
        'TAB_NOT_READY' => GeminiFailure.tabNotReady,
        'SIGNED_OUT' => GeminiFailure.signedOut,
        'ELEMENT_NOT_FOUND' => GeminiFailure.elementNotFound,
        'GEMINI_ERROR' => GeminiFailure.geminiError,
        'BUSY' => GeminiFailure.busy,
        'TIMEOUT' => GeminiFailure.timeout,
        'SEND_NOT_ACCEPTED' => GeminiFailure.sendNotAccepted,
        'TYPE_FAILED' => GeminiFailure.typeFailed,
        'MODEL_NOT_FOUND' => GeminiFailure.modelNotFound,
        'BAD_PARAMS' => GeminiFailure.badParams,
        'INTERNAL' => GeminiFailure.internal,
        'EXTENSION_NOT_CONNECTED' => GeminiFailure.extensionNotConnected,
        'ACCOUNT_NOT_FOUND' => GeminiFailure.accountNotFound,
        'NO_SUGGESTION' => GeminiFailure.noSuggestion,
        'ACTION_PARSE_FAILED' => GeminiFailure.actionParseFailed,
        'ACTION_REFUSED' => GeminiFailure.actionRefused,
        'SKILL_FILE_MISSING' => GeminiFailure.skillFileMissing,
        'BROWSER_NOT_FOUND' => GeminiFailure.browserNotFound,
        'ADDON_UNSIGNED' => GeminiFailure.addonUnsigned,
        'ADDON_INSTALL_FAILED' => GeminiFailure.addonInstallFailed,
        'BROWSER_LAUNCH_FAILED' => GeminiFailure.browserLaunchFailed,
        'GEM_UI_NOT_FOUND' => GeminiFailure.gemUiNotFound,
        'GEM_SAVE_FAILED' => GeminiFailure.gemSaveFailed,
        'NOT_IMPLEMENTED' => GeminiFailure.notImplemented,
        'UNAVAILABLE' => GeminiFailure.unavailable,
        _ => GeminiFailure.unknown,
      };

  /// Whether the fix lives in Settings → Gemini in browser rather than in
  /// whatever the person was doing: the daemon is not running, the extension
  /// is not loaded, the tab is signed out, the page changed under the
  /// locators. Drives whether a dialog offers "Open Settings" beside the
  /// error.
  bool get isBridgeProblem => switch (this) {
        GeminiFailure.unavailable ||
        GeminiFailure.extensionNotConnected ||
        GeminiFailure.noTab ||
        GeminiFailure.tabNotReady ||
        GeminiFailure.signedOut ||
        GeminiFailure.elementNotFound ||
        GeminiFailure.accountNotFound ||
        GeminiFailure.skillFileMissing ||
        GeminiFailure.browserNotFound ||
        GeminiFailure.addonUnsigned ||
        GeminiFailure.addonInstallFailed ||
        GeminiFailure.browserLaunchFailed ||
        GeminiFailure.gemUiNotFound =>
          true,
        _ => false,
      };
}

/// A failed bridge call, as thrown by `GeminiBridge.call`.
///
/// Thrown rather than returned as an outcome (unlike `GmailOutcome`) because
/// the callers here are multi-step flows — draft, then lint, then QA — where
/// the natural shape is "stop the flow at the first failure and show it", and
/// that is what an exception does for free.
class GeminiBridgeException implements Exception {
  GeminiBridgeException({
    required this.code,
    required this.message,
    Map<String, Object?>? details,
    GeminiFailure? failure,
  })  : details = details ?? const {},
        failure = failure ?? GeminiFailure.fromCode(code);

  /// The interpreter did not speak the protocol at all. [message] is whatever
  /// it managed to say — usually a traceback's last line, which is the only
  /// clue there is.
  factory GeminiBridgeException.unavailable(String message) =>
      GeminiBridgeException(
        code: 'UNAVAILABLE',
        message: message.trim().isEmpty
            ? 'The Gemini bridge did not start.'
            : message.trim(),
        failure: GeminiFailure.unavailable,
      );

  /// From the `error` object of a response, or null when [raw] is not one.
  static GeminiBridgeException? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final code = raw['code'];
    final message = raw['message'];
    return GeminiBridgeException(
      code: code is String && code.isNotEmpty ? code : 'UNKNOWN',
      message: message is String && message.trim().isNotEmpty
          ? message.trim()
          : 'The Gemini bridge reported an error.',
      details: asMap(raw['details']),
    );
  }

  final String code;
  final String message;
  final Map<String, Object?> details;
  final GeminiFailure failure;

  @override
  String toString() => '$code: $message';
}

// ---- wire shapes ----------------------------------------------------------

/// One request line to the daemon's stdin.
class GeminiRequest {
  const GeminiRequest({
    required this.id,
    required this.method,
    this.params = const {},
  });

  final String id;
  final String method;
  final Map<String, Object?> params;

  Map<String, Object?> toJson() => {
        'id': id,
        'method': method,
        'params': params,
      };

  /// The line as written, newline included — one JSON object per line is the
  /// whole framing.
  String encode() => '${jsonEncode(toJson())}\n';
}

/// One line from the daemon's stdout: a [GeminiResponse] to something this
/// app asked, or a [GeminiEvent] the daemon volunteered.
sealed class GeminiMessage {
  const GeminiMessage();

  /// Decodes one stdout line, or null for anything that is not a protocol
  /// line — a blank, a stray print from a library, a `ping` this side never
  /// sends and so never expects. Null is "ignore this", never an error: the
  /// daemon promises stdout carries only protocol, but a decoder that trusts
  /// that promise is the one that dies on a `DeprecationWarning`.
  static GeminiMessage? decodeLine(String line) {
    final trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
    final Object? decoded;
    try {
      decoded = jsonDecode(trimmed);
    } on FormatException {
      return null;
    }
    if (decoded is! Map) return null;
    final json = decoded.cast<String, Object?>();
    return switch (json['type']) {
      'response' => GeminiResponse.fromJson(json),
      'event' => GeminiEvent.fromJson(json),
      _ => null,
    };
  }
}

class GeminiResponse extends GeminiMessage {
  const GeminiResponse({
    required this.id,
    required this.ok,
    this.result = const {},
    this.error,
  });

  /// Null when the daemon could not even read the request line — the
  /// `BAD_PARAMS` reply to a malformed line carries `"id": null`.
  final String? id;
  final bool ok;
  final Map<String, Object?> result;
  final GeminiBridgeException? error;

  static GeminiResponse fromJson(Map<String, Object?> json) {
    final ok = json['ok'] == true;
    return GeminiResponse(
      id: asString(json['id']),
      ok: ok,
      result: asMap(json['result']),
      error: ok
          ? null
          : GeminiBridgeException.fromJson(json['error']) ??
              GeminiBridgeException(
                code: 'UNKNOWN',
                message: 'The Gemini bridge reported an error.',
              ),
    );
  }
}

class GeminiEvent extends GeminiMessage {
  const GeminiEvent({required this.event, this.data = const {}});

  /// `daemon`, `hello`, `job`, `status`, `log`, `progress`.
  final String event;
  final Map<String, Object?> data;

  static GeminiEvent fromJson(Map<String, Object?> json) => GeminiEvent(
        event: asString(json['event']) ?? '',
        data: asMap(json['data']),
      );

  /// For a `daemon` event: `listening`, `failed`, `extension_connected`,
  /// `extension_disconnected`, and — while the daemon gets a browser and the
  /// add-on ready — `browser_launching`, `browser_ready`, `addon_installing`
  /// (those three carry [daemonBrowser] and [daemonMessage]).
  String? get daemonState => asString(data['state']);

  /// For the browser/add-on `daemon` states: which browser, and a sentence a
  /// person can read ("Starting Firefox…") to show as status text.
  String? get daemonBrowser => asString(data['browser']);
  String? get daemonMessage => asString(data['message']);

  bool get isDaemon => event == 'daemon';
  bool get isStatus => event == 'status';
  bool get isJob => event == 'job';
  bool get isLog => event == 'log';
  bool get isProgress => event == 'progress';

  /// For a `progress` event: how far a long action has got; null for every
  /// other event.
  GeminiProgress? get progress =>
      isProgress ? GeminiProgress.fromJson(data) : null;
}

// ---- status ----------------------------------------------------------------

/// The signed-in Google account, as `get_account` / `status.account` /
/// `bridge.ensure_account` report it. Name and email are both optional — the
/// page does not always expose them.
class GeminiAccount {
  const GeminiAccount({this.name, this.email, this.index});

  final String? name;
  final String? email;

  /// The `/u/N/` number, 0 when the URL carries none.
  final int? index;

  bool get isEmpty => name == null && email == null;

  /// "Name (email)", or whichever one is known.
  String get label {
    final n = name;
    final e = email;
    if (n != null && e != null) return '$n ($e)';
    return n ?? e ?? '';
  }

  static GeminiAccount? fromJson(Object? raw) {
    if (raw is! Map) return null;
    return GeminiAccount(
      name: asString(raw['name']),
      email: asString(raw['email']),
      index: asInt(raw['index']),
    );
  }

  /// The `{name, email, index}` shape the daemon reports it in.
  Map<String, Object?> toJson() => {
        'name': name,
        'email': email,
        'index': index,
      };
}

/// The name the browser/window results use for [GeminiAccount] — the same
/// `{name, email, index}` object, so the two are one type.
typedef GeminiAccountInfo = GeminiAccount;

/// One element's line in the status object: found or not, and by which
/// strategy.
class GeminiElementStatus {
  const GeminiElementStatus({
    required this.name,
    required this.found,
    this.strategy,
    this.note,
  });

  final String name;
  final bool found;
  final String? strategy;

  /// The extension's own aside — "prompt box empty; button appears after
  /// typing" — for an element that is missing for a benign reason.
  final String? note;

  static GeminiElementStatus fromJson(String name, Object? raw) {
    final map = asMap(raw);
    return GeminiElementStatus(
      name: name,
      found: map['found'] == true,
      strategy: asString(map['strategy']),
      note: asString(map['note']),
    );
  }
}

class GeminiQueueStatus {
  const GeminiQueueStatus({this.length = 0, this.paused = false, this.running});

  final int length;
  final bool paused;

  /// The id of the job running now, if any.
  final String? running;

  static GeminiQueueStatus fromJson(Object? raw) {
    final map = asMap(raw);
    return GeminiQueueStatus(
      length: asInt(map['length']) ?? 0,
      paused: map['paused'] == true,
      running: asString(map['running']),
    );
  }
}

/// The extension's status object (`PROTOCOL.md` §3) — what the Gemini tab
/// looks like right now.
class GeminiPageStatus {
  const GeminiPageStatus({
    this.url,
    this.accountIndex,
    this.account,
    this.modelName,
    this.generating = false,
    this.signedOut = false,
    this.pageError,
    this.elements = const {},
    this.queue = const GeminiQueueStatus(),
    this.ready = false,
  });

  final String? url;
  final int? accountIndex;
  final GeminiAccount? account;
  final String? modelName;
  final bool generating;
  final bool signedOut;

  /// The first visible error signal on the page, as text.
  final String? pageError;
  final Map<String, GeminiElementStatus> elements;
  final GeminiQueueStatus queue;
  final bool ready;

  /// Elements the extension could not find, in report order.
  List<GeminiElementStatus> get missingElements => [
        for (final e in elements.values)
          if (!e.found) e
      ];

  static GeminiPageStatus fromJson(Map<String, Object?> json) {
    final model = json['model'];
    final pageError = json['pageError'];
    return GeminiPageStatus(
      url: asString(json['url']),
      accountIndex: asInt(json['accountIndex']),
      account: GeminiAccount.fromJson(json['account']),
      modelName: model is Map ? asString(model['name']) : asString(model),
      generating: json['generating'] == true,
      signedOut: json['signedOut'] == true,
      pageError:
          pageError is Map ? asString(pageError['text']) : asString(pageError),
      elements: {
        for (final entry in asMap(json['elements']).entries)
          entry.key: GeminiElementStatus.fromJson(entry.key, entry.value),
      },
      queue: GeminiQueueStatus.fromJson(json['queue']),
      ready: json['ready'] == true,
    );
  }
}

/// `bridge.status` — the daemon's own view, with the extension's status
/// object inside it when one is connected and answering.
class GeminiBridgeStatus {
  const GeminiBridgeStatus({
    this.listening = false,
    this.port,
    this.extensionConnected = false,
    this.hello = const {},
    this.status,
    this.statusError,
  });

  final bool listening;
  final int? port;
  final bool extensionConnected;

  /// The extension's `hello` payload — version, Chrome version, its tabs.
  final Map<String, Object?> hello;

  /// Null when no extension is connected, or when it is connected but the
  /// tab could not be asked; [statusError] says which.
  final GeminiPageStatus? status;
  final GeminiBridgeException? statusError;

  String? get extensionVersion => asString(hello['extensionVersion']);

  /// What the extension's `hello` says about where it runs (PROTOCOL.md,
  /// "hello additions"). All absent from an older extension.
  ///
  /// `firefox`, `edge`, `chrome` or `other`.
  String? get extensionBrowser => asString(hello['browser']);
  int? get manifestVersion => asInt(hello['manifestVersion']);

  /// What the extension can do: `gems`, `keepalive`, …
  List<String> get capabilities => asStringList(hello['capabilities']);

  /// The account the extension saw when it connected, when it knew one.
  GeminiAccount? get helloAccount => GeminiAccount.fromJson(hello['account']);

  static GeminiBridgeStatus fromJson(Map<String, Object?> json) {
    final status = json['status'];
    return GeminiBridgeStatus(
      listening: json['listening'] == true,
      port: asInt(json['port']),
      extensionConnected: json['extensionConnected'] == true,
      hello: asMap(json['hello']),
      status: status is Map
          ? GeminiPageStatus.fromJson(status.cast<String, Object?>())
          : null,
      statusError: GeminiBridgeException.fromJson(json['statusError']),
    );
  }
}

// ---- diagnostics -----------------------------------------------------------

/// One strategy the resolver tried for an element, with how many nodes it
/// matched and how many of those were visible.
class GeminiStrategyAttempt {
  const GeminiStrategyAttempt({
    required this.strategy,
    this.matched = 0,
    this.visible = 0,
    this.describe,
  });

  /// The strategy's name — `css#1`, `attr#3`.
  final String strategy;
  final int matched;
  final int visible;

  /// A readable rendering of the strategy, when the extension supplies one.
  final String? describe;

  static GeminiStrategyAttempt fromJson(Object? raw) {
    if (raw is String) return GeminiStrategyAttempt(strategy: raw);
    final map = asMap(raw);
    return GeminiStrategyAttempt(
      strategy: asString(map['strategy']) ?? '?',
      matched: asInt(map['matched']) ?? 0,
      visible: asInt(map['visible']) ?? 0,
      describe: asString(map['describe']),
    );
  }
}

/// How an element used to be found, the last time it was — the strategy and
/// what it matched, so a person can see what moved.
class GeminiLastKnown {
  const GeminiLastKnown({
    this.strategy,
    this.element = const {},
    this.at,
    this.url,
  });

  final String? strategy;

  /// The element summary (`tag`, `id`, `classes`, `aria`, `testId`, `text`,
  /// `rect`, `path`) — kept as a map, rendered with [describeElement].
  final Map<String, Object?> element;
  final DateTime? at;
  final String? url;

  static GeminiLastKnown? fromJson(Object? raw) {
    if (raw is! Map) return null;
    return GeminiLastKnown(
      strategy: asString(raw['strategy']),
      element: asMap(raw['element']),
      at: asEpochMillis(raw['at']),
      url: asString(raw['url']),
    );
  }
}

/// A visible element that might be the one the resolver was looking for.
class GeminiCandidate {
  const GeminiCandidate({this.summary = const {}, this.score, this.why});

  final Map<String, Object?> summary;
  final double? score;
  final String? why;

  static GeminiCandidate fromJson(Object? raw) {
    if (raw is! Map) {
      return GeminiCandidate(summary: {'text': raw?.toString() ?? ''});
    }
    // Either `{summary, score, why}` or a bare element summary.
    final summary = raw['summary'];
    return GeminiCandidate(
      summary: summary is Map
          ? summary.cast<String, Object?>()
          : raw.cast<String, Object?>(),
      score: asDouble(raw['score']),
      why: asString(raw['why']) ?? asString(raw['reason']),
    );
  }
}

/// A strategy the extension proposes for a missing element — what
/// `bridge.heal(element, pick)` applies by index.
class GeminiSuggestion {
  const GeminiSuggestion({
    required this.strategy,
    this.candidate = const {},
    this.score,
    this.reason,
  });

  /// The strategy JSON (`{"type": "css", "value": …}`) that would be
  /// prepended to the element's overrides.
  final Map<String, Object?> strategy;

  /// The element that strategy would select.
  final Map<String, Object?> candidate;
  final double? score;
  final String? reason;

  String get describe => describeStrategy(strategy);

  static GeminiSuggestion fromJson(Object? raw) {
    final map = asMap(raw);
    // A suggestion may be the bare strategy or wrap it as `{strategy: …}` —
    // the Python side accepts both (client.py `heal`), so this does too.
    final inner = map['strategy'];
    return GeminiSuggestion(
      strategy: inner is Map ? inner.cast<String, Object?>() : map,
      candidate: asMap(map['candidate']),
      score: asDouble(map['score']),
      reason: asString(map['reason']) ?? asString(map['why']),
    );
  }
}

/// Everything the diagnostics object says about one element.
class GeminiElementDiagnostics {
  const GeminiElementDiagnostics({
    required this.name,
    required this.found,
    this.strategy,
    this.tried = const [],
    this.element = const {},
    this.lastKnown,
    this.candidates = const [],
    this.suggestions = const [],
  });

  final String name;
  final bool found;
  final String? strategy;
  final List<GeminiStrategyAttempt> tried;

  /// The matched element's summary, when found.
  final Map<String, Object?> element;
  final GeminiLastKnown? lastKnown;
  final List<GeminiCandidate> candidates;
  final List<GeminiSuggestion> suggestions;

  static GeminiElementDiagnostics fromJson(String name, Object? raw) {
    final map = asMap(raw);
    return GeminiElementDiagnostics(
      name: name,
      found: map['found'] == true,
      strategy: asString(map['strategy']),
      tried: [
        for (final entry in asList(map['tried']))
          GeminiStrategyAttempt.fromJson(entry),
      ],
      element: asMap(map['element']),
      lastKnown: GeminiLastKnown.fromJson(map['lastKnown']),
      candidates: [
        for (final entry in asList(map['candidates']))
          GeminiCandidate.fromJson(entry),
      ],
      suggestions: [
        for (final entry in asList(map['suggestions']))
          if (entry is Map) GeminiSuggestion.fromJson(entry),
      ],
    );
  }
}

/// The cheap fingerprint of Gemini's component tree — which custom elements
/// the page has, and what changed since the locators last worked.
class GeminiPageFingerprint {
  const GeminiPageFingerprint({
    this.customElements = const [],
    this.customElementsAdded = const [],
    this.customElementsRemoved = const [],
    this.buttons,
    this.contentEditables,
    this.textareas,
  });

  final List<String> customElements;
  final List<String> customElementsAdded;
  final List<String> customElementsRemoved;
  final int? buttons;
  final int? contentEditables;
  final int? textareas;

  bool get changed =>
      customElementsAdded.isNotEmpty || customElementsRemoved.isNotEmpty;

  static GeminiPageFingerprint fromJson(Object? raw) {
    final map = asMap(raw);
    return GeminiPageFingerprint(
      customElements: asStringList(map['customElements']),
      customElementsAdded: asStringList(map['customElementsAdded']),
      customElementsRemoved: asStringList(map['customElementsRemoved']),
      buttons: asInt(map['buttons']),
      contentEditables: asInt(map['contentEditables']),
      textareas: asInt(map['textareas']),
    );
  }
}

/// The `diagnostics` result (`PROTOCOL.md` §4): every element, what was
/// tried, what it used to be, what it might be now.
class GeminiDiagnostics {
  const GeminiDiagnostics({
    this.url,
    this.title,
    this.readyState,
    this.extensionVersion,
    this.at,
    this.signedOut = false,
    this.pageError,
    this.elements = const {},
    this.overrides = const {},
    this.page = const GeminiPageFingerprint(),
    this.raw = const {},
  });

  final String? url;
  final String? title;
  final String? readyState;
  final String? extensionVersion;
  final DateTime? at;
  final bool signedOut;
  final String? pageError;
  final Map<String, GeminiElementDiagnostics> elements;

  /// The selector overrides currently in force, per element.
  final Map<String, Object?> overrides;
  final GeminiPageFingerprint page;

  /// The whole object as received, for "Copy diagnostics JSON" — what gets
  /// pasted into a bug report has to be what the extension said, not what
  /// this class kept.
  final Map<String, Object?> raw;

  List<GeminiElementDiagnostics> get missingElements => [
        for (final e in elements.values)
          if (!e.found) e
      ];

  String get rawJson => const JsonEncoder.withIndent('  ').convert(raw);

  static GeminiDiagnostics fromJson(Map<String, Object?> json) {
    final pageError = json['pageError'];
    return GeminiDiagnostics(
      url: asString(json['url']),
      title: asString(json['title']),
      readyState: asString(json['readyState']),
      extensionVersion: asString(json['extensionVersion']),
      at: asEpochMillis(json['at']),
      signedOut: json['signedOut'] == true,
      pageError:
          pageError is Map ? asString(pageError['text']) : asString(pageError),
      elements: {
        for (final entry in asMap(json['elements']).entries)
          entry.key: GeminiElementDiagnostics.fromJson(entry.key, entry.value),
      },
      overrides: asMap(json['overrides']),
      page: GeminiPageFingerprint.fromJson(json['page']),
      raw: json,
    );
  }
}

/// `bridge.heal` — the strategy that was just applied, and what else was on
/// offer.
class GeminiHealResult {
  const GeminiHealResult({
    required this.element,
    this.strategy = const {},
    this.suggestions = const [],
  });

  final String element;
  final Map<String, Object?> strategy;
  final List<GeminiSuggestion> suggestions;

  static GeminiHealResult fromJson(Map<String, Object?> json) =>
      GeminiHealResult(
        element: asString(json['element']) ?? '',
        strategy: asMap(json['strategy']),
        suggestions: [
          for (final entry in asList(json['suggestions']))
            if (entry is Map) GeminiSuggestion.fromJson(entry),
        ],
      );
}

// ---- browser vocabulary ------------------------------------------------------
//
// The names the app, the daemon (`bridge.browser_info`, `bridge.ensure_window`,
// `bridge.install_addon`) and the persisted settings share. They live here, in
// the pure-Dart half, so `GeminiBrowserEntry` can say which browser it is
// without this file reaching for Flutter; `gemini_bridge_types.dart` re-exports
// them, so every existing import sees them too.

/// The id of the Firefox add-on — what `bridge.browser_info` reports as
/// `addon.id` and what the packed add-on's manifest declares. Python's
/// `browser_manager.GEMINI_ADDON_ID` is the twin of this constant.
const geminiAddonId = 'gemini-bridge@gratovo.app';

/// Which browser the bridge opens Gemini in. The wire name is the Dart name.
enum GeminiBrowserKind {
  /// The default: the add-on can be installed into a profile the app owns
  /// without a click in the browser's own UI.
  firefox,
  edge,
  chrome,

  /// Whatever the OS opens web links with; the app cannot install the
  /// extension into it, so it is only useful when it is already loaded.
  system;

  String get wire => name;

  /// Null for a name this build does not know — the extension's `hello` also
  /// says `other`, and a newer daemon may list a browser this app has no case
  /// for.
  static GeminiBrowserKind? tryParse(String? raw) => _byName(values, raw);

  /// [tryParse] with a default, for persisted values.
  static GeminiBrowserKind fromWire(
    String? raw, {
    GeminiBrowserKind fallback = GeminiBrowserKind.firefox,
  }) =>
      tryParse(raw) ?? fallback;
}

/// Where the browser's profile comes from.
enum GeminiProfileMode {
  /// A dedicated profile the app owns, so the person's own browsing is never
  /// touched and the add-on can be installed into it.
  managed,

  /// The browser's default profile — only possible while that browser is not
  /// already running.
  existing;

  String get wire => name;

  static GeminiProfileMode? tryParse(String? raw) => _byName(values, raw);

  static GeminiProfileMode fromWire(
    String? raw, {
    GeminiProfileMode fallback = GeminiProfileMode.managed,
  }) =>
      tryParse(raw) ?? fallback;
}

/// How `bridge.install_addon` may get the add-on into the browser.
enum GeminiAddonMode {
  /// The best method available: a signed permanent install, else a temporary
  /// one.
  auto,

  /// Loaded for this browser session only; re-installed from the shipped
  /// folder on each launch.
  temporary,

  /// A Mozilla-signed `.xpi` in the profile.
  permanent;

  String get wire => name;

  static GeminiAddonMode? tryParse(String? raw) => _byName(values, raw);
}

T? _byName<T extends Enum>(Iterable<T> values, String? raw) {
  final wanted = raw?.trim().toLowerCase();
  if (wanted == null || wanted.isEmpty) return null;
  for (final value in values) {
    if (value.name.toLowerCase() == wanted) return value;
  }
  return null;
}

// ---- bridge.browser_info / ensure_window / install_addon -----------------------

/// Where the add-on stands in the browser (`addon.state`, DAEMON.md). A state
/// this build does not know reads as [unknown] rather than failing the whole
/// report.
enum GeminiAddonState {
  /// Not installed.
  missing('missing'),

  /// Loaded for this browser session only — the route that needs no signing
  /// on release Firefox. It goes with the browser process and is installed
  /// again on the next launch.
  temporary('temporary'),

  /// Installed permanently and current.
  installed('installed'),

  /// Installed, but older than the version the app ships.
  outdated('outdated'),

  /// The browser refused it: release Firefox will not run an unsigned
  /// permanent add-on.
  unsignedBlocked('unsigned_blocked'),

  /// Not known — the browser is not running, or this is a state newer than
  /// this build.
  unknown('unknown');

  const GeminiAddonState(this.wire);

  final String wire;

  static GeminiAddonState fromWire(String? raw) {
    final wanted = raw?.trim().toLowerCase();
    for (final state in values) {
      if (state.wire == wanted) return state;
    }
    return GeminiAddonState.unknown;
  }
}

/// How the add-on got (or would get) into the browser (`addon.method`).
enum GeminiAddonMethod {
  none('none'),

  /// Temporary add-on installed over Firefox's remote debugging protocol.
  rdpTemporary('rdp_temporary'),

  /// A signed `.xpi` placed in the managed profile.
  profileXpi('profile_xpi'),

  /// Installed by an enterprise policy.
  policy('policy'),

  /// Chrome/Edge: loaded unpacked from the extension folder, by hand.
  unpacked('unpacked'),
  unknown('unknown');

  const GeminiAddonMethod(this.wire);

  final String wire;

  static GeminiAddonMethod fromWire(String? raw) {
    final wanted = raw?.trim().toLowerCase();
    for (final method in values) {
      if (method.wire == wanted) return method;
    }
    return GeminiAddonMethod.unknown;
  }
}

/// One browser `bridge.browser_info` found (or looked for) on this machine.
class GeminiBrowserEntry {
  const GeminiBrowserEntry({
    required this.id,
    this.name = '',
    this.path,
    this.version,
    this.channel = 'unknown',
    this.installed = false,
    this.running = false,
    this.canRunUnsigned = false,
  });

  /// `firefox`, `edge`, `chrome` — as the daemon spells it; see [kind].
  final String id;

  /// "Mozilla Firefox".
  final String name;
  final String? path;
  final String? version;

  /// Firefox: `release | beta | esr | dev | nightly | unknown`; the others
  /// `stable | unknown`. Kept as text — a channel this build has never heard
  /// of is still worth showing.
  final String channel;
  final bool installed;

  /// A process of it is running now — which decides whether the person's
  /// default profile can be used.
  final bool running;

  /// True only where the browser honours an unsigned permanent add-on: ESR,
  /// Developer Edition, Nightly, unbranded builds.
  final bool canRunUnsigned;

  /// [id] as one of the four [GeminiBrowserKind]s, or null for a browser this
  /// build has no case for.
  GeminiBrowserKind? get kind => GeminiBrowserKind.tryParse(id);

  /// [name], or the [id] when the daemon sent none.
  String get label => name.isEmpty ? id : name;

  static GeminiBrowserEntry fromJson(Object? raw) {
    final map = asMap(raw);
    return GeminiBrowserEntry(
      id: asString(map['id']) ?? '',
      name: asString(map['name']) ?? '',
      path: asString(map['path']),
      version: asString(map['version']),
      channel: asString(map['channel']) ?? 'unknown',
      installed: map['installed'] == true,
      running: map['running'] == true,
      canRunUnsigned: map['canRunUnsigned'] == true,
    );
  }

  Map<String, Object?> toJson() => {
        'id': id,
        'name': name,
        'path': path,
        'version': version,
        'channel': channel,
        'installed': installed,
        'running': running,
        'canRunUnsigned': canRunUnsigned,
      };
}

/// The add-on's state in the selected browser — `bridge.browser_info`'s
/// `addon`, and `bridge.install_addon`'s whole result.
///
/// `bridge.ensure_window` reports a shorter `addon` (`state`, `version`,
/// `method`); the missing fields keep their defaults, and its `version` is
/// read as [installedVersion] — the version that is in the browser now.
class GeminiAddonStatus {
  const GeminiAddonStatus({
    this.id = geminiAddonId,
    this.shippedVersion,
    this.installedVersion,
    this.state = GeminiAddonState.unknown,
    this.signed = false,
    this.restartNeeded = false,
    this.method = GeminiAddonMethod.unknown,
    this.message = '',
  });

  final String id;

  /// The version this app ships.
  final String? shippedVersion;

  /// The version in the browser, null when there is none.
  final String? installedVersion;
  final GeminiAddonState state;

  /// Whether what is installed carries a Mozilla signature.
  final bool signed;

  /// The browser has to be restarted before the add-on takes effect.
  final bool restartNeeded;
  final GeminiAddonMethod method;

  /// A sentence for the person: what is wrong, what will happen, or what to
  /// do about it. Empty when there is nothing to add.
  final String message;

  static GeminiAddonStatus fromJson(Object? raw) {
    final map = asMap(raw);
    return GeminiAddonStatus(
      id: asString(map['id']) ?? geminiAddonId,
      shippedVersion: asString(map['shippedVersion']),
      installedVersion:
          asString(map['installedVersion']) ?? asString(map['version']),
      state: GeminiAddonState.fromWire(asString(map['state'])),
      signed: map['signed'] == true,
      restartNeeded: map['restartNeeded'] == true,
      method: GeminiAddonMethod.fromWire(asString(map['method'])),
      message: asString(map['message']) ?? '',
    );
  }

  Map<String, Object?> toJson() => {
        'id': id,
        'shippedVersion': shippedVersion,
        'installedVersion': installedVersion,
        'state': state.wire,
        'signed': signed,
        'restartNeeded': restartNeeded,
        'method': method.wire,
        'message': message,
      };
}

/// The browser profile the bridge uses (`bridge.browser_info`'s `profile`).
class GeminiProfileInfo {
  const GeminiProfileInfo({
    this.mode = GeminiProfileMode.managed,
    this.dir,
    this.exists = false,
  });

  final GeminiProfileMode mode;

  /// Where it is (or will be created), when the daemon knows.
  final String? dir;
  final bool exists;

  static GeminiProfileInfo fromJson(Object? raw) {
    final map = asMap(raw);
    return GeminiProfileInfo(
      mode: GeminiProfileMode.fromWire(asString(map['mode'])),
      dir: asString(map['dir']),
      exists: map['exists'] == true,
    );
  }

  Map<String, Object?> toJson() => {
        'mode': mode.wire,
        'dir': dir,
        'exists': exists,
      };
}

/// `bridge.browser_info` — which browsers are here, which one is selected,
/// and what state the add-on is in. Never an error on the daemon's side:
/// problems are in [addon]'s message and the per-browser fields.
class GeminiBrowserInfo {
  const GeminiBrowserInfo({
    this.selected = '',
    this.browsers = const [],
    this.addon = const GeminiAddonStatus(),
    this.profile = const GeminiProfileInfo(),
    this.extensionDir,
    this.xpiPath,
  });

  /// The id of the selected browser.
  final String selected;
  final List<GeminiBrowserEntry> browsers;
  final GeminiAddonStatus addon;
  final GeminiProfileInfo profile;

  /// Where the shipped extension folder is — what "Load unpacked" points at
  /// for Chrome and Edge.
  final String? extensionDir;

  /// The signed `.xpi`, when one has been produced.
  final String? xpiPath;

  GeminiBrowserKind? get selectedKind => GeminiBrowserKind.tryParse(selected);

  /// The entry [selected] names, if it is in [browsers].
  GeminiBrowserEntry? get selectedEntry {
    for (final entry in browsers) {
      if (entry.id == selected) return entry;
    }
    return null;
  }

  List<GeminiBrowserEntry> get installedBrowsers => [
        for (final entry in browsers)
          if (entry.installed) entry
      ];

  static GeminiBrowserInfo fromJson(Map<String, Object?> json) =>
      GeminiBrowserInfo(
        selected: asString(json['selected']) ?? '',
        browsers: [
          for (final entry in asList(json['browsers']))
            if (entry is Map) GeminiBrowserEntry.fromJson(entry),
        ],
        addon: GeminiAddonStatus.fromJson(json['addon']),
        profile: GeminiProfileInfo.fromJson(json['profile']),
        extensionDir: asString(json['extensionDir']),
        xpiPath: asString(json['xpiPath']),
      );

  Map<String, Object?> toJson() => {
        'selected': selected,
        'browsers': [for (final entry in browsers) entry.toJson()],
        'addon': addon.toJson(),
        'profile': profile.toJson(),
        'extensionDir': extensionDir,
        'xpiPath': xpiPath,
      };
}

/// One step `bridge.ensure_window` took to get there — the diagnostics that
/// let the card say where it stopped.
class GeminiStep {
  const GeminiStep({
    required this.name,
    this.ok = true,
    this.ms,
    this.detail = '',
  });

  /// `daemon_listening`, `launch_browser`, `install_addon`, …
  final String name;
  final bool ok;
  final int? ms;

  /// What happened, in words, when there is more to say than [ok].
  final String detail;

  static GeminiStep fromJson(Object? raw) {
    final map = asMap(raw);
    return GeminiStep(
      name: asString(map['name']) ?? '',
      ok: map['ok'] == true,
      ms: asInt(map['ms']),
      detail: asString(map['detail']) ?? '',
    );
  }

  Map<String, Object?> toJson() => {
        'name': name,
        'ok': ok,
        'ms': ms,
        'detail': detail,
      };
}

/// The Gemini tab `bridge.ensure_window` ended up with.
class GeminiWindowTab {
  const GeminiWindowTab({this.tabId, this.url});

  final int? tabId;
  final String? url;

  static GeminiWindowTab? fromJson(Object? raw) {
    if (raw is! Map) return null;
    return GeminiWindowTab(
      tabId: asInt(raw['tabId']),
      url: asString(raw['url']),
    );
  }

  Map<String, Object?> toJson() => {'tabId': tabId, 'url': url};
}

/// `bridge.ensure_window` — whether "the extension is connected and a Gemini
/// tab exists" now holds, and how it got there.
///
/// "Could not get there" is NOT an exception: it is [connected] false with
/// [steps] saying which one failed and a [message] saying what to do.
class GeminiWindowResult {
  const GeminiWindowResult({
    this.connected = false,
    this.launched = false,
    this.reused = false,
    this.browser,
    this.addon = const GeminiAddonStatus(),
    this.tab,
    this.account,
    this.steps = const [],
    this.message = '',
  });

  final bool connected;

  /// The browser was started by this call.
  final bool launched;

  /// A window that was already there was used.
  final bool reused;

  /// The id of the browser used.
  final String? browser;
  final GeminiAddonStatus addon;
  final GeminiWindowTab? tab;

  /// The signed-in account, null when unknown — including a first run where
  /// the person has not signed in to Google yet ([message] says so).
  final GeminiAccountInfo? account;
  final List<GeminiStep> steps;
  final String message;

  /// The first step that did not work, if any.
  GeminiStep? get failedStep {
    for (final step in steps) {
      if (!step.ok) return step;
    }
    return null;
  }

  static GeminiWindowResult fromJson(Map<String, Object?> json) =>
      GeminiWindowResult(
        connected: json['connected'] == true,
        launched: json['launched'] == true,
        reused: json['reused'] == true,
        browser: asString(json['browser']),
        addon: GeminiAddonStatus.fromJson(json['addon']),
        tab: GeminiWindowTab.fromJson(json['tab']),
        account: GeminiAccount.fromJson(json['account']),
        steps: [
          for (final step in asList(json['steps']))
            if (step is Map) GeminiStep.fromJson(step),
        ],
        message: asString(json['message']) ?? '',
      );

  Map<String, Object?> toJson() => {
        'connected': connected,
        'launched': launched,
        'reused': reused,
        'browser': browser,
        // The short shape `ensure_window` reports the add-on in.
        'addon': {
          'state': addon.state.wire,
          'version': addon.installedVersion,
          'method': addon.method.wire,
        },
        'tab': tab?.toJson(),
        'account': account?.toJson(),
        'steps': [for (final step in steps) step.toJson()],
        'message': message,
      };
}

// ---- gems ------------------------------------------------------------------------

/// `action.gem_create` / `action.gem_update` — the gem that was saved.
class GemResult {
  const GemResult({
    this.url = '',
    this.gemId = '',
    this.name = '',
    this.changed = const [],
  });

  /// `https://gemini.google.com/gem/<id>`.
  final String url;
  final String gemId;
  final String name;

  /// For an update: which fields actually changed (`name`, `description`,
  /// `instructions`). Empty for a create.
  final List<String> changed;

  static GemResult fromJson(Map<String, Object?> json) => GemResult(
        url: asString(json['url']) ?? '',
        gemId: asString(json['gemId']) ?? '',
        name: asString(json['name']) ?? '',
        changed: asStringList(json['changed']),
      );

  Map<String, Object?> toJson() => {
        'url': url,
        'gemId': gemId,
        'name': name,
        'changed': changed,
      };
}

/// `action.gem_read` — a gem as its editor shows it. The description and the
/// instructions are kept verbatim (not trimmed): they are text somebody will
/// edit and write back.
class GemDetails {
  const GemDetails({
    this.url = '',
    this.gemId = '',
    this.name = '',
    this.description = '',
    this.instructions = '',
  });

  final String url;
  final String gemId;
  final String name;
  final String description;
  final String instructions;

  static GemDetails fromJson(Map<String, Object?> json) => GemDetails(
        url: asString(json['url']) ?? '',
        gemId: asString(json['gemId']) ?? '',
        name: asString(json['name']) ?? '',
        description: _asText(json['description']),
        instructions: _asText(json['instructions']),
      );

  Map<String, Object?> toJson() => {
        'url': url,
        'gemId': gemId,
        'name': name,
        'description': description,
        'instructions': instructions,
      };
}

// ---- drafting rules ----------------------------------------------------------------

/// A `progress` event: how far a long action has got — "chat 2 of 4 done".
/// Any action may emit them; the ones that do say so in DAEMON.md.
class GeminiProgress {
  const GeminiProgress({
    required this.action,
    this.done = 0,
    this.total = 0,
    this.keywords,
    this.message = '',
    this.data = const {},
  });

  /// The action it belongs to (`generate_keywords`), without the `action.`
  /// prefix.
  final String action;
  final int done;

  /// How many steps there will be, or 0 when that is not known yet.
  final int total;

  /// For `generate_keywords`: how many keywords there are so far.
  final int? keywords;
  final String message;

  /// The whole payload as received, for the fields only one action sends.
  final Map<String, Object?> data;

  /// 0–1, or null while [total] is unknown.
  double? get fraction =>
      total <= 0 ? null : (done / total).clamp(0.0, 1.0).toDouble();

  static GeminiProgress fromJson(Map<String, Object?> json) => GeminiProgress(
        action: asString(json['action']) ?? '',
        done: asInt(json['done']) ?? 0,
        total: asInt(json['total']) ?? 0,
        keywords: asInt(json['keywords']),
        message: asString(json['message']) ?? '',
        data: json,
      );

  Map<String, Object?> toJson() => {
        'action': action,
        'done': done,
        'total': total,
        if (keywords != null) 'keywords': keywords,
        'message': message,
      };
}

// ---- actions ---------------------------------------------------------------

/// One chat of a multi-chat keyword batch (`action.generate_keywords` with
/// `chats > 1`): what it was asked for, what came back, and whether it worked.
class KeywordChatResult {
  const KeywordChatResult({
    required this.index,
    this.requested = 0,
    this.received = 0,
    this.ok = true,
    this.error,
    this.durationMs,
  });

  /// Position in the batch, from 0.
  final int index;
  final int requested;
  final int received;
  final bool ok;

  /// Why it failed, in words, when it did.
  final String? error;
  final int? durationMs;

  Duration? get duration =>
      durationMs == null ? null : Duration(milliseconds: durationMs!);

  static KeywordChatResult fromJson(Object? raw, {required int fallbackIndex}) {
    final map = asMap(raw);
    // The daemon may report the error as text or as `{code, message}`.
    final rawError = map['error'];
    final error = rawError is Map
        ? asString(rawError['message']) ?? asString(rawError['code'])
        : asString(rawError);
    final ok = map['ok'];
    return KeywordChatResult(
      index: asInt(map['index']) ?? fallbackIndex,
      requested: asInt(map['requested']) ?? 0,
      received: asInt(map['received']) ?? 0,
      // No verdict at all reads as fine unless an error came with it.
      ok: ok is bool ? ok : error == null,
      error: error,
      durationMs: asInt(map['durationMs']),
    );
  }

  Map<String, Object?> toJson() => {
        'index': index,
        'requested': requested,
        'received': received,
        'ok': ok,
        'error': error,
        'durationMs': durationMs,
      };
}

/// `action.generate_keywords`.
class KeywordsResult {
  const KeywordsResult({
    this.keywords = const [],
    this.dropped = 0,
    this.raw = '',
    this.model,
    this.chats = const [],
    this.partial = false,
  });

  final List<String> keywords;

  /// How many the daemon removed as duplicates of `avoid` or of each other.
  final int dropped;
  final String raw;
  final String? model;

  /// One entry per chat of a multi-chat batch; empty for a single chat and
  /// for a daemon that predates batches.
  final List<KeywordChatResult> chats;

  /// Some chats failed but at least one produced keywords: what came back is
  /// returned, not raised, and this says it is not the whole request.
  final bool partial;

  /// The chats that did not work.
  List<KeywordChatResult> get failedChats => [
        for (final chat in chats)
          if (!chat.ok) chat
      ];

  static KeywordsResult fromJson(Map<String, Object?> json) {
    final rawChats = asList(json['chats']);
    return KeywordsResult(
      keywords: asStringList(json['keywords']),
      dropped: asInt(json['dropped']) ?? 0,
      raw: asString(json['raw']) ?? '',
      model: asString(json['model']),
      chats: [
        for (var i = 0; i < rawChats.length; i++)
          if (rawChats[i] is Map)
            KeywordChatResult.fromJson(rawChats[i], fallbackIndex: i),
      ],
      partial: json['partial'] == true,
    );
  }
}

/// `action.classify_channel`.
class ClassifyResult {
  const ClassifyResult({
    this.niche,
    this.audience,
    this.language,
    this.brandFit,
    this.reasons = const [],
    this.redFlags = const [],
    this.raw = '',
    this.model,
  });

  final String? niche;
  final String? audience;
  final String? language;

  /// 1–5.
  final int? brandFit;
  final List<String> reasons;
  final List<String> redFlags;
  final String raw;
  final String? model;

  static ClassifyResult fromJson(Map<String, Object?> json) => ClassifyResult(
        niche: asString(json['niche']),
        audience: asString(json['audience']),
        language: asString(json['language']),
        brandFit: asInt(json['brandFit']) ?? asInt(json['brand_fit']),
        reasons: asStringList(json['reasons']),
        redFlags: asStringList(json['redFlags'] ?? json['red_flags']),
        raw: asString(json['raw']) ?? '',
        model: asString(json['model']),
      );
}

/// A queued prompt in the extension's queue (`PROTOCOL.md` §3, job object).
class GeminiJob {
  const GeminiJob({
    required this.id,
    this.prompt = '',
    this.status = 'queued',
    this.result = const {},
    this.error,
    this.meta = const {},
    this.createdAt,
    this.startedAt,
    this.finishedAt,
    this.attempts = 0,
  });

  final String id;
  final String prompt;

  /// `queued | running | done | error | cancelled`.
  final String status;
  final Map<String, Object?> result;
  final GeminiBridgeException? error;
  final Map<String, Object?> meta;
  final DateTime? createdAt;
  final DateTime? startedAt;
  final DateTime? finishedAt;
  final int attempts;

  bool get isFinished =>
      status == 'done' || status == 'error' || status == 'cancelled';

  /// The answer's text, once done.
  String? get text => asString(result['text']);

  static GeminiJob fromJson(Map<String, Object?> json) => GeminiJob(
        id: asString(json['id']) ?? '',
        prompt: asString(json['prompt']) ?? '',
        status: asString(json['status']) ?? 'queued',
        result: asMap(json['result']),
        error: GeminiBridgeException.fromJson(json['error']),
        meta: asMap(json['meta']),
        createdAt: asEpochMillis(json['createdAt']),
        startedAt: asEpochMillis(json['startedAt']),
        finishedAt: asEpochMillis(json['finishedAt']),
        attempts: asInt(json['attempts']) ?? 0,
      );
}

// ---- rendering helpers -----------------------------------------------------

/// One line a person can read for a locator strategy — the Dart twin of
/// `describe_strategy` in `gemini_bridge/cli.py`, so the Settings panel and
/// the CLI describe the same fix in the same words.
String describeStrategy(Object? strategy) {
  if (strategy is! Map) return strategy?.toString() ?? '?';
  final kind = strategy['type']?.toString() ?? '?';
  final parts = <String>[kind];
  switch (kind) {
    case 'css':
      parts.add("'${strategy['value'] ?? ''}'");
    case 'attr':
      parts.add("${strategy['attr'] ?? '?'} ~ /${strategy['match'] ?? ''}/");
    case 'text':
    case 'icon':
      parts.add('~ /${strategy['match'] ?? ''}/');
    case 'fn':
      parts.add(strategy['name']?.toString() ?? '?');
    default:
      final extra = {
        for (final entry in strategy.entries)
          if (entry.key != 'type' && entry.key != 'name')
            entry.key.toString(): entry.value,
      };
      parts.add(jsonEncode(extra));
  }
  final tags = strategy['tags'];
  if (tags is List && tags.isNotEmpty) parts.add('on ${tags.join(', ')}');
  final climb = strategy['climb'];
  if (climb != null && climb.toString().isNotEmpty) {
    parts.add("climb '$climb'");
  }
  final within = strategy['within'];
  if (within != null && within.toString().isNotEmpty) {
    parts.add("within '$within'");
  }
  var line = parts.join(' ');
  final name = strategy['name'];
  if (name != null && name.toString().isNotEmpty && kind != 'fn') {
    line = '[$name] $line';
  }
  return line;
}

/// One line for an element summary from the diagnostics object — the twin of
/// `describe_element` in `cli.py`. The DOM path, when present, goes on a
/// second line: it is the longest part and the least often needed.
String describeElement(Object? summary) {
  if (summary is! Map) return summary?.toString() ?? '?';
  var head = (summary['tag']?.toString() ?? '').isEmpty
      ? '?'
      : summary['tag'].toString();
  final id = summary['id']?.toString() ?? '';
  if (id.isNotEmpty) head += '#$id';
  final classes = (summary['classes']?.toString() ?? '')
      .split(RegExp(r'\s+'))
      .where((c) => c.isNotEmpty)
      .toList();
  if (classes.isNotEmpty) {
    head += '.${classes.take(4).join('.')}${classes.length > 4 ? ' …' : ''}';
  }
  final bits = <String>[head];
  final testId = summary['testId']?.toString() ?? '';
  if (testId.isNotEmpty) bits.add("testId='$testId'");
  final aria = summary['aria']?.toString() ?? '';
  if (aria.isNotEmpty) bits.add("aria='${_clip(aria, 60)}'");
  final text = summary['text']?.toString() ?? '';
  if (text.isNotEmpty) bits.add("text='${_clip(text, 40)}'");
  final rect = summary['rect'];
  if (rect is Map) {
    bits.add('@${rect['x']},${rect['y']} ${rect['w']}x${rect['h']}');
  }
  var line = bits.join(' ');
  final path = summary['path']?.toString() ?? '';
  if (path.isNotEmpty) line += '\n$path';
  return line;
}

String _clip(String text, int max) =>
    text.length <= max ? text : '${text.substring(0, max)}…';

// ---- lenient readers -------------------------------------------------------
//
// Public (not underscored) because `gemini_bridge_io.dart` reads event
// payloads with the same tolerance, and the tests assert on them directly.

String? asString(Object? value) {
  if (value is! String) return null;
  final trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

/// A string exactly as sent — untrimmed, blanks kept, '' when it is not a
/// string. For text somebody will edit and write back (a gem's instructions),
/// where [asString]'s trim would quietly change what they wrote.
String _asText(Object? value) => value is String ? value : '';

int? asInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value.trim());
  return null;
}

double? asDouble(Object? value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value.trim());
  return null;
}

Map<String, Object?> asMap(Object? value) =>
    value is Map ? value.cast<String, Object?>() : const {};

List<Object?> asList(Object? value) => value is List ? value : const [];

/// Strings only, trimmed, blanks dropped; a lone string becomes a one-item
/// list, since a model asked for a list sometimes answers with a sentence.
List<String> asStringList(Object? value) {
  if (value is String) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? const [] : [trimmed];
  }
  return [
    for (final entry in asList(value))
      if (entry is String && entry.trim().isNotEmpty) entry.trim(),
  ];
}

/// The extension stamps times as epoch milliseconds (`Date.now()`); the
/// daemon may stamp its own as ISO strings. Both come back as UTC.
DateTime? asEpochMillis(Object? value) {
  if (value is num) {
    return DateTime.fromMillisecondsSinceEpoch(value.toInt(), isUtc: true);
  }
  if (value is String && value.trim().isNotEmpty) {
    return DateTime.tryParse(value.trim())?.toUtc();
  }
  return null;
}
