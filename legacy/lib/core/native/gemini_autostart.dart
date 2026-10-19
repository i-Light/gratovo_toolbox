import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';

/// Brings the Gemini bridge up in the background when the app starts, so
/// "Gemini connected" is already true by the time anybody asks for it, and
/// keeps it that way.
///
/// The app shell watches this once, alongside the other boot-time services.
/// With `autoStart` on it starts the daemon a moment after launch (the first
/// frames belong to the UI); with `autoOpenWindow` on, when no extension has
/// connected shortly after, it asks the daemon to open the Gemini window —
/// for Firefox that launches the app's own Firefox and installs the add-on —
/// without taking the focus. When a connected extension goes away (the window
/// was closed, the browser crashed) it opens it again, with a growing pause
/// so a person who closed it on purpose is not fought every few seconds.
///
/// It never blocks the UI and never throws: a bridge that cannot come up is a
/// state the Settings card reports, not a crash at launch.
final geminiAutoStartProvider = Provider<void>((ref) {
  final bridge = ref.watch(geminiBridgeProvider);
  if (!bridge.isAvailable) return;
  final supervisor = GeminiAutoStart(
    bridge: bridge,
    settings: () => ref.read(geminiBridgeSettingsProvider),
    settingsReady: () => ref.read(geminiBridgeSettingsProvider.notifier).ready,
  );
  ref.listen(
    geminiBridgeSettingsProvider.select((s) => (s.autoStart, s.autoOpenWindow)),
    (previous, next) => supervisor.settingsChanged(),
  );
  ref.onDispose(supervisor.dispose);
  supervisor.start();
});

class GeminiAutoStart {
  GeminiAutoStart({
    required this.bridge,
    required this.settings,
    required this.settingsReady,
    this.startDelay = const Duration(seconds: 2),
    this.connectGrace = const Duration(seconds: 5),
    this.reopenDelays = const [
      Duration(seconds: 20),
      Duration(minutes: 1),
      Duration(minutes: 3),
      Duration(minutes: 10),
    ],
  });

  final GeminiBridge bridge;
  final GeminiBridgeSettings Function() settings;
  final Future<void> Function() settingsReady;

  /// How long after launch the daemon is started.
  final Duration startDelay;

  /// How long an extension that is already open in some browser gets to
  /// connect on its own before a window is opened for it.
  final Duration connectGrace;

  /// The pauses before re-opening a window that went away; the last one
  /// repeats. A successful connection starts the list over.
  final List<Duration> reopenDelays;

  Timer? _timer;
  StreamSubscription<GeminiBridgeState>? _states;
  bool _disposed = false;
  bool _busy = false;
  bool _wasConnected = false;
  int _reopenAttempt = 0;

  void start() => unawaited(_boot());

  Future<void> _boot() async {
    try {
      await settingsReady();
    } catch (_) {
      // Unreadable prefs: the defaults stand.
    }
    if (_disposed) return;
    _states ??= bridge.stateChanges.listen(_onState);
    // The stream only reports changes: a connection that was already up when
    // the supervisor started is one that can go away too.
    if (bridge.state.isConnected) _wasConnected = true;
    if (!settings().autoStart) return;
    _schedule(startDelay, _bringUp);
  }

  /// Settings' switches changed: turning auto-start on brings the bridge up
  /// now; turning either off just stops scheduling (nothing is torn down).
  void settingsChanged() {
    if (_disposed) return;
    final s = settings();
    if (!s.autoStart && !s.autoOpenWindow) {
      _timer?.cancel();
      return;
    }
    if (s.autoStart && !bridge.state.isConnected) {
      _schedule(Duration.zero, _bringUp);
    }
  }

  void _onState(GeminiBridgeState next) {
    if (next.isConnected) {
      _wasConnected = true;
      _reopenAttempt = 0;
      _timer?.cancel();
      return;
    }
    // Only a connection that existed and went away is re-opened here; a
    // daemon that is merely listening at launch is _bringUp's business.
    if (_wasConnected && next.isListening && settings().autoOpenWindow) {
      _wasConnected = false;
      final delays = reopenDelays;
      final delay = delays[_reopenAttempt.clamp(0, delays.length - 1)];
      _reopenAttempt += 1;
      _schedule(delay, _openWindowIfNeeded);
    }
  }

  void _schedule(Duration delay, Future<void> Function() job) {
    _timer?.cancel();
    if (_disposed) return;
    _timer = Timer(delay, () => unawaited(job()));
  }

  Future<void> _bringUp() async {
    if (_disposed) return;
    try {
      await bridge.ensureStarted();
    } catch (error) {
      _log('daemon did not start: $error');
      return;
    }
    if (bridge.state.isConnected || !settings().autoOpenWindow) return;
    // An extension already open in a browser reconnects on its own within a
    // few seconds of the daemon coming up; opening a window before then would
    // start a second browser for nothing.
    await _waitForConnection(connectGrace);
    await _openWindowIfNeeded();
  }

  Future<void> _waitForConnection(Duration grace) async {
    if (bridge.state.isConnected) return;
    try {
      await bridge.stateChanges.firstWhere((s) => s.isConnected).timeout(grace);
    } catch (_) {
      // Timed out, or the stream closed: the caller looks at the state.
    }
  }

  Future<void> _openWindowIfNeeded() async {
    if (_disposed || _busy || bridge.state.isConnected) return;
    final s = settings();
    if (!s.autoOpenWindow) return;
    _busy = true;
    try {
      final result = await bridge.ensureWindow(
        browser: s.browser,
        browserPath: s.browserPath,
        profileMode: s.profileMode,
        timeout: const Duration(seconds: 60),
      );
      if (!result.connected) {
        _log('Gemini window not connected: ${result.message}');
      }
    } catch (error) {
      _log('opening the Gemini window failed: $error');
    } finally {
      _busy = false;
    }
  }

  void _log(String message) =>
      developer.log(message, name: 'gratovo.gemini.autostart');

  void dispose() {
    _disposed = true;
    _timer?.cancel();
    unawaited(_states?.cancel());
  }
}
