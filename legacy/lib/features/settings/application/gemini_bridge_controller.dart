import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';

/// What the Settings → Gemini in browser card is doing right now, beyond the
/// bridge's own state (which `geminiBridgeStateProvider` carries).
///
/// Every field is a result somebody asked for from this card: the last Test,
/// the last diagnostics run, the fix being applied. None of it is cached
/// across visits — a diagnostics report is a snapshot of a page that changes
/// the moment Chrome is touched, and an old one on screen would be trusted
/// exactly as much as a fresh one.
class GeminiBridgeCardState {
  const GeminiBridgeCardState({
    this.busy = false,
    this.testResult,
    this.testError,
    this.diagnostics,
    this.diagnosticsLoading = false,
    this.diagnosticsError,
    this.healingElement,
    this.healError,
    this.lastHealedElement,
    this.browserInfo,
    this.browserInfoLoading = false,
    this.browserInfoError,
  });

  /// Start, Stop, Test or Open Gemini in flight — one at a time; the buttons
  /// all disable together.
  final bool busy;

  /// The last Test's answer.
  final GeminiBridgeStatus? testResult;
  final GeminiBridgeException? testError;

  final GeminiDiagnostics? diagnostics;
  final bool diagnosticsLoading;
  final GeminiBridgeException? diagnosticsError;

  /// The element whose fix is being applied, while `bridge.heal` runs.
  final String? healingElement;
  final GeminiBridgeException? healError;

  /// The element the last successful fix was for, so the panel can say so
  /// beside the re-run diagnostics.
  final String? lastHealedElement;

  /// The last "Detect browsers" answer: which browsers are on this PC and
  /// what state the add-on is in.
  final GeminiBrowserInfo? browserInfo;
  final bool browserInfoLoading;
  final GeminiBridgeException? browserInfoError;

  GeminiBridgeCardState copyWith({
    bool? busy,
    Object? testResult = _unset,
    Object? testError = _unset,
    Object? diagnostics = _unset,
    bool? diagnosticsLoading,
    Object? diagnosticsError = _unset,
    Object? healingElement = _unset,
    Object? healError = _unset,
    Object? lastHealedElement = _unset,
    Object? browserInfo = _unset,
    bool? browserInfoLoading,
    Object? browserInfoError = _unset,
  }) =>
      GeminiBridgeCardState(
        busy: busy ?? this.busy,
        testResult: testResult == _unset
            ? this.testResult
            : testResult as GeminiBridgeStatus?,
        testError: testError == _unset
            ? this.testError
            : testError as GeminiBridgeException?,
        diagnostics: diagnostics == _unset
            ? this.diagnostics
            : diagnostics as GeminiDiagnostics?,
        diagnosticsLoading: diagnosticsLoading ?? this.diagnosticsLoading,
        diagnosticsError: diagnosticsError == _unset
            ? this.diagnosticsError
            : diagnosticsError as GeminiBridgeException?,
        healingElement: healingElement == _unset
            ? this.healingElement
            : healingElement as String?,
        healError: healError == _unset
            ? this.healError
            : healError as GeminiBridgeException?,
        lastHealedElement: lastHealedElement == _unset
            ? this.lastHealedElement
            : lastHealedElement as String?,
        browserInfo: browserInfo == _unset
            ? this.browserInfo
            : browserInfo as GeminiBrowserInfo?,
        browserInfoLoading: browserInfoLoading ?? this.browserInfoLoading,
        browserInfoError: browserInfoError == _unset
            ? this.browserInfoError
            : browserInfoError as GeminiBridgeException?,
      );
}

const _unset = Object();

/// The actions behind the card's buttons. Each one talks to the bridge and
/// records the answer (or the failure) in [state]; nothing here decides how
/// it reads — that is the widget's job, with the localized strings.
class GeminiBridgeCardController extends Notifier<GeminiBridgeCardState> {
  @override
  GeminiBridgeCardState build() => const GeminiBridgeCardState();

  GeminiBridge get _bridge => ref.read(geminiBridgeProvider);

  /// Returns the failure instead of throwing so the widget can toast it.
  Future<GeminiBridgeException?> start() => _run(_bridge.ensureStarted);

  Future<GeminiBridgeException?> stop() => _run(_bridge.stop);

  Future<GeminiBridgeException?> openGemini() =>
      _run(() => _bridge.openGemini());

  /// `bridge.status`: what the daemon and the extension say about the tab.
  /// Never throws on the Python side, so a failure here is the daemon itself
  /// not being reachable — which is the answer, and is shown as such.
  Future<void> test() async {
    state = state.copyWith(busy: true, testResult: null, testError: null);
    try {
      final status = await _bridge.status();
      state = state.copyWith(busy: false, testResult: status);
    } on GeminiBridgeException catch (error) {
      state = state.copyWith(busy: false, testError: error);
    }
  }

  Future<void> runDiagnostics() async {
    state = state.copyWith(diagnosticsLoading: true, diagnosticsError: null);
    try {
      final diagnostics = await _bridge.diagnostics();
      state = state.copyWith(
        diagnosticsLoading: false,
        diagnostics: diagnostics,
      );
    } on GeminiBridgeException catch (error) {
      state = state.copyWith(
        diagnosticsLoading: false,
        diagnosticsError: error,
      );
    }
  }

  /// `bridge.browser_info` for the browser settings as saved — the daemon
  /// looks for every browser it knows, so the answer is also the list the
  /// picker shows as found / not found.
  Future<void> detectBrowsers() async {
    state = state.copyWith(browserInfoLoading: true, browserInfoError: null);
    final settings = ref.read(geminiBridgeSettingsProvider);
    try {
      final info = await _bridge.browserInfo(
        browser: settings.browser,
        browserPath: settings.browserPath,
        profileMode: settings.profileMode,
      );
      state = state.copyWith(browserInfoLoading: false, browserInfo: info);
    } on GeminiBridgeException catch (error) {
      state = state.copyWith(
        browserInfoLoading: false,
        browserInfoError: error,
      );
    }
  }

  /// Applies suggestion [pick] for [element], then re-runs diagnostics so the
  /// panel shows whether the fix took — `bridge.heal` reports what it
  /// applied, not whether the element resolves now.
  Future<void> applyFix(String element, int pick) async {
    state = state.copyWith(healingElement: element, healError: null);
    try {
      await _bridge.heal(element, pick: pick);
      state = state.copyWith(
        healingElement: null,
        lastHealedElement: element,
      );
      await runDiagnostics();
    } on GeminiBridgeException catch (error) {
      state = state.copyWith(healingElement: null, healError: error);
    }
  }

  Future<GeminiBridgeException?> _run(Future<void> Function() action) async {
    state = state.copyWith(busy: true);
    try {
      await action();
      return null;
    } on GeminiBridgeException catch (error) {
      return error;
    } finally {
      state = state.copyWith(busy: false);
    }
  }
}

final geminiBridgeCardProvider =
    NotifierProvider<GeminiBridgeCardController, GeminiBridgeCardState>(
  GeminiBridgeCardController.new,
);

/// What the daemon is doing to get a Gemini window ready.
enum GeminiWindowStep { launching, installing }

/// A [GeminiWindowStep] and the browser it is for (`firefox`, `edge`, ...).
typedef GeminiWindowActivityState = ({GeminiWindowStep step, String? browser});

/// From the daemon's `daemon` events: `browser_launching` and
/// `addon_installing` start a step; any other daemon state (`browser_ready`,
/// `extension_connected`, `failed`, `stopped`, ...) ends it. Null while the
/// daemon is doing none of that. The Settings card shows it as a status line,
/// so a window that takes a while to open does not look like nothing is
/// happening.
class GeminiWindowActivity extends Notifier<GeminiWindowActivityState?> {
  @override
  GeminiWindowActivityState? build() {
    final subscription = ref.watch(geminiBridgeProvider).events.listen(_on);
    ref.onDispose(subscription.cancel);
    return null;
  }

  void _on(GeminiEvent event) {
    if (!event.isDaemon) return;
    final browser = event.daemonBrowser;
    state = switch (event.daemonState) {
      'browser_launching' => (
          step: GeminiWindowStep.launching,
          browser: browser
        ),
      'addon_installing' => (
          step: GeminiWindowStep.installing,
          browser: browser
        ),
      _ => null,
    };
  }
}

final geminiWindowActivityProvider =
    NotifierProvider<GeminiWindowActivity, GeminiWindowActivityState?>(
  GeminiWindowActivity.new,
);
