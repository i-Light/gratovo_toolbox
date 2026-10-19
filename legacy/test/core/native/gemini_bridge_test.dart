import 'dart:async';
import 'dart:convert';
import 'dart:io' show Directory, Platform;

import 'package:fake_async/fake_async.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge_io.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../support/fake_gemini_bridge.dart';

/// A daemon played from the test: the bridge writes requests here and the
/// test answers on stdout, exits, or stays silent.
class _FakeDaemon implements GeminiDaemonHandle {
  final _stdout = StreamController<String>();
  final _stderr = StreamController<String>();
  final _exit = Completer<int>();

  /// Every request line the bridge wrote, decoded.
  final requests = <Map<String, Object?>>[];
  bool killed = false;

  @override
  Stream<String> get stdoutLines => _stdout.stream;

  @override
  Stream<String> get stderrLines => _stderr.stream;

  @override
  Future<int> get exitCode => _exit.future;

  @override
  void write(String line) {
    if (_exit.isCompleted) throw StateError('stdin is closed');
    requests.add(jsonDecode(line.trim()) as Map<String, Object?>);
  }

  @override
  void kill() {
    killed = true;
    exit(-9);
  }

  void emit(Map<String, Object?> json) => _stdout.add(jsonEncode(json));

  void emitRaw(String line) => _stdout.add(line);

  void stderrLine(String line) => _stderr.add(line);

  void listening({int port = 8765}) => emit({
        'type': 'event',
        'event': 'daemon',
        'data': {'state': 'listening', 'port': port, 'pid': 1},
      });

  void respond(String id, Map<String, Object?> result) => emit({
        'type': 'response',
        'id': id,
        'ok': true,
        'result': result,
      });

  void respondError(String id, String code, String message) => emit({
        'type': 'response',
        'id': id,
        'ok': false,
        'error': {'code': code, 'message': message, 'details': {}},
      });

  void exit(int code) {
    if (_exit.isCompleted) return;
    _exit.complete(code);
    _stdout.close();
    _stderr.close();
  }

  /// The id of the [n]th request with [method].
  String idOf(String method, {int n = 0}) =>
      requests.where((r) => r['method'] == method).elementAt(n)['id']!
          as String;
}

/// A container holding a [ProcessGeminiBridge] whose daemons come from
/// [spawned] — one new fake per spawn, so a restart gets a fresh one.
({
  ProviderContainer container,
  ProcessGeminiBridge bridge,
  List<_FakeDaemon> spawned,
  List<Map<String, Object?>> spawnArgs
}) _harness({GeminiBridgeSettings? settings, bool spawnFails = false}) {
  final spawned = <_FakeDaemon>[];
  final spawnArgs = <Map<String, Object?>>[];
  Future<GeminiDaemonHandle> spawn({
    required String executable,
    required List<String> arguments,
    required String workingDirectory,
    required Map<String, String> environment,
  }) async {
    spawnArgs.add({
      'executable': executable,
      'arguments': arguments,
      'workingDirectory': workingDirectory,
      'environment': environment,
    });
    if (spawnFails) throw StateError('No such file: python');
    final daemon = _FakeDaemon();
    spawned.add(daemon);
    return daemon;
  }

  final bridgeProvider = Provider<ProcessGeminiBridge>(
      (ref) => ProcessGeminiBridge(ref, spawn: spawn));
  final container = ProviderContainer(overrides: [
    if (settings != null)
      geminiBridgeSettingsProvider.overrideWith(() => _FixedSettings(settings)),
  ]);
  return (
    container: container,
    bridge: container.read(bridgeProvider),
    spawned: spawned,
    spawnArgs: spawnArgs,
  );
}

class _FixedSettings extends GeminiBridgeSettingsNotifier {
  _FixedSettings(this._settings);
  final GeminiBridgeSettings _settings;

  @override
  GeminiBridgeSettings build() => _settings;
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('the typed helpers spell out the daemon contract', () {
    late FakeGeminiBridge bridge;
    setUp(() => bridge = FakeGeminiBridge());

    test('status / diagnostics / ensureAccount / heal / open', () async {
      bridge.answer('bridge.status', {'listening': true, 'port': 8765});
      bridge.answer('diagnostics', {'url': 'u', 'elements': {}});
      bridge.answer(
          'bridge.ensure_account', {'name': 'M', 'email': 'm@x', 'index': 1});
      bridge.answer('bridge.heal', {
        'element': 'newChat',
        'strategy': {'type': 'css', 'value': 'b'},
      });
      bridge.answer('open', {'tabId': 3});

      expect((await bridge.status()).port, 8765);
      expect((await bridge.diagnostics()).url, 'u');
      expect((await bridge.ensureAccount('m')).index, 1);
      expect((await bridge.heal('newChat', pick: 2)).strategy['value'], 'b');
      await bridge.openGemini();

      expect(bridge.calls.map((c) => c.method), [
        'bridge.status',
        'diagnostics',
        'bridge.ensure_account',
        'bridge.heal',
        'open',
      ]);
      expect(bridge.lastCall('bridge.ensure_account')!.params, {'match': 'm'});
      expect(bridge.lastCall('bridge.heal')!.params,
          {'element': 'newChat', 'pick': 2});
      expect(bridge.lastCall('open')!.params, {'focus': true});
    });

    test('classifyChannel prepares the account, then sends gem and model',
        () async {
      bridge.answer('action.classify_channel', {'niche': 'n', 'brandFit': 3});
      await bridge.classifyChannel(
        channel: const {'handle': '@x'},
        niche: 'AI',
        gem: 'https://gemini.google.com/gem/abc',
        model: 'Pro',
      );
      expect(bridge.prepareCount, 1);
      expect(bridge.lastCall('action.classify_channel')!.params, {
        'channel': {'handle': '@x'},
        'niche': 'AI',
        'gem': 'https://gemini.google.com/gem/abc',
        'model': 'Pro',
        'newChat': true,
        'timeoutS': 240,
      });
    });

    test('blank gem and model are left out so the daemon defaults apply',
        () async {
      bridge.answer('action.classify_channel', {'niche': 'n', 'brandFit': 3});
      await bridge.classifyChannel(
        channel: const {'handle': '@x'},
        niche: 'AI',
        gem: '  ',
        model: '',
      );
      final params = bridge.lastCall('action.classify_channel')!.params;
      expect(params.containsKey('gem'), isFalse);
      expect(params.containsKey('model'), isFalse);
    });

    test('generateKeywords', () async {
      bridge.answer('action.generate_keywords', {
        'keywords': ['a', 'b'],
        'dropped': 1,
      });
      final result = await bridge.generateKeywords(
        topic: 'AI coding tools',
        count: 50,
        exclusions: const ['music'],
        styles: const ['how to', 'vs'],
        language: 'en',
        avoid: const ['old one'],
      );
      expect(result.keywords, ['a', 'b']);
      expect(bridge.lastCall('action.generate_keywords')!.params, {
        'topic': 'AI coding tools',
        'count': 50,
        'exclusions': ['music'],
        'styles': ['how to', 'vs'],
        'language': 'en',
        'avoid': ['old one'],
        'newChat': true,
        'timeoutS': 240,
      });
    });

    test('classifyChannel', () async {
      bridge.answer('action.classify_channel', {'niche': 'n', 'brandFit': 3});
      final classified = await bridge.classifyChannel(
        channel: const {'handle': '@x'},
        niche: 'AI',
      );
      expect(classified.brandFit, 3);
      expect(bridge.lastCall('action.classify_channel')!.params, {
        'channel': {'handle': '@x'},
        'niche': 'AI',
        'newChat': true,
        'timeoutS': 240,
      });
    });

    test('a scripted failure is thrown as the typed exception', () async {
      bridge.failWith('action.classify_channel', 'ACTION_PARSE_FAILED', 'bad',
          details: {'raw': 'garbage'});
      await expectLater(
        bridge.classifyChannel(channel: const {'handle': '@x'}, niche: 'AI'),
        throwsA(isA<GeminiBridgeException>()
            .having(
                (e) => e.failure, 'failure', GeminiFailure.actionParseFailed)
            .having((e) => e.details['raw'], 'raw', 'garbage')),
      );
    });
  });

  group('ProcessGeminiBridge', () {
    test('spawns the daemon with the documented command line', () async {
      final h = _harness(settings: const GeminiBridgeSettings(port: 9001));
      addTearDown(h.container.dispose);
      final started = h.bridge.ensureStarted();
      await Future<void>.delayed(Duration.zero);
      expect(h.bridge.state.isStarting, isTrue);
      h.spawned.single.listening(port: 9001);
      await started;

      expect(h.bridge.state.isListening, isTrue);
      expect(h.bridge.state.port, 9001);
      final args = h.spawnArgs.single;
      final arguments = args['arguments']! as List<String>;
      // The launcher script, never `-m gemini_bridge`: the bundled runtime is
      // isolated and cannot import a package from the working directory.
      expect(arguments.first, '-u');
      expect(arguments, isNot(contains('-m')));
      expect(arguments[1], endsWith('run_gemini_daemon.py'));
      expect(arguments[1], startsWith(args['workingDirectory']! as String));
      expect(arguments.sublist(2, 5), ['daemon', '--port', '9001']);
      expect(arguments[5], '--data-dir');
      expect(args['workingDirectory']! as String, endsWith('pipeline'));
      final env = args['environment']! as Map<String, String>;
      expect(env['PYTHONUTF8'], '1');
      expect(env['PYTHONUNBUFFERED'], '1');
      expect(env['GRATOVO_DATA_DIR'], isNotEmpty);
      expect(h.bridge.extensionDir, endsWith('gemini_extension'));
    });

    test('correlates responses by id, out of order', () async {
      final h = _harness();
      addTearDown(h.container.dispose);
      final first = h.bridge.call('bridge.status');
      await Future<void>.delayed(Duration.zero);
      final daemon = h.spawned.single;
      daemon.listening();
      await Future<void>.delayed(Duration.zero);
      final second = h.bridge.call('diagnostics', {'x': 1});
      await Future<void>.delayed(Duration.zero);

      expect(daemon.requests.length, 2);
      expect(daemon.requests[0]['method'], 'bridge.status');
      expect(daemon.requests[1]['params'], {'x': 1});

      // The later request is answered first.
      daemon.respond(daemon.idOf('diagnostics'), {'url': 'u'});
      daemon.respond(daemon.idOf('bridge.status'), {'listening': true});
      expect(await second, {'url': 'u'});
      expect(await first, {'listening': true});
    });

    test('an ok:false response throws the typed error', () async {
      final h = _harness();
      addTearDown(h.container.dispose);
      final call = h.bridge.call('status');
      await Future<void>.delayed(Duration.zero);
      final daemon = h.spawned.single..listening();
      await Future<void>.delayed(Duration.zero);
      daemon.respondError(
          daemon.idOf('status'), 'EXTENSION_NOT_CONNECTED', 'none');
      await expectLater(
        call,
        throwsA(isA<GeminiBridgeException>().having(
            (e) => e.failure, 'failure', GeminiFailure.extensionNotConnected)),
      );
    });

    test('extension events move the state between listening and connected',
        () async {
      final h = _harness();
      addTearDown(h.container.dispose);
      final states = <GeminiBridgePhase>[];
      h.bridge.stateChanges.listen((s) => states.add(s.phase));
      final started = h.bridge.ensureStarted();
      await Future<void>.delayed(Duration.zero);
      final daemon = h.spawned.single..listening();
      await started;

      daemon.emit({
        'type': 'event',
        'event': 'daemon',
        'data': {
          'state': 'extension_connected',
          'hello': {'extensionVersion': '0.1.0'},
        },
      });
      await Future<void>.delayed(Duration.zero);
      expect(h.bridge.state.isConnected, isTrue);
      expect(h.bridge.state.status!.extensionVersion, '0.1.0');
      // The bridge asks for the full status straight away…
      expect(daemon.requests.last['method'], 'bridge.status');
      daemon.respond(daemon.idOf('bridge.status'), {
        'listening': true,
        'port': 8765,
        'extensionConnected': true,
        'status': {
          'account': {'name': 'M', 'email': 'm@x'},
          'model': {'name': 'Pro'},
        },
      });
      await Future<void>.delayed(Duration.zero);
      expect(h.bridge.state.account!.label, 'M (m@x)');
      expect(h.bridge.state.modelName, 'Pro');

      // …and a `status` event refreshes what it holds.
      daemon.emit({
        'type': 'event',
        'event': 'status',
        'data': {
          'account': {'name': 'M', 'email': 'm@x'},
          'model': {'name': 'Flash'},
          'generating': true,
        },
      });
      await Future<void>.delayed(Duration.zero);
      expect(h.bridge.state.modelName, 'Flash');
      expect(h.bridge.state.status!.status!.generating, isTrue);

      daemon.emit({
        'type': 'event',
        'event': 'daemon',
        'data': {'state': 'extension_disconnected'},
      });
      await Future<void>.delayed(Duration.zero);
      expect(h.bridge.state.isListening, isTrue);
      expect(states, [
        GeminiBridgePhase.starting,
        GeminiBridgePhase.listening,
        GeminiBridgePhase.connected,
        GeminiBridgePhase.connected,
        GeminiBridgePhase.connected,
        GeminiBridgePhase.listening,
      ]);
    });

    test('non-protocol lines on stdout are ignored', () async {
      final h = _harness();
      addTearDown(h.container.dispose);
      final started = h.bridge.ensureStarted();
      await Future<void>.delayed(Duration.zero);
      final daemon = h.spawned.single;
      daemon.emitRaw('DeprecationWarning: something');
      daemon.emitRaw('');
      daemon.listening();
      await started;
      expect(h.bridge.state.isListening, isTrue);
    });

    test('a failed first line (port in use) is a failed state, no restart',
        () async {
      final h = _harness();
      addTearDown(h.container.dispose);
      final started = h.bridge.ensureStarted();
      await Future<void>.delayed(Duration.zero);
      final daemon = h.spawned.single;
      daemon.emit({
        'type': 'event',
        'event': 'daemon',
        'data': {'state': 'failed', 'reason': 'port_in_use', 'port': 8765},
      });
      await expectLater(
        started,
        throwsA(isA<GeminiBridgeException>()
            .having((e) => e.failure, 'failure', GeminiFailure.unavailable)
            .having((e) => e.message, 'message', contains('port_in_use'))),
      );
      expect(h.bridge.state.isFailed, isTrue);
      daemon.exit(2);
      await Future<void>.delayed(Duration.zero);
      expect(h.bridge.state.isFailed, isTrue);
      expect(h.spawned.length, 1);
    });

    test('a spawn that throws is a failed state naming the error', () async {
      final h = _harness(spawnFails: true);
      addTearDown(h.container.dispose);
      await expectLater(
        h.bridge.call('status'),
        throwsA(isA<GeminiBridgeException>()
            .having((e) => e.message, 'message', contains('No such file'))),
      );
      expect(h.bridge.state.isFailed, isTrue);
      expect(h.bridge.state.message, contains('No such file'));
    });

    test(
        'a daemon that exits before its first line fails at once with its '
        'stderr, and is not restarted', () {
      fakeAsync((async) {
        final h = _harness();
        addTearDown(h.container.dispose);
        Object? failure;
        h.bridge.ensureStarted().catchError((Object e) => failure = e);
        async.flushMicrotasks();
        h.spawned.single
          ..stderrLine(r'C:\app\pyruntime\python.exe: No module named '
              'gemini_bridge')
          ..stderrLine('')
          ..exit(1);
        async.flushMicrotasks();

        // Well inside the 30 s first-line timeout.
        expect(failure, isA<GeminiBridgeException>());
        final message = (failure! as GeminiBridgeException).message;
        expect(message, contains('exited before it started (exit code 1)'));
        expect(message, contains('No module named gemini_bridge'));
        expect(h.bridge.state.isFailed, isTrue);
        expect(h.bridge.state.message, message);

        async.elapse(const Duration(minutes: 1));
        expect(h.spawned.length, 1);
        expect(h.bridge.state.isFailed, isTrue);
      });
    });

    test('a daemon that exits right after announcing itself is a failed start',
        () {
      fakeAsync((async) {
        final h = _harness();
        addTearDown(h.container.dispose);
        Object? failure;
        h.bridge.ensureStarted().catchError((Object e) => failure = e);
        async.flushMicrotasks();
        h.spawned.single
          ..listening()
          ..stderrLine('Traceback (most recent call last):')
          ..stderrLine('OSError: boom')
          ..exit(1);
        async.flushMicrotasks();
        async.elapse(const Duration(seconds: 5));

        expect(failure, isA<GeminiBridgeException>());
        expect(h.bridge.state.isFailed, isTrue);
        expect(h.bridge.state.message, contains('right after it started'));
        expect(h.bridge.state.message, contains('OSError: boom'));
        expect(h.spawned.length, 1);

        // Asking again is a fresh attempt.
        h.bridge.ensureStarted().catchError((_) {});
        async.flushMicrotasks();
        expect(h.spawned.length, 2);
      });
    });

    test('a daemon that stays silent fails after the first-line timeout', () {
      fakeAsync((async) {
        final h = _harness();
        addTearDown(h.container.dispose);
        Object? failure;
        h.bridge.ensureStarted().catchError((Object e) => failure = e);
        async.flushMicrotasks();
        h.spawned.single.stderrLine('still importing...');
        async.elapse(const Duration(seconds: 29));
        expect(failure, isNull);
        async.elapse(const Duration(seconds: 4));
        async.flushMicrotasks();

        expect(
            h.bridge.state.message,
            'The Gemini daemon did not announce itself within 30s: '
            'still importing...');
        expect(h.spawned.single.killed, isTrue);
      });
    });

    test('an unexpected exit fails pending calls and restarts with backoff',
        () {
      fakeAsync((async) {
        final h = _harness();
        addTearDown(h.container.dispose);
        var started = false;
        h.bridge.ensureStarted().then((_) => started = true);
        async.flushMicrotasks();
        h.spawned.single.listening();
        async.flushMicrotasks();
        expect(started, isTrue);
        expect(h.bridge.state.isListening, isTrue);

        Object? pendingError;
        h.bridge.call('status').catchError((Object e) {
          pendingError = e;
          return <String, Object?>{};
        });
        async.flushMicrotasks();
        h.spawned.single.exit(1);
        async.flushMicrotasks();
        expect(pendingError, isA<GeminiBridgeException>());
        expect(h.bridge.state.isStarting, isTrue);
        expect(h.spawned.length, 1);

        // 1s later: the second daemon.
        async.elapse(const Duration(milliseconds: 999));
        expect(h.spawned.length, 1);
        async.elapse(const Duration(milliseconds: 1));
        async.flushMicrotasks();
        expect(h.spawned.length, 2);
        h.spawned[1].listening();
        async.flushMicrotasks();
        expect(h.bridge.state.isListening, isTrue);

        // Dies again: 2s this time.
        h.spawned[1].exit(1);
        async.flushMicrotasks();
        async.elapse(const Duration(milliseconds: 1999));
        expect(h.spawned.length, 2);
        async.elapse(const Duration(milliseconds: 1));
        async.flushMicrotasks();
        expect(h.spawned.length, 3);
        h.spawned[2].listening();
        async.flushMicrotasks();

        // Third, fourth, fifth deaths: 4s, 8s, 16s. The sixth gives up.
        for (final (i, wait) in const [(2, 4), (3, 8), (4, 16)]) {
          h.spawned[i].exit(1);
          async.flushMicrotasks();
          async.elapse(Duration(seconds: wait));
          async.flushMicrotasks();
          expect(h.spawned.length, i + 2);
          h.spawned[i + 1].listening();
          async.flushMicrotasks();
        }
        expect(h.spawned.length, 6);
        h.spawned[5].exit(1);
        async.flushMicrotasks();
        expect(h.bridge.state.isFailed, isTrue);
        expect(h.bridge.state.message, contains('keeps exiting'));
        async.elapse(const Duration(minutes: 1));
        expect(h.spawned.length, 6);

        // Asking again after a failure is a fresh attempt.
        h.bridge.ensureStarted().catchError((_) {});
        async.flushMicrotasks();
        expect(h.spawned.length, 7);
      });
    });

    test('a call that outlives its timeout fails with TIMEOUT', () {
      fakeAsync((async) {
        final h = _harness();
        addTearDown(h.container.dispose);
        h.bridge.ensureStarted();
        async.flushMicrotasks();
        h.spawned.single.listening();
        async.flushMicrotasks();

        Object? error;
        h.bridge
            .call('status', const {}, const Duration(seconds: 5))
            .catchError((Object e) {
          error = e;
          return <String, Object?>{};
        });
        async.elapse(const Duration(seconds: 4));
        expect(error, isNull);
        async.elapse(const Duration(seconds: 1));
        expect(
          error,
          isA<GeminiBridgeException>()
              .having((e) => e.failure, 'failure', GeminiFailure.timeout),
        );
      });
    });

    test('stop sends bridge.shutdown, then kills after the grace period', () {
      fakeAsync((async) {
        final h = _harness();
        addTearDown(h.container.dispose);
        h.bridge.ensureStarted();
        async.flushMicrotasks();
        final daemon = h.spawned.single..listening();
        async.flushMicrotasks();

        var stopped = false;
        h.bridge.stop().then((_) => stopped = true);
        async.flushMicrotasks();
        expect(daemon.requests.last['method'], 'bridge.shutdown');
        expect(daemon.killed, isFalse);
        // No answer, no exit: three seconds later it is killed.
        async.elapse(const Duration(seconds: 3));
        async.flushMicrotasks();
        async.elapse(const Duration(seconds: 3));
        async.flushMicrotasks();
        expect(daemon.killed, isTrue);
        expect(stopped, isTrue);
        expect(h.bridge.state.isStopped, isTrue);
        // A requested exit does not restart.
        async.elapse(const Duration(minutes: 1));
        expect(h.spawned.length, 1);
      });
    });

    test('a daemon that answers shutdown and exits is stopped cleanly', () {
      fakeAsync((async) {
        final h = _harness();
        addTearDown(h.container.dispose);
        h.bridge.ensureStarted();
        async.flushMicrotasks();
        final daemon = h.spawned.single..listening();
        async.flushMicrotasks();
        h.bridge.stop();
        async.flushMicrotasks();
        daemon.respond(daemon.idOf('bridge.shutdown'), {'ok': true});
        daemon.exit(0);
        async.flushMicrotasks();
        expect(daemon.killed, isFalse);
        expect(h.bridge.state.isStopped, isTrue);
      });
    });

    test('prepareForAction ensures the configured account once per session',
        () async {
      final h = _harness(
        settings: const GeminiBridgeSettings(
          accountMatch: 'moustafa',
          autoOpenWindow: false,
        ),
      );
      addTearDown(h.container.dispose);
      final prepared = h.bridge.prepareForAction();
      await Future<void>.delayed(Duration.zero);
      final daemon = h.spawned.single..listening();
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      expect(daemon.requests.last['method'], 'bridge.ensure_account');
      expect(daemon.requests.last['params'], {'match': 'moustafa'});
      daemon.respond(daemon.idOf('bridge.ensure_account'),
          {'name': 'Moustafa', 'email': 'm@x', 'index': 1});
      await prepared;

      await h.bridge.prepareForAction();
      expect(
        daemon.requests.where((r) => r['method'] == 'bridge.ensure_account'),
        hasLength(1),
      );
    });

    test('prepareForAction does nothing extra with no account match', () async {
      final h = _harness(
        settings: const GeminiBridgeSettings(autoOpenWindow: false),
      );
      addTearDown(h.container.dispose);
      final prepared = h.bridge.prepareForAction();
      await Future<void>.delayed(Duration.zero);
      h.spawned.single.listening();
      await prepared;
      expect(h.spawned.single.requests, isEmpty);
    });

    test(
        'prepareForAction opens the window in the background when none is '
        'connected, once for two actions', () async {
      final h = _harness();
      addTearDown(h.container.dispose);
      final first = h.bridge.prepareForAction();
      final second = h.bridge.prepareForAction();
      await Future<void>.delayed(Duration.zero);
      final daemon = h.spawned.single..listening();
      for (var i = 0; i < 4; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      final opens =
          daemon.requests.where((r) => r['method'] == 'bridge.ensure_window');
      expect(opens, hasLength(1));
      final params = opens.single['params'] as Map;
      expect(params['focus'], false);
      expect(params['browser'], 'firefox');
      daemon.respond(daemon.idOf('bridge.ensure_window'), {
        'connected': true,
        'launched': true,
        'reused': false,
        'browser': 'firefox',
        'steps': const [],
        'message': '',
      });
      await Future.wait([first, second]);
    });

    test(
        'prepareForAction fails as "not connected" with the daemon\'s reason '
        'when the window could not connect', () async {
      final h = _harness();
      addTearDown(h.container.dispose);
      final prepared = h.bridge.prepareForAction();
      await Future<void>.delayed(Duration.zero);
      final daemon = h.spawned.single..listening();
      for (var i = 0; i < 4; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      daemon.respond(daemon.idOf('bridge.ensure_window'), {
        'connected': false,
        'launched': false,
        'reused': false,
        'browser': 'firefox',
        'steps': const [],
        'message': 'Firefox was not found',
      });
      await expectLater(
        prepared,
        throwsA(isA<GeminiBridgeException>()
            .having((e) => e.failure, 'failure',
                GeminiFailure.extensionNotConnected)
            .having((e) => e.message, 'message', 'Firefox was not found')),
      );
    });

    test('geminiBridgeStateProvider mirrors the bridge', () async {
      final spawned = <_FakeDaemon>[];
      final container = ProviderContainer(overrides: [
        geminiBridgeProvider.overrideWith((ref) => ProcessGeminiBridge(
              ref,
              spawn: ({
                required executable,
                required arguments,
                required workingDirectory,
                required environment,
              }) async {
                final d = _FakeDaemon();
                spawned.add(d);
                return d;
              },
            )),
      ]);
      addTearDown(container.dispose);
      expect(container.read(geminiBridgeStateProvider).isStopped, isTrue);
      final started = container.read(geminiBridgeProvider).ensureStarted();
      await Future<void>.delayed(Duration.zero);
      spawned.single.listening();
      await started;
      await Future<void>.delayed(Duration.zero);
      expect(container.read(geminiBridgeStateProvider).isListening, isTrue);
    });
  });

  group('GeminiBridgeSettings', () {
    test('defaults', () {
      const settings = GeminiBridgeSettings();
      expect(settings.port, 8765);
      expect(settings.hasAccountMatch, isFalse);
      expect(settings.keywordsGemOrNull, isNull);
      expect(settings.defaultModelOrNull, 'Pro');
    });

    test('persist and reload', () async {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      await container.read(geminiBridgeSettingsProvider.notifier).update(
            const GeminiBridgeSettings(
              port: 9000,
              accountMatch: 'me@x',
              keywordsGem: 'https://gemini.google.com/gem/k',
              defaultModel: 'Pro',
            ),
          );
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getInt('gratovo.gemini.port'), 9000);
      expect(prefs.getString('gratovo.gemini.accountMatch'), 'me@x');

      final fresh = ProviderContainer();
      addTearDown(fresh.dispose);
      fresh.read(geminiBridgeSettingsProvider);
      await Future<void>.delayed(Duration.zero);
      final loaded = fresh.read(geminiBridgeSettingsProvider);
      expect(loaded.port, 9000);
      expect(loaded.keywordsGemOrNull, 'https://gemini.google.com/gem/k');
      expect(loaded.defaultModel, 'Pro');
    });
  });

  group('the python environment is read fresh at spawn', () {
    test('an explicit interpreter is what gets launched', () async {
      final spawnArgs = <String>[];
      final container = ProviderContainer(overrides: [
        pythonEnvironmentProvider.overrideWith(() => _FixedPython(
              const PythonEnvironmentSettings(
                pythonExecutable: r'C:\venv\Scripts\python.exe',
              ),
            )),
      ]);
      addTearDown(container.dispose);
      final provider = Provider((ref) => ProcessGeminiBridge(
            ref,
            spawn: ({
              required executable,
              required arguments,
              required workingDirectory,
              required environment,
            }) async {
              spawnArgs.add(executable);
              return _FakeDaemon()..listening();
            },
          ));
      await container.read(provider).ensureStarted();
      expect(spawnArgs.single, r'C:\venv\Scripts\python.exe');
    });

    test('a pipeline folder without the launcher is named, not spawned',
        () async {
      final root = Directory.systemTemp.createTempSync('gemini_launcher_');
      addTearDown(() => root.deleteSync(recursive: true));
      Directory('${root.path}${Platform.pathSeparator}pipeline').createSync();
      var spawns = 0;
      final container = ProviderContainer(overrides: [
        pythonEnvironmentProvider.overrideWith(() => _FixedPython(
              PythonEnvironmentSettings(projectRootOverride: root.path),
            )),
      ]);
      addTearDown(container.dispose);
      final provider = Provider((ref) => ProcessGeminiBridge(
            ref,
            spawn: ({
              required executable,
              required arguments,
              required workingDirectory,
              required environment,
            }) async {
              spawns++;
              return _FakeDaemon()..listening();
            },
          ));
      await expectLater(
        container.read(provider).ensureStarted(),
        throwsA(isA<GeminiBridgeException>().having((e) => e.message, 'message',
            contains('has no run_gemini_daemon.py'))),
      );
      expect(spawns, 0);
    });
  });
}

class _FixedPython extends PythonEnvironmentNotifier {
  _FixedPython(this._settings);
  final PythonEnvironmentSettings _settings;

  @override
  PythonEnvironmentSettings build() => _settings;
}
