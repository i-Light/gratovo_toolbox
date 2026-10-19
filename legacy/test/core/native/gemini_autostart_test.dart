import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/gemini_autostart.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../support/fake_gemini_bridge.dart';

const _listening = GeminiBridgeState.listening(port: 8765);
final _connected = GeminiBridgeState.connected(const GeminiBridgeStatus(
  listening: true,
  port: 8765,
  extensionConnected: true,
));

GeminiWindowResult _window({bool connected = true, String message = ''}) =>
    GeminiWindowResult.fromJson({
      'connected': connected,
      'launched': true,
      'reused': false,
      'browser': 'firefox',
      'steps': const [],
      'message': message,
    });

void main() {
  late FakeGeminiBridge bridge;
  var settings = const GeminiBridgeSettings();

  GeminiAutoStart supervisor({List<Duration>? reopen}) => GeminiAutoStart(
        bridge: bridge,
        settings: () => settings,
        settingsReady: () async {},
        startDelay: Duration.zero,
        connectGrace: const Duration(milliseconds: 30),
        reopenDelays: reopen ?? const [Duration(milliseconds: 20)],
      );

  Future<void> settle([int ms = 120]) =>
      Future<void>.delayed(Duration(milliseconds: ms));

  setUp(() {
    bridge = FakeGeminiBridge();
    settings = const GeminiBridgeSettings();
  });
  tearDown(() => bridge.dispose());

  test('auto-start off: touches nothing', () async {
    settings = settings.copyWith(autoStart: false);
    final s = supervisor()..start();
    addTearDown(s.dispose);
    await settle();
    expect(bridge.calls, isEmpty);
    expect(bridge.state.isStopped, isTrue);
  });

  test(
      'starts the daemon and opens the window in the background when nothing connects',
      () async {
    bridge.setState(_listening);
    bridge.answerEnsureWindow(_window());
    final s = supervisor()..start();
    addTearDown(s.dispose);
    await settle();
    expect(bridge.callCount('bridge.ensure_window'), 1);
    final params = bridge.calls.single.params;
    expect(params['browser'], 'firefox');
    expect(params['focus'], false,
        reason: 'a background launch must not steal the focus');
    expect(params['profileMode'], 'managed');
    expect(bridge.prepareCount, 0);
  });

  test('an extension that connects on its own within the grace gets no window',
      () async {
    bridge.setState(_listening);
    bridge.answerEnsureWindow(_window());
    final s = supervisor()..start();
    addTearDown(s.dispose);
    await Future<void>.delayed(const Duration(milliseconds: 5));
    bridge.setState(_connected);
    await settle();
    expect(bridge.callCount('bridge.ensure_window'), 0);
  });

  test('auto-open off: the daemon starts but no window is opened', () async {
    settings = settings.copyWith(autoOpenWindow: false);
    bridge.setState(_listening);
    final s = supervisor()..start();
    addTearDown(s.dispose);
    await settle();
    expect(bridge.callCount('bridge.ensure_window'), 0);
  });

  test(
      'a connection that goes away is re-opened after a pause, and a failure never throws',
      () async {
    bridge.setState(_connected);
    bridge.failWith(
        'bridge.ensure_window', 'BROWSER_NOT_FOUND', 'Firefox was not found');
    final s = supervisor()..start();
    addTearDown(s.dispose);
    await settle(20);
    bridge.setState(_listening); // the window was closed
    await settle();
    expect(bridge.callCount('bridge.ensure_window'), 1);
  });

  test('the provider is a no-op on a platform without the bridge', () async {
    SharedPreferences.setMockInitialValues({});
    bridge.dispose();
    bridge = FakeGeminiBridge(available: false);
    final container = ProviderContainer(overrides: [
      geminiBridgeProvider.overrideWithValue(bridge),
    ]);
    addTearDown(container.dispose);
    container.read(geminiAutoStartProvider);
    await settle();
    expect(bridge.calls, isEmpty);
  });
}
