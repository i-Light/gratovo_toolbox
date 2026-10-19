import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/sync/mirror_fault.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/core/sync/sync_providers.dart';

/// What the app does when the LOCAL copy is the broken part.
///
/// Every other test in this folder is about reaching the server. This one is
/// about the failure that used to have no handling at all: once a first sync
/// has finished, every screen reads SQLite and nothing else, so a file that
/// stops answering takes the influencer list, the dashboard, the archive and
/// the conflicts banner with it — permanently, and while a perfectly good
/// network copy sits there unused.
void main() {
  group('GuardedMirrorDb', () {
    test('passes ordinary reads and writes straight through', () async {
      final inner = _FakeDb();
      final db = GuardedMirrorDb(inner, onFault: (_) => fail('no fault'));

      await db.execute('INSERT INTO t VALUES (?)', [1]);
      expect(await db.getAll('SELECT 1'), [
        {'ok': 1}
      ]);
      expect(inner.executed, hasLength(1));
    });

    test('a failed read is reported once and raised as a MirrorFault',
        () async {
      final cause = StateError('database is locked');
      final faults = <MirrorFault>[];
      final db = GuardedMirrorDb(
        _FakeDb(readError: cause),
        onFault: faults.add,
      );

      await expectLater(
        db.getAll('SELECT 1'),
        throwsA(isA<MirrorFault>()
            .having((f) => f.cause, 'cause', same(cause))
            .having((f) => f.operation, 'operation', 'read')),
      );

      // Reported BEFORE it was raised, which is the property the whole design
      // rests on: by the time the screen sees the error, the app has already
      // switched to the network and Riverpod's own refetch succeeds.
      expect(faults, hasLength(1));
      expect(faults.single.cause, same(cause));
    });

    test('a failed write is reported too', () async {
      final faults = <MirrorFault>[];
      final db = GuardedMirrorDb(
        _FakeDb(writeError: StateError('disk I/O error')),
        onFault: faults.add,
      );

      await expectLater(
          db.execute('UPDATE t SET a = 1'), throwsA(isA<MirrorFault>()));
      expect(faults.single.operation, 'written to');
    });

    test('a fault is not wrapped in a second fault', () async {
      const inner = MirrorFault(operation: 'read', cause: 'the original');
      final faults = <MirrorFault>[];
      final db = GuardedMirrorDb(
        _FakeDb(readError: inner),
        onFault: faults.add,
      );

      await expectLater(db.getAll('SELECT 1'), throwsA(same(inner)));
      // One failure is one failure. Counting it twice would trip the engine on
      // an event it had already handled.
      expect(faults, isEmpty);
    });

    test('a listener that throws does not change what the caller sees',
        () async {
      final db = GuardedMirrorDb(
        _FakeDb(readError: StateError('gone')),
        onFault: (_) => throw StateError('the listener is broken too'),
      );

      // The entire promise of this class: a broken local copy cannot take
      // anything else down with it, the reporting path included.
      await expectLater(db.getAll('SELECT 1'), throwsA(isA<MirrorFault>()));
    });
  });

  group('localMirrorProvider', () {
    ProviderContainer containerFor(SyncSnapshot status) {
      final container = ProviderContainer(
        overrides: [
          isSignedInProvider.overrideWithValue(true),
          syncBootProvider.overrideWithValue(
            SyncBoot(engine: _StaticEngine(status)),
          ),
        ],
      );
      addTearDown(container.dispose);
      return container;
    }

    test('hands out the local database while it is healthy', () {
      final container = containerFor(const SyncSnapshot(hasSynced: true));
      expect(container.read(localMirrorProvider), isNotNull);
    });

    test('still hands it out once it has faulted', () {
      final container = containerFor(
        const SyncSnapshot(
          hasSynced: true,
          localError: MirrorFault(operation: 'read', cause: 'corrupt'),
        ),
      );

      // There is no other copy to fall back to: the local database IS the
      // app's data. Withholding it would swap a broken file for the
      // in-memory mocks, which looks like the roster quietly vanished. The
      // fault is reported on the sync card instead, and the pages show the
      // error a read produces.
      expect(container.read(localMirrorProvider), isNotNull);
    });

    test('a server failure does NOT withhold it either', () {
      final container = containerFor(
        const SyncSnapshot(
          hasSynced: true,
          downloadError: 'the server did not answer',
        ),
      );
      expect(container.read(localMirrorProvider), isNotNull);
    });

    test('nor does never having synced', () {
      final container = containerFor(const SyncSnapshot());
      // An empty table on a fresh machine means "nothing here yet"; the sync
      // card is where "not synced yet" is reported.
      expect(container.read(localMirrorProvider), isNotNull);
    });
  });
}

class _FakeDb implements LocalSyncDb {
  _FakeDb({this.readError, this.writeError});

  final Object? readError;
  final Object? writeError;
  final List<String> executed = [];

  @override
  Future<List<Map<String, Object?>>> getAll(
    String sql, [
    List<Object?> parameters = const [],
  ]) async {
    if (readError != null) throw readError!;
    return [
      {'ok': 1}
    ];
  }

  @override
  Future<void> execute(
    String sql, [
    List<Object?> parameters = const [],
  ]) async {
    if (writeError != null) throw writeError!;
    executed.add(sql);
  }

  @override
  Future<void> transaction(void Function(LocalSyncTx tx) body) async {
    if (writeError != null) throw writeError!;
    body(_FakeTx(executed));
  }
}

class _FakeTx implements LocalSyncTx {
  _FakeTx(this.executed);

  final List<String> executed;

  @override
  List<Map<String, Object?>> select(
    String sql, [
    List<Object?> parameters = const [],
  ]) =>
      [
        {'ok': 1}
      ];

  @override
  void execute(String sql, [List<Object?> parameters = const []]) {
    executed.add(sql);
  }
}

class _StaticEngine implements SyncEngine {
  _StaticEngine(this.status);

  @override
  final SyncSnapshot status;

  @override
  final LocalSyncDb db = _FakeDb();

  @override
  final SyncDiagnostics diagnostics = SyncDiagnostics();

  @override
  Stream<SyncSnapshot> get statusStream => const Stream<SyncSnapshot>.empty();

  @override
  Future<void> connect() async {}

  @override
  Future<void> syncNow() async {}

  @override
  Future<void> catchUp({bool scraped = false}) async {}

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
