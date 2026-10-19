import 'dart:async';
import 'dart:collection';
import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:io';
import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge_types.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';

export 'package:gratovo_toolbox/core/native/gemini_bridge_types.dart';

/// The same three variables `ScraperProcess` launches every pipeline job
/// with, for the same reasons (see `_utf8PythonEnvironment` in
/// scraper_process_io.dart): a Windows interpreter writing to a pipe would
/// otherwise emit cp1252 and block-buffer its stdout — and a daemon whose
/// protocol lines arrive 8 KB at a time is a daemon that never answers.
const _pythonEnvironment = <String, String>{
  'PYTHONUTF8': '1',
  'PYTHONIOENCODING': 'utf-8',
  'PYTHONUNBUFFERED': '1',
};

const _lenientUtf8 = Utf8Codec(allowMalformed: true);

/// The script the daemon is started through, in `pipeline/`. Not
/// `-m gemini_bridge`: the bundled interpreter's `._pth` file makes it
/// isolated, so neither the working directory nor PYTHONPATH is importable
/// and `-m` could not find the package -- the reason an installed build never
/// saw the extension while a VS Code run (system Python) did. The script puts
/// its own folder on `sys.path` first, like every other pipeline entry point.
const _launcherScript = 'run_gemini_daemon.py';

/// How long the daemon gets to print its first line before this side decides
/// the interpreter is not going to speak the protocol at all.
const _firstLineTimeout = Duration(seconds: 30);

/// A daemon whose stdout closed without a first line is exiting; this is how
/// long its exit code and last stderr lines get to arrive for the message.
const _exitDrain = Duration(seconds: 2);

/// Stderr lines kept per daemon, for the failure message when it dies before
/// speaking: a traceback's last line is the one that says why.
const _stderrTailLines = 20;

/// A daemon that has stayed up this long has earned a clean slate on the
/// restart counter — otherwise a crash every hour would eventually be the
/// sixth and turn into a permanent `failed`.
const _stableAfter = Duration(seconds: 60);

/// `stop()`: how long `bridge.shutdown` gets before the process is killed.
const _shutdownGrace = Duration(seconds: 3);

const _maxRestarts = 5;
const _maxBackoff = Duration(seconds: 30);
const _defaultCallTimeout = Duration(seconds: 60);

const _logName = 'gratovo.gemini.bridge';

/// A running daemon, as the bridge needs it: lines in, lines out, an exit
/// code, a kill switch. `Process` minus everything unused — so a test can
/// play the daemon over in-memory streams and exercise the correlation,
/// the state machine and the restart policy without an interpreter.
abstract class GeminiDaemonHandle {
  Stream<String> get stdoutLines;
  Stream<String> get stderrLines;
  Future<int> get exitCode;

  /// Writes one request line. Throws if the pipe is closed.
  void write(String line);

  void kill();
}

/// Starts a daemon. [ProcessGeminiBridge] takes one so tests can substitute
/// theirs; the default is [spawnGeminiDaemonProcess].
typedef GeminiDaemonSpawner = Future<GeminiDaemonHandle> Function({
  required String executable,
  required List<String> arguments,
  required String workingDirectory,
  required Map<String, String> environment,
});

/// The real thing: [Process.start] with the streams decoded leniently and
/// split into lines.
Future<GeminiDaemonHandle> spawnGeminiDaemonProcess({
  required String executable,
  required List<String> arguments,
  required String workingDirectory,
  required Map<String, String> environment,
}) async {
  final process = await Process.start(
    executable,
    arguments,
    workingDirectory: workingDirectory,
    environment: environment,
  );
  return _ProcessHandle(process);
}

class _ProcessHandle implements GeminiDaemonHandle {
  _ProcessHandle(this._process);

  final Process _process;

  @override
  Stream<String> get stdoutLines => _process.stdout
      .transform(_lenientUtf8.decoder)
      .transform(const LineSplitter());

  @override
  Stream<String> get stderrLines => _process.stderr
      .transform(_lenientUtf8.decoder)
      .transform(const LineSplitter());

  @override
  Future<int> get exitCode => _process.exitCode;

  @override
  void write(String line) => _process.stdin.write(line);

  @override
  void kill() => _process.kill();
}

/// The [GeminiBridge] that runs `python pipeline/run_gemini_daemon.py daemon`.
///
/// One process for the life of the app, started on first use. Requests go
/// down its stdin one JSON line each; responses and events come back up its
/// stdout, correlated by id because the daemon answers on a thread pool and
/// a three-minute draft must not hold up a status check behind it. Its
/// stderr is the daemon's log and goes to the app's own.
///
/// The interpreter and `pipeline/` folder are found exactly as
/// `ScraperProcess` finds them — read fresh at each spawn, because Settings →
/// Search Tuning can change both while the app is open.
class ProcessGeminiBridge extends GeminiBridge {
  ProcessGeminiBridge(this._ref, {GeminiDaemonSpawner? spawn})
      : _spawnDaemon = spawn ?? spawnGeminiDaemonProcess;

  final Ref _ref;
  final GeminiDaemonSpawner _spawnDaemon;

  GeminiDaemonHandle? _process;
  StreamSubscription<String>? _stdout;
  StreamSubscription<String>? _stderr;

  /// The current daemon's last [_stderrTailLines] stderr lines.
  final _stderrTail = ListQueue<String>();

  /// Calls awaiting their response, by request id.
  final _pending = <String, _PendingCall>{};
  int _nextId = 0;

  final _events = StreamController<GeminiEvent>.broadcast();
  final _stateChanges = StreamController<GeminiBridgeState>.broadcast();
  GeminiBridgeState _state = const GeminiBridgeState.stopped();

  /// The in-flight spawn, so concurrent first calls share one process
  /// instead of racing to start two.
  Completer<void>? _starting;

  int _restarts = 0;
  Timer? _restartTimer;
  Timer? _stableTimer;

  /// Set by [stop] so the exit that follows is not mistaken for a crash.
  bool _stopRequested = false;

  /// Whether `bridge.ensure_account` has succeeded on this daemon session.
  /// Reset on every spawn: a new process is a new session, and the tab may
  /// have changed accounts in between.
  bool _accountEnsured = false;

  bool _disposed = false;

  @override
  bool get isAvailable => true;

  @override
  GeminiBridgeState get state => _state;

  @override
  Stream<GeminiBridgeState> get stateChanges => _stateChanges.stream;

  @override
  Stream<GeminiEvent> get events => _events.stream;

  @override
  String? get extensionDir {
    final paths = _paths();
    if (paths == null) return null;
    return '${paths.pipelineDir}${Platform.pathSeparator}gemini_extension';
  }

  void _setState(GeminiBridgeState next) {
    _state = next;
    if (!_stateChanges.isClosed) _stateChanges.add(next);
  }

  ScraperProcessPaths? _paths() {
    final env = _ref.read(pythonEnvironmentProvider);
    final override = env.projectRootOverride.trim();
    return ScraperProcess.resolvePaths(
      projectRootOverride: override.isEmpty ? null : override,
    );
  }

  // ---- lifecycle -----------------------------------------------------------

  @override
  Future<void> ensureStarted() async {
    if (_disposed) {
      throw GeminiBridgeException.unavailable('The Gemini bridge was closed.');
    }
    if (_state.isUp) return;
    final starting = _starting;
    if (starting != null) return starting.future;
    // A previous attempt failed for good, or a restart is counting down:
    // asking again is a request to try now.
    _restartTimer?.cancel();
    _restartTimer = null;
    _stopRequested = false;
    return _spawn();
  }

  Future<void> _spawn() async {
    final completer = Completer<void>();
    _starting = completer;
    _setState(const GeminiBridgeState.starting());
    _accountEnsured = false;

    try {
      final paths = _paths();
      if (paths == null || !Directory(paths.pipelineDir).existsSync()) {
        throw GeminiBridgeException.unavailable(
          'The Python pipeline is missing: no folder at '
          '"${paths?.pipelineDir ?? 'pipeline'}". Set Settings → Search '
          'Tuning → "Project root" to the folder holding pipeline/.',
        );
      }
      final launcher =
          '${paths.pipelineDir}${Platform.pathSeparator}$_launcherScript';
      if (!File(launcher).existsSync()) {
        throw GeminiBridgeException.unavailable(
          'The Python pipeline at "${paths.pipelineDir}" has no '
          '$_launcherScript, so it is older than this app. Update that '
          'folder, or clear Settings → Search Tuning → "Project root".',
        );
      }
      final env = _ref.read(pythonEnvironmentProvider);
      final settings = _ref.read(geminiBridgeSettingsProvider);
      _stderrTail.clear();
      final process = await _spawnDaemon(
        executable: ScraperProcess.resolveInterpreter(env.pythonExecutable),
        arguments: [
          '-u',
          launcher,
          'daemon',
          '--port',
          '${settings.port}',
          // The skill files the actions prepend live in `data/gemini skills/`
          // — on an installed build that is the per-user data folder the
          // rest of the pipeline is pointed at, not `../data` beside
          // `pipeline/`, which is the install folder.
          '--data-dir',
          paths.dataDir,
        ],
        workingDirectory: paths.pipelineDir,
        environment: {
          ..._pythonEnvironment,
          'GRATOVO_DATA_DIR': paths.dataDir,
        },
      );
      _process = process;

      final firstLine = Completer<GeminiEvent?>();
      _stdout = process.stdoutLines.listen(
        (line) {
          final message = GeminiMessage.decodeLine(line);
          if (message == null) return;
          if (!firstLine.isCompleted) {
            firstLine.complete(message is GeminiEvent ? message : null);
          }
          _onMessage(message);
        },
        onError: (Object error) => developer.log(
          'Gemini daemon stdout error: $error',
          name: _logName,
          level: 900,
        ),
        // Closed without a protocol line: the process is exiting, and
        // waiting out the first-line timeout would only delay saying why.
        onDone: () {
          if (!firstLine.isCompleted) firstLine.complete(null);
        },
      );
      final stderrDone = Completer<void>();
      _stderr = process.stderrLines.listen(
        (line) {
          // The daemon's log, at info: it is chatter until something goes
          // wrong, and when something goes wrong it is the only account.
          developer.log(line, name: _logName);
          _stderrTail.addLast(line);
          if (_stderrTail.length > _stderrTailLines) _stderrTail.removeFirst();
        },
        onDone: stderrDone.complete,
      );
      unawaited(process.exitCode.then(_onExit));

      final first = await firstLine.future.timeout(
        _firstLineTimeout,
        onTimeout: () => null,
      );
      Future<int?> drainedExit() async {
        final code = await process.exitCode
            .then<int?>((code) => code)
            .timeout(_exitDrain, onTimeout: () => null);
        if (code != null) {
          await stderrDone.future.timeout(_exitDrain, onTimeout: () {});
        }
        return code;
      }

      if (first == null || !first.isDaemon) {
        final code = await drainedExit();
        _killProcess();
        throw GeminiBridgeException.unavailable(_startFailure(
          code == null
              ? 'The Gemini daemon did not announce itself within '
                  '${_firstLineTimeout.inSeconds}s'
              : 'The Gemini daemon exited before it started',
          code,
        ));
      }
      if (first.daemonState != 'listening') {
        // `port_in_use` and the like: the process exits on its own with
        // code 2 and there is nothing to restart into.
        _stopRequested = true;
        final reason = asString(first.data['reason']) ?? first.daemonState;
        throw GeminiBridgeException.unavailable(
          'The Gemini daemon could not start: $reason '
          '(port ${asInt(first.data['port']) ?? settings.port}).',
        );
      }
      if (!identical(_process, process)) {
        // Gone again before this line ran: nothing is listening, and the
        // exit was taken for a failed start rather than restarted.
        throw GeminiBridgeException.unavailable(_startFailure(
          'The Gemini daemon exited right after it started',
          await drainedExit(),
        ));
      }
      // `_onMessage` already moved the state to listening.
      _stableTimer?.cancel();
      _stableTimer = Timer(_stableAfter, () => _restarts = 0);
      completer.complete();
    } catch (error, stackTrace) {
      final failure = error is GeminiBridgeException
          ? error
          : GeminiBridgeException.unavailable('$error');
      developer.log(
        'Could not start the Gemini daemon.',
        name: _logName,
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
      _setState(GeminiBridgeState.failed(failure.message));
      completer.completeError(failure);
    } finally {
      _starting = null;
    }
    return completer.future;
  }

  void _onMessage(GeminiMessage message) {
    switch (message) {
      case GeminiResponse(:final id, :final ok, :final result, :final error):
        final pending = id == null ? null : _pending.remove(id);
        if (pending == null) {
          // The daemon's answer to a line it could not read carries no id.
          // Nothing is waiting on it by name; the caller that sent the bad
          // line times out and the log has the reason.
          developer.log(
            'Gemini daemon response with no matching request: '
            '${error?.message ?? 'ok'}',
            name: _logName,
            level: 900,
          );
          return;
        }
        pending.timer.cancel();
        if (ok) {
          pending.completer.complete(result);
        } else {
          pending.completer.completeError(
            error ??
                GeminiBridgeException(
                  code: 'UNKNOWN',
                  message: 'The Gemini bridge reported an error.',
                ),
          );
        }
      case GeminiEvent():
        _onEvent(message);
    }
  }

  /// The daemon's own `daemon` events drive [state]; the extension's `status`
  /// events refresh the page status inside a connected state. Everything is
  /// forwarded on [events] as well.
  void _onEvent(GeminiEvent event) {
    if (event.isDaemon) {
      switch (event.daemonState) {
        case 'listening':
          _setState(GeminiBridgeState.listening(
            port: asInt(event.data['port']),
          ));
        case 'extension_connected':
          _setState(GeminiBridgeState.connected(GeminiBridgeStatus(
            listening: true,
            port: _state.port,
            extensionConnected: true,
            hello: asMap(event.data['hello']),
          )));
          // The event says only that the socket opened; what is on the tab
          // (account, model, which elements resolve) takes a round trip.
          unawaited(_refreshStatus());
        case 'extension_disconnected':
          _setState(GeminiBridgeState.listening(port: _state.port));
          _accountEnsured = false;
      }
    } else if (event.isStatus && _state.isConnected) {
      final current = _state.status ?? const GeminiBridgeStatus();
      _setState(_state.withStatus(GeminiBridgeStatus(
        listening: current.listening,
        port: current.port,
        extensionConnected: true,
        hello: current.hello,
        status: GeminiPageStatus.fromJson(event.data),
      )));
    }
    if (!_events.isClosed) _events.add(event);
  }

  Future<void> _refreshStatus() async {
    try {
      final status = await this.status();
      if (_state.isConnected) _setState(_state.withStatus(status));
    } on GeminiBridgeException catch (error) {
      developer.log(
        'bridge.status after extension_connected failed: ${error.message}',
        name: _logName,
        level: 900,
      );
    }
  }

  void _onExit(int code) {
    final wasRequested = _stopRequested;
    // Dying before the first protocol line is a failed start, which `_spawn`
    // reports with the reason from stderr: the streams are left to drain for
    // that, and a restart would only repeat the failure without the reason.
    final duringStart = _starting != null;
    _process = null;
    if (!duringStart) {
      _stdout?.cancel();
      _stderr?.cancel();
      _stdout = null;
      _stderr = null;
    }
    _stableTimer?.cancel();
    _accountEnsured = false;

    final orphaned = List.of(_pending.values);
    _pending.clear();
    for (final call in orphaned) {
      call.timer.cancel();
      call.completer.completeError(GeminiBridgeException.unavailable(
        wasRequested
            ? 'The Gemini bridge was stopped.'
            : 'The Gemini daemon exited (code $code) mid-call.',
      ));
    }

    if (duringStart) return;
    if (wasRequested || _disposed) {
      // A start that failed for a stated reason (`port_in_use`, no first
      // line) killed its own process; the reason outranks "stopped".
      if (!_state.isFailed) _setState(const GeminiBridgeState.stopped());
      return;
    }

    // An unexpected exit. Come back with backoff — 1s, 2s, 4s… capped —
    // and give up after enough of them, because a daemon that dies five
    // times in a row is not going to live on the sixth and the person
    // needs to be told rather than kept waiting.
    _restarts += 1;
    if (_restarts > _maxRestarts) {
      developer.log(
        'Gemini daemon exited (code $code) $_restarts times; giving up.',
        name: _logName,
        level: 1000,
      );
      _setState(GeminiBridgeState.failed(
        'The Gemini daemon keeps exiting (last exit code $code). '
        'Check the log, then Start again.',
      ));
      return;
    }
    final delay = Duration(
      milliseconds: min(
        _maxBackoff.inMilliseconds,
        1000 * (1 << (_restarts - 1)),
      ),
    );
    developer.log(
      'Gemini daemon exited (code $code); restarting in ${delay.inSeconds}s '
      '(attempt $_restarts of $_maxRestarts).',
      name: _logName,
      level: 900,
    );
    _setState(const GeminiBridgeState.starting());
    _restartTimer = Timer(delay, () {
      _restartTimer = null;
      if (_stopRequested || _disposed || _starting != null) return;
      unawaited(_spawn().catchError((_) {}));
    });
  }

  void _killProcess() {
    final process = _process;
    if (process == null) return;
    _stopRequested = true;
    process.kill();
  }

  /// [what] went wrong, with the exit code when there is one and the last
  /// line the daemon wrote to stderr -- "No module named ...", or a
  /// traceback's last line, which is the one that says why.
  String _startFailure(String what, int? code) {
    final said = _stderrTail
        .map((line) => line.trim())
        .where((line) => line.isNotEmpty)
        .toList();
    final head = code == null ? what : '$what (exit code $code)';
    return said.isEmpty ? '$head.' : '$head: ${said.last}';
  }

  @override
  Future<void> stop() async {
    _stopRequested = true;
    _restartTimer?.cancel();
    _restartTimer = null;
    _stableTimer?.cancel();
    _restarts = 0;
    final starting = _starting;
    if (starting != null) {
      // Let the spawn finish (or fail) so there is a process to stop, rather
      // than racing it.
      try {
        await starting.future;
      } on GeminiBridgeException {
        // Nothing started; nothing to stop.
      }
    }
    final process = _process;
    if (process == null) {
      _setState(const GeminiBridgeState.stopped());
      return;
    }
    try {
      await _send('bridge.shutdown', const {}, _shutdownGrace);
    } on GeminiBridgeException {
      // The daemon may already be gone, or not answering; the kill below
      // covers both.
    }
    final exited = await process.exitCode
        .timeout(_shutdownGrace, onTimeout: () => -1)
        .then((code) => code != -1);
    if (!exited) process.kill();
    // `_onExit` moves the state to stopped once the process is actually
    // gone; a caller that awaited `stop()` sees it stopped either way.
    if (_state.phase != GeminiBridgePhase.stopped) {
      _setState(const GeminiBridgeState.stopped());
    }
  }

  /// Releases everything. Called when the provider is disposed, which for
  /// the app-wide provider means the app is going away — the daemon also
  /// exits on its own when its stdin closes with the parent.
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    unawaited(stop().catchError((_) {}));
    _events.close();
    _stateChanges.close();
  }

  // ---- calls ----------------------------------------------------------------

  @override
  Future<Map<String, Object?>> call(
    String method, [
    Map<String, Object?> params = const {},
    Duration? timeout,
  ]) async {
    await ensureStarted();
    return _send(method, params, timeout ?? _defaultCallTimeout);
  }

  /// Writes one request and waits for its response — without starting the
  /// daemon, which is what makes it usable from [stop].
  Future<Map<String, Object?>> _send(
    String method,
    Map<String, Object?> params,
    Duration timeout,
  ) {
    final process = _process;
    if (process == null || !_state.isUp) {
      throw GeminiBridgeException.unavailable(
        _state.message ?? 'The Gemini daemon is not running.',
      );
    }
    final id = 'r${++_nextId}';
    final completer = Completer<Map<String, Object?>>();
    final timer = Timer(timeout, () {
      final pending = _pending.remove(id);
      if (pending == null) return;
      pending.completer.completeError(GeminiBridgeException(
        code: 'TIMEOUT',
        message: '$method did not answer within ${timeout.inSeconds}s.',
        details: {'phase': 'app', 'elapsedMs': timeout.inMilliseconds},
        failure: GeminiFailure.timeout,
      ));
    });
    _pending[id] = _PendingCall(completer, timer);
    try {
      process.write(
        GeminiRequest(id: id, method: method, params: params).encode(),
      );
    } catch (error) {
      // A closed pipe: the process is on its way out and `_onExit` will
      // settle whatever else is pending.
      _pending.remove(id)?.timer.cancel();
      throw GeminiBridgeException.unavailable(
        'Could not write to the Gemini daemon: $error',
      );
    }
    return completer.future;
  }

  /// The window-opening in flight, shared so two actions starting together
  /// open one window, not two.
  Future<void>? _openingWindow;

  @override
  Future<void> prepareForAction() async {
    await ensureStarted();
    final settings = _ref.read(geminiBridgeSettingsProvider);
    if (!_state.isConnected && settings.autoOpenWindow) {
      await (_openingWindow ??=
          _openWindow(settings).whenComplete(() => _openingWindow = null));
    }
    if (!settings.hasAccountMatch || _accountEnsured) return;
    await ensureAccount(settings.accountMatch.trim());
    _accountEnsured = true;
  }
}

extension on ProcessGeminiBridge {
  /// No extension is connected and Settings says to open a window: the daemon
  /// launches the browser, installs the add-on and opens Gemini in the
  /// background. What it could not do comes back as "not connected" with the
  /// daemon's own sentence about what is missing.
  Future<void> _openWindow(GeminiBridgeSettings settings) async {
    final result = await ensureWindow(
      browser: settings.browser,
      browserPath: settings.browserPath,
      profileMode: settings.profileMode,
      timeout: const Duration(seconds: 60),
    );
    if (result.connected) return;
    throw GeminiBridgeException(
      code: 'EXTENSION_NOT_CONNECTED',
      message: result.message.isEmpty
          ? 'The Gemini window could not be opened.'
          : result.message,
      failure: GeminiFailure.extensionNotConnected,
    );
  }
}

class _PendingCall {
  _PendingCall(this.completer, this.timer);

  final Completer<Map<String, Object?>> completer;
  final Timer timer;
}

/// The one bridge the app shares. Overridable in tests with a fake.
final geminiBridgeProvider = Provider<GeminiBridge>((ref) {
  final bridge = ProcessGeminiBridge(ref);
  ref.onDispose(bridge.dispose);
  return bridge;
});

final geminiBridgeStateProvider =
    NotifierProvider<GeminiBridgeStateNotifier, GeminiBridgeState>(
  () => GeminiBridgeStateNotifier((ref) => ref.watch(geminiBridgeProvider)),
);
