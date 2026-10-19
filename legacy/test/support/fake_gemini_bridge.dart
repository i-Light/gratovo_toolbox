import 'dart:async';

import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';

/// A [GeminiBridge] with scripted answers and a state the test moves by hand.
///
/// Every typed helper on the abstract class is real — only `call` is faked —
/// so a widget test exercises the same parameter shapes the daemon will
/// receive, and [calls] is where a test reads them back. Answers are queued
/// per method, so the first call to an action can fail and the second
/// succeed.
///
/// Override `geminiBridgeProvider` with one of these in a `ProviderScope`.
class FakeGeminiBridge extends GeminiBridge {
  FakeGeminiBridge({
    GeminiBridgeState? initialState,
    this.available = true,
    this.extensionDir = r'C:\gratovo\pipeline\gemini_extension',
    this.latency = Duration.zero,
  }) : _state = initialState ?? const GeminiBridgeState.stopped();

  /// What [isAvailable] answers — false to behave like the web stub.
  final bool available;

  /// Simulated round-trip time, so a test can see the in-flight state.
  final Duration latency;

  @override
  final String? extensionDir;

  /// Every `call` made, in order, with the exact params.
  final calls = <FakeGeminiCall>[];

  /// How many times `prepareForAction` ran.
  int prepareCount = 0;

  final _answers = <String, List<Object>>{};
  final _progress = <String, List<GeminiProgress>>{};
  final _stateChanges = StreamController<GeminiBridgeState>.broadcast();
  final _events = StreamController<GeminiEvent>.broadcast();
  GeminiBridgeState _state;
  bool _stopped = false;

  /// Queues [result] as the next answer to [method]. Queue several and they
  /// are handed out in order; the last one repeats once the queue is spent.
  void answer(String method, Map<String, Object?> result) =>
      (_answers[method] ??= []).add(result);

  /// Queues a failure for [method], same ordering as [answer].
  void fail(String method, GeminiBridgeException error) =>
      (_answers[method] ??= []).add(error);

  /// A convenience for the common failures.
  void failWith(String method, String code, String message,
          {Map<String, Object?> details = const {}}) =>
      fail(
        method,
        GeminiBridgeException(code: code, message: message, details: details),
      );

  /// Moves the state and tells every listener.
  void setState(GeminiBridgeState next) {
    _state = next;
    if (!_stateChanges.isClosed) _stateChanges.add(next);
  }

  /// Forwards an event as the daemon would.
  void emit(GeminiEvent event) {
    if (!_events.isClosed) _events.add(event);
  }

  // ---- the browser, gem and drafting-rule calls -----------------------------
  //
  // Typed twins of [answer]: each encodes through the class's own `toJson`, so
  // a test scripts a `GeminiBrowserInfo` rather than hand-writing the daemon's
  // JSON — and the typed call under test decodes it exactly as it would a real
  // answer. Failures go through [fail] / [failWith] as for any method
  // (`ADDON_UNSIGNED`, `BROWSER_NOT_FOUND`, `GEM_SAVE_FAILED`,
  // `NOT_IMPLEMENTED`, ...).

  void answerBrowserInfo(GeminiBrowserInfo info) =>
      answer('bridge.browser_info', info.toJson());

  void answerEnsureWindow(GeminiWindowResult result) =>
      answer('bridge.ensure_window', result.toJson());

  /// Answered in the shape the daemon uses for `bridge.install_addon`:
  /// `version`, not `installedVersion`.
  void answerInstallAddon(GeminiAddonStatus status) => answer(
        'bridge.install_addon',
        {
          'state': status.state.wire,
          'version': status.installedVersion,
          'method': status.method.wire,
          'restartNeeded': status.restartNeeded,
          'message': status.message,
        },
      );

  void answerGemCreate(GemResult result) =>
      answer('action.gem_create', result.toJson());

  void answerGemUpdate(GemResult result) =>
      answer('action.gem_update', result.toJson());

  void answerGemRead(GemDetails gem) => answer('action.gem_read', gem.toJson());

  /// Pushes a `progress` event as the daemon would.
  void emitProgress(GeminiProgress progress) => emit(
        GeminiEvent(event: 'progress', data: progress.toJson()),
      );

  /// Makes every call to [method] emit [steps] as `progress` events, in
  /// order, before it is answered — one turn of the event loop apart, so a
  /// widget test that pumps between them sees each one. For interleaving by
  /// hand instead, give the fake a [latency] and call [emitProgress] while the
  /// call is in flight.
  void scriptProgress(String method, List<GeminiProgress> steps) =>
      _progress[method] = List.of(steps);

  int callCount(String method) => calls.where((c) => c.method == method).length;

  FakeGeminiCall? lastCall(String method) {
    for (final call in calls.reversed) {
      if (call.method == method) return call;
    }
    return null;
  }

  @override
  bool get isAvailable => available;

  @override
  GeminiBridgeState get state => _state;

  @override
  Stream<GeminiBridgeState> get stateChanges => _stateChanges.stream;

  @override
  Stream<GeminiEvent> get events => _events.stream;

  @override
  Future<void> ensureStarted() async {
    if (!available) {
      throw GeminiBridgeException.unavailable(
        'The Gemini bridge is not available on this platform.',
      );
    }
    if (_state.isFailed) {
      throw GeminiBridgeException.unavailable(_state.message ?? 'failed');
    }
    // A stopped fake comes up connected on first use, the way a working
    // install does; a test that wants the listening-only state sets it.
    if (_state.isStopped || _state.isStarting) {
      setState(GeminiBridgeState.connected(const GeminiBridgeStatus(
        listening: true,
        port: GeminiBridgeSettings.defaultPort,
        extensionConnected: true,
      )));
    }
    _stopped = false;
  }

  @override
  Future<Map<String, Object?>> call(
    String method, [
    Map<String, Object?> params = const {},
    Duration? timeout,
  ]) async {
    await ensureStarted();
    calls.add(FakeGeminiCall(method, params, timeout: timeout));
    for (final step in _progress[method] ?? const <GeminiProgress>[]) {
      emitProgress(step);
      await Future<void>.delayed(Duration.zero);
    }
    if (latency > Duration.zero) await Future<void>.delayed(latency);
    final queue = _answers[method];
    if (queue == null || queue.isEmpty) {
      throw GeminiBridgeException(
        code: 'BAD_PARAMS',
        message: 'FakeGeminiBridge has no answer scripted for $method',
      );
    }
    final next = queue.length > 1 ? queue.removeAt(0) : queue.first;
    if (next is GeminiBridgeException) throw next;
    return next as Map<String, Object?>;
  }

  @override
  Future<void> stop() async {
    _stopped = true;
    setState(const GeminiBridgeState.stopped());
  }

  bool get wasStopped => _stopped;

  @override
  Future<void> prepareForAction() async {
    prepareCount += 1;
    await ensureStarted();
  }

  void dispose() {
    _stateChanges.close();
    _events.close();
  }
}

class FakeGeminiCall {
  const FakeGeminiCall(this.method, this.params, {this.timeout});

  final String method;
  final Map<String, Object?> params;

  /// The deadline the typed helper gave the call — null when it took the
  /// default. What pins "ensure_window = its timeoutS + 30 s" and the like.
  final Duration? timeout;

  @override
  String toString() => '$method $params';
}

/// What `bridge.browser_info` says on a machine with release Firefox and no
/// add-on yet — the first-run state the Settings card has to explain.
GeminiBrowserInfo sampleGeminiBrowserInfo({
  GeminiAddonState addonState = GeminiAddonState.missing,
  GeminiAddonMethod addonMethod = GeminiAddonMethod.none,
  String? installedVersion,
  String addonMessage =
      'The add-on is not installed. It is installed the next time Gemini '
          'is opened.',
}) =>
    GeminiBrowserInfo(
      selected: 'firefox',
      browsers: const [
        GeminiBrowserEntry(
          id: 'firefox',
          name: 'Mozilla Firefox',
          path: r'C:\Program Files\Mozilla Firefox\firefox.exe',
          version: '156.0.1',
          channel: 'release',
          installed: true,
        ),
        GeminiBrowserEntry(
          id: 'edge',
          name: 'Microsoft Edge',
          path: r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
          version: '129.0.2792.52',
          channel: 'stable',
          installed: true,
        ),
        GeminiBrowserEntry(id: 'chrome', name: 'Google Chrome'),
      ],
      addon: GeminiAddonStatus(
        shippedVersion: '0.2.0',
        installedVersion: installedVersion,
        state: addonState,
        method: addonMethod,
        message: addonMessage,
      ),
      profile: const GeminiProfileInfo(
        dir: r'C:\Users\x\AppData\Local\gratovo\gemini-profile',
      ),
      extensionDir: r'C:\gratovo\pipeline\gemini_extension',
    );

/// What `bridge.ensure_window` answers once everything worked: connected, a
/// Gemini tab, an account.
GeminiWindowResult sampleGeminiWindowResult({
  bool connected = true,
  bool launched = false,
  String message = '',
}) =>
    GeminiWindowResult(
      connected: connected,
      launched: launched,
      reused: connected && !launched,
      browser: 'firefox',
      addon: const GeminiAddonStatus(
        installedVersion: '0.2.0',
        state: GeminiAddonState.temporary,
        method: GeminiAddonMethod.rdpTemporary,
      ),
      tab: connected
          ? const GeminiWindowTab(
              tabId: 12,
              url: 'https://gemini.google.com/app',
            )
          : null,
      account: connected
          ? const GeminiAccount(
              name: 'Moustafa Khaled',
              email: 'moustafa@example.com',
              index: 1,
            )
          : null,
      steps: const [
        GeminiStep(name: 'daemon_listening', ms: 3),
        GeminiStep(name: 'launch_browser', ms: 1240),
      ],
      message: message,
    );

/// A connected state with an account and a model, as the Settings card and
/// the dialogs render it.
GeminiBridgeState connectedGeminiState({
  String name = 'Moustafa Khaled',
  String email = 'moustafa@example.com',
  String model = '2.5 Pro',
  int port = GeminiBridgeSettings.defaultPort,
}) =>
    GeminiBridgeState.connected(GeminiBridgeStatus(
      listening: true,
      port: port,
      extensionConnected: true,
      hello: const {'extensionVersion': '0.1.0'},
      status: GeminiPageStatus(
        url: 'https://gemini.google.com/app',
        account: GeminiAccount(name: name, email: email, index: 0),
        modelName: model,
        ready: true,
      ),
    ));
