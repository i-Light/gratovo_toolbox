import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/sync/event_loop_lag.dart';
import 'package:gratovo_toolbox/core/sync/mirror_database.dart';
import 'package:gratovo_toolbox/core/sync/mirror_fault.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine_types.dart';

import '../../data/repositories/mirror/memory_mirror.dart';

/// `getAllOffThread`: the few reads that scan a whole table run on another
/// isolate over their own read-only connection, so the UI keeps drawing.
void main() {
  late Directory directory;
  late MirrorDatabase db;

  setUp(() {
    directory = Directory.systemTemp.createTempSync('gratovo_off_thread');
    db = MirrorDatabase.open('${directory.path}/mirror.db');
    db.executeSync('CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT)');
    db.transactionSync(() {
      for (var i = 0; i < 2000; i++) {
        db.executeSync('INSERT INTO t (label) VALUES (?)', ['row $i']);
      }
    });
  });

  tearDown(() {
    db.close();
    directory.deleteSync(recursive: true);
  });

  test('answers exactly what getAll answers, parameters included', () async {
    const sql = 'SELECT id, label FROM t WHERE id > ? ORDER BY id LIMIT 5';
    expect(await db.getAllOffThread(sql, [10]), await db.getAll(sql, [10]));
  });

  test('sees what this connection committed just before', () async {
    await db.execute('INSERT INTO t (label) VALUES (?)', ['just written']);
    final rows = await db.getAllOffThread(
      'SELECT COUNT(*) AS n FROM t WHERE label = ?',
      ['just written'],
    );
    expect(rows.single['n'], 1);
  });

  test('a slow read does not stall this isolate', () async {
    // A deliberately heavy query: a cross join that takes a while.
    const heavy =
        'SELECT COUNT(*) AS n FROM t a, t b WHERE a.id % 7 = b.id % 5';
    final sampler = EventLoopLagSampler.start(
      interval: const Duration(milliseconds: 5),
    );
    final watch = Stopwatch()..start();
    final rows = await db.getAllOffThread(heavy);
    watch.stop();
    // Let the loop turn once more: a tick held back by a blocked loop only
    // fires -- and is only measured -- after the block ends.
    await Future<void>.delayed(const Duration(milliseconds: 30));
    sampler.stop();

    expect(rows.single['n'], greaterThan(0));
    // Meaningful only if the query itself took a while.
    expect(watch.elapsedMilliseconds, greaterThan(100));
    expect(
        sampler.worst.inMilliseconds, lessThan(watch.elapsedMilliseconds ~/ 2),
        reason: 'the loop kept running while the query did');
  });

  test('a read error is still a fault the guard reports', () async {
    final faults = <Object>[];
    final guarded = GuardedMirrorDb(db, onFault: faults.add);
    await expectLater(
      guarded.getAllOffThread('SELECT * FROM no_such_table'),
      throwsA(anything),
    );
    expect(faults, hasLength(1));
  });

  test('a database without its own isolate just answers on this one', () async {
    final memory = MemoryMirror();
    addTearDown(memory.close);
    await memory.execute('CREATE TABLE x (v INTEGER)');
    await memory.execute('INSERT INTO x VALUES (7)');
    final LocalSyncDb asInterface = memory;
    expect(await asInterface.getAllOffThread('SELECT v FROM x'), [
      {'v': 7},
    ]);
  });
}
