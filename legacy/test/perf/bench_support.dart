import 'dart:async';

import 'package:gratovo_toolbox/core/sync/sync_engine.dart';

/// One statement the app ran against the local database, and how long the
/// synchronous part of it took.
class QueryRecord {
  const QueryRecord(this.sql, this.micros, this.startedAtMicros);

  final String sql;
  final int micros;

  /// When it started, on [RecordingDb.clock].
  final int startedAtMicros;

  String get shortSql {
    final oneLine = sql.replaceAll(RegExp(r'\s+'), ' ').trim();
    return oneLine.length <= 110 ? oneLine : '${oneLine.substring(0, 107)}...';
  }
}

/// A [LocalSyncDb] that writes down every statement it forwards.
///
/// `package:sqlite3` is synchronous FFI, so the time around `await inner.getAll`
/// is time the UI isolate could not paint — which is exactly the number a
/// startup investigation is after. Used by the opt-in real-database benchmark
/// and by the tests that count how many times something re-queried.
class RecordingDb implements LocalSyncDb {
  RecordingDb(this.inner);

  final LocalSyncDb inner;
  final List<QueryRecord> log = [];
  final Stopwatch clock = Stopwatch()..start();

  /// Milliseconds spent inside the database since the last [reset].
  double get totalMillis =>
      log.fold<int>(0, (sum, record) => sum + record.micros) / 1000;

  void reset() => log.clear();

  @override
  Future<List<Map<String, Object?>>> getAll(
    String sql, [
    List<Object?> parameters = const [],
  ]) async {
    final start = clock.elapsedMicroseconds;
    final rows = await inner.getAll(sql, parameters);
    log.add(QueryRecord(sql, clock.elapsedMicroseconds - start, start));
    return rows;
  }

  @override
  Future<void> execute(
    String sql, [
    List<Object?> parameters = const [],
  ]) async {
    final start = clock.elapsedMicroseconds;
    await inner.execute(sql, parameters);
    log.add(QueryRecord(sql, clock.elapsedMicroseconds - start, start));
  }

  @override
  Future<void> transaction(void Function(LocalSyncTx tx) body) async {
    final start = clock.elapsedMicroseconds;
    await inner.transaction(body);
    log.add(
        QueryRecord('TRANSACTION', clock.elapsedMicroseconds - start, start));
  }
}

/// The smallest engine that lets the real providers run over a real database:
/// it hands out [db] and does nothing else. `connect` is counted so a test can
/// say how often the app asked for a sync.
class BenchEngine implements SyncEngine {
  BenchEngine(this.db);

  @override
  final LocalSyncDb db;

  int connects = 0;

  @override
  final SyncDiagnostics diagnostics = SyncDiagnostics();

  @override
  SyncSnapshot get status => const SyncSnapshot(hasSynced: true);

  @override
  Stream<SyncSnapshot> get statusStream => const Stream<SyncSnapshot>.empty();

  @override
  Future<void> connect() async => connects++;

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

/// Runs [body] [runs] times and reports the first run (JIT warm-up and cold
/// page cache included) and the median of the rest, in milliseconds.
Future<({double first, double median, double min})> timeIt(
  Future<void> Function() body, {
  int runs = 5,
}) async {
  final samples = <double>[];
  for (var i = 0; i < runs; i++) {
    final watch = Stopwatch()..start();
    await body();
    watch.stop();
    samples.add(watch.elapsedMicroseconds / 1000);
  }
  final rest = samples.length > 1 ? samples.sublist(1) : samples;
  final sorted = [...rest]..sort();
  return (
    first: samples.first,
    median: sorted[sorted.length ~/ 2],
    min: sorted.first,
  );
}
