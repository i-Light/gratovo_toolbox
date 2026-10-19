import 'package:fake_async/fake_async.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/core/sync/sync_providers.dart';

/// The throttle in front of [SyncEngine.syncNow].
///
/// Worth its own test because it is what stands between "the Influencers page
/// fills in during a search run" and "a search run has this machine downloading
/// the delta every two seconds for an hour". The pipeline pushes after every
/// keyword and every push arrives here as a realtime notification, so the ask
/// is genuinely that frequent — the coalescing is the whole feature, not a
/// nicety.
void main() {
  group('MirrorCatchUp', () {
    late _RecordingEngine engine;
    late ProviderContainer container;

    setUp(() {
      engine = _RecordingEngine();
      container = ProviderContainer(
        overrides: [
          syncBootProvider.overrideWithValue(
            SyncBoot(engine: engine),
          ),
        ],
      );
      addTearDown(container.dispose);
    });

    test('the first ask syncs straight away', () {
      container.read(mirrorCatchUpProvider).request();
      expect(engine.syncs, 1);
    });

    test('a burst costs one sync now and one at the end of the window', () {
      fakeAsync((async) {
        final catchUp = container.read(mirrorCatchUpProvider);
        for (var i = 0; i < 20; i++) {
          catchUp.request();
        }
        expect(engine.syncs, 1, reason: 'a burst must not become 20 requests');

        async.elapse(const Duration(seconds: 19));
        expect(engine.syncs, 1, reason: 'still inside the window');

        // The trailing pass matters as much as the throttle: the last ask in a
        // busy stretch knows about the most rows, and dropping it would leave
        // the mirror a keyword behind until the next three-hourly tick.
        async.elapse(const Duration(seconds: 2));
        expect(engine.syncs, 2);

        // ...and a quiet window after that ends it, rather than leaving a timer
        // resyncing every twenty seconds for the rest of the session.
        async.elapse(const Duration(minutes: 5));
        expect(engine.syncs, 2);
      });
    });

    test('nothing is asked of a machine with no mirror', () {
      final plain = ProviderContainer(
        overrides: [
          syncBootProvider.overrideWithValue(const SyncBoot()),
        ],
      );
      addTearDown(plain.dispose);

      // No throw, and nothing to call. Every caller asks unconditionally, so
      // this is the ordinary case on the web build and on a machine with the
      // local copy switched off.
      plain.read(mirrorCatchUpProvider).request();
    });
  });
}

class _RecordingEngine implements SyncEngine {
  int syncs = 0;

  @override
  Future<void> syncNow() async => syncs++;

  // MirrorCatchUp calls catchUp(), not syncNow() — see its own comment on why.
  // Counted the same way so this recording engine still answers "how many
  // times did the throttle actually let a sync through".
  @override
  Future<void> catchUp({bool scraped = false}) async => syncs++;

  @override
  LocalSyncDb get db => throw UnimplementedError();

  @override
  final SyncDiagnostics diagnostics = SyncDiagnostics();

  @override
  SyncSnapshot get status => const SyncSnapshot();

  @override
  Stream<SyncSnapshot> get statusStream => const Stream<SyncSnapshot>.empty();

  @override
  Future<void> connect() async {}

  @override
  void setBusy({required bool busy, String? reason}) {}

  @override
  Future<void> disconnect() async {}

  @override
  Future<void> forgetSession() async {}

  @override
  Stream<Set<String>> get uploadedTables => const Stream<Set<String>>.empty();

  @override
  Future<void> close() async {}
}
