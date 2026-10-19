@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';

/// [PipelineDataDir.applyPendingResets] against a real temp data dir.
///
/// The contract under test: a manifest action MOVES the files it names into
/// `database/_needs_merge/` (siblings included), records the id so it never
/// runs twice, writes an index the Settings card can read, and touches nothing
/// it was not told to.
void main() {
  late Directory root;
  late ScraperProcessPaths paths;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('gratovo_reset_test_');
    final dataDir = Directory('${root.path}/data')..createSync(recursive: true);
    Directory('${dataDir.path}/database').createSync(recursive: true);
    paths = ScraperProcessPaths(
      pipelineDir: '${root.path}/pipeline',
      dataDir: dataDir.path,
    );
  });

  tearDown(() async {
    if (root.existsSync()) root.deleteSync(recursive: true);
  });

  void writeManifest(Object? manifest) =>
      File('${paths.dataDir}/reset_manifest.json')
          .writeAsStringSync(jsonEncode(manifest));

  File dbFile(String name) => File('${paths.databaseDir}/$name');

  List<String> quarantineNames() =>
      Directory('${paths.databaseDir}/_needs_merge')
          .listSync()
          .map((e) => e.uri.pathSegments.last)
          .toList()
        ..sort();

  List<Object?> appliedIds() => jsonDecode(
      File('${paths.dataDir}/.applied_resets.json').readAsStringSync()) as List;

  test('moves a named database and its -wal/-shm siblings aside', () async {
    dbFile('email_library.db').writeAsStringSync('OLD DB');
    dbFile('email_library.db-wal').writeAsStringSync('OLD WAL');
    dbFile('email_library.db-shm').writeAsStringSync('OLD SHM');

    writeManifest({
      'actions': [
        {
          'id': '2026-09-08-email-lib',
          'paths': ['database/email_library.db'],
          'note': 'Library restructured',
        }
      ],
    });

    final index = await PipelineDataDir.applyPendingResets(paths);

    // Originals gone.
    expect(dbFile('email_library.db').existsSync(), isFalse);
    expect(dbFile('email_library.db-wal').existsSync(), isFalse);
    expect(dbFile('email_library.db-shm').existsSync(), isFalse);

    // Three files in the quarantine, all timestamp-prefixed, contents intact.
    final names = quarantineNames();
    expect(names.where((n) => n.endsWith('__email_library.db')), hasLength(1));
    expect(
        names.where((n) => n.endsWith('__email_library.db-wal')), hasLength(1));
    expect(
        names.where((n) => n.endsWith('__email_library.db-shm')), hasLength(1));
    final moved = File('${paths.databaseDir}/_needs_merge/'
        '${names.firstWhere((n) => n.endsWith('__email_library.db'))}');
    expect(moved.readAsStringSync(), 'OLD DB');

    // Index + ledger written.
    expect(index.pendingCount, 1);
    expect(index.pending.single.originalRelPath, 'database/email_library.db');
    expect(index.pending.single.note, 'Library restructured');

    final onDisk = jsonDecode(
        File('${paths.databaseDir}/_needs_merge/index.json')
            .readAsStringSync()) as Map<String, Object?>;
    expect(onDisk['files'] as List, hasLength(1));

    expect(appliedIds(), contains('2026-09-08-email-lib'));
  });

  test('a second run is a no-op — the id is already applied', () async {
    dbFile('gratovo.db').writeAsStringSync('DB');
    writeManifest({
      'actions': [
        {
          'id': 'once',
          'paths': ['database/gratovo.db'],
        }
      ]
    });

    final first = await PipelineDataDir.applyPendingResets(paths);
    expect(first.pendingCount, 1);
    final afterFirst = quarantineNames();

    // Re-create a file at the original path (as the pipeline would); the reset
    // must not grab it again.
    dbFile('gratovo.db').writeAsStringSync('FRESH DB');
    final second = await PipelineDataDir.applyPendingResets(paths);

    expect(second.pendingCount, 1, reason: 'no new entry added');
    expect(quarantineNames(), afterFirst);
    expect(dbFile('gratovo.db').readAsStringSync(), 'FRESH DB',
        reason: 'the fresh copy is left alone');
  });

  test('an action naming a file that is not there still records its id',
      () async {
    writeManifest({
      'actions': [
        {
          'id': 'missing-target',
          'paths': ['database/not_here.db'],
        }
      ]
    });

    final index = await PipelineDataDir.applyPendingResets(paths);
    expect(index.pendingCount, 0);
    expect(appliedIds(), contains('missing-target'));
  });

  test('files the manifest does not name are left untouched', () async {
    dbFile('email_library.db').writeAsStringSync('DB');
    File('${paths.dataDir}/settings.json').writeAsStringSync('{"keep": true}');

    writeManifest({
      'actions': [
        {
          'id': 'x',
          'paths': ['database/email_library.db'],
        }
      ]
    });

    await PipelineDataDir.applyPendingResets(paths);

    expect(File('${paths.dataDir}/settings.json').existsSync(), isTrue);
    expect(File('${paths.dataDir}/settings.json').readAsStringSync(),
        '{"keep": true}');
  });

  test('no manifest at all is a clean no-op', () async {
    final index = await PipelineDataDir.applyPendingResets(paths);
    expect(index.pendingCount, 0);
    expect(File('${paths.dataDir}/.applied_resets.json').existsSync(), isFalse);
  });

  test('resolveQuarantinedFile marks resolved and can delete the copy',
      () async {
    dbFile('gratovo.db').writeAsStringSync('DB');
    writeManifest({
      'actions': [
        {
          'id': 'r',
          'paths': ['database/gratovo.db'],
        }
      ]
    });
    final index = await PipelineDataDir.applyPendingResets(paths);
    final stored = index.pending.single.storedName;

    final kept = await PipelineDataDir.resolveQuarantinedFile(
        paths: paths, storedName: stored, deleteFile: false);
    expect(kept.pendingCount, 0);
    expect(kept.files.single.resolved, isTrue);
    expect(
        File('${paths.databaseDir}/_needs_merge/$stored').existsSync(), isTrue);

    final deleted = await PipelineDataDir.resolveQuarantinedFile(
        paths: paths, storedName: stored, deleteFile: true);
    expect(deleted.pendingCount, 0);
    expect(File('${paths.databaseDir}/_needs_merge/$stored').existsSync(),
        isFalse);
  });
}
