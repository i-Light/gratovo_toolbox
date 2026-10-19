import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge_types.dart';

export 'package:gratovo_toolbox/core/native/gemini_bridge_types.dart';

/// Web: there is no process to spawn, so there is no daemon and no Gemini.
///
/// Every call fails with [GeminiFailure.unavailable] and the state is
/// permanently `failed`, so a widget that reads it renders the same "not
/// available on this platform" it would for a broken install — and
/// [isAvailable] is false, so nothing that needs the daemon is offered here.
class ProcessGeminiBridge extends GeminiBridge {
  ProcessGeminiBridge();

  static const _reason = 'The Gemini bridge is not available on this platform.';

  @override
  bool get isAvailable => false;

  @override
  GeminiBridgeState get state => const GeminiBridgeState.failed(_reason);

  @override
  Stream<GeminiBridgeState> get stateChanges => const Stream.empty();

  @override
  Stream<GeminiEvent> get events => const Stream.empty();

  @override
  String? get extensionDir => null;

  @override
  Future<void> ensureStarted() async {
    throw GeminiBridgeException.unavailable(_reason);
  }

  @override
  Future<Map<String, Object?>> call(
    String method, [
    Map<String, Object?> params = const {},
    Duration? timeout,
  ]) async {
    throw GeminiBridgeException.unavailable(_reason);
  }

  @override
  Future<void> stop() async {}

  @override
  Future<void> prepareForAction() async {
    throw GeminiBridgeException.unavailable(_reason);
  }
}

final geminiBridgeProvider =
    Provider<GeminiBridge>((ref) => ProcessGeminiBridge());

final geminiBridgeStateProvider =
    NotifierProvider<GeminiBridgeStateNotifier, GeminiBridgeState>(
  () => GeminiBridgeStateNotifier((ref) => ref.watch(geminiBridgeProvider)),
);
