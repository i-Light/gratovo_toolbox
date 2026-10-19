import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/local_db/local_db.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/email_library_schema.dart';

/// The io half of the local-db support, against real files.
///
/// The property under test is the one the sync mirror deliberately does NOT
/// have: reopening must never discard what is stored. The mirror recreates its
/// file on a version mismatch because the server can refill it; nothing can
/// refill this one, so a reopen that lost rows would lose hours of study.
void main() {
  late Directory directory;

  setUp(() {
    directory = Directory.systemTemp.createTempSync('gratovo_local_db_test');
  });

  tearDown(() {
    try {
      directory.deleteSync(recursive: true);
    } on FileSystemException {
      // Windows keeps a handle on the -wal file briefly after close. A leftover
      // temp folder is not worth failing a test over.
    }
  });

  test('creates the file, applies the schema, and stamps user_version', () {
    final db = openLocalDb(directory: directory.path, spec: emailLibrarySpec)!;
    addTearDown(db.close);

    expect(
      File('${directory.path}${Platform.pathSeparator}email_library.db')
          .existsSync(),
      isTrue,
    );
    expect(
      db.select('PRAGMA user_version').single.values.single,
      emailLibrarySpec.version,
    );
    // The seeded stage vocabulary is part of the v1 migration.
    expect(
      db
          .select("SELECT count(*) AS n FROM email_tags WHERE kind = 'stage'")
          .single['n'],
      3,
    );
  });

  test('reopening keeps every row', () {
    final first =
        openLocalDb(directory: directory.path, spec: emailLibrarySpec)!;
    first.execute(
      'INSERT INTO email_records '
      '(id, audience, video_url, context, subject, body, critique, '
      'created_at, updated_at) '
      "VALUES ('r1', 'influencer', '', '', 'Kept', '', 'Still here', "
      "'2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    );
    first.close();

    final second =
        openLocalDb(directory: directory.path, spec: emailLibrarySpec)!;
    addTearDown(second.close);

    final rows = second.select('SELECT subject, critique FROM email_records');
    expect(rows, hasLength(1));
    expect(rows.single['subject'], 'Kept');
    expect(rows.single['critique'], 'Still here');
  });

  test('a migration list already applied is not re-run', () {
    // `INSERT OR IGNORE` on the seeds makes re-running harmless, but the
    // opener should not be relying on that — it should skip the script.
    final first =
        openLocalDb(directory: directory.path, spec: emailLibrarySpec)!;
    first.execute(
        "UPDATE email_tags SET label = 'Renamed' WHERE id = 'stage-closing'");
    first.close();

    final second =
        openLocalDb(directory: directory.path, spec: emailLibrarySpec)!;
    addTearDown(second.close);
    expect(
      second
          .select("SELECT label FROM email_tags WHERE id = 'stage-closing'")
          .single['label'],
      'Renamed',
    );
  });

  test('creates the directory when it does not exist yet', () {
    final nested = '${directory.path}${Platform.pathSeparator}nope';
    final db = openLocalDb(directory: nested, spec: emailLibrarySpec);
    expect(db, isNotNull);
    addTearDown(db!.close);
  });

  test('a transaction rolls back as a unit', () {
    final db = openLocalDb(directory: directory.path, spec: emailLibrarySpec)!;
    addTearDown(db.close);

    expect(
      () => db.transaction(() {
        db.execute(
          'INSERT INTO email_tags (id, kind, label, label_key, sort_order, '
          "created_at) VALUES ('t1', 'niche', 'A', 'a', 0, '2026-01-01')",
        );
        // Same primary key — the second insert fails and must undo the first.
        db.execute(
          'INSERT INTO email_tags (id, kind, label, label_key, sort_order, '
          "created_at) VALUES ('t1', 'niche', 'B', 'b', 1, '2026-01-01')",
        );
      }),
      throwsA(anything),
    );

    expect(
      db
          .select("SELECT count(*) AS n FROM email_tags WHERE kind = 'niche'")
          .single['n'],
      0,
    );
  });

  test('an unopenable path returns null rather than throwing', () {
    // A directory path that cannot be a file's parent. Null is the contract —
    // callers render "no local library" and the app keeps running.
    final blocked = File('${directory.path}${Platform.pathSeparator}blocker')
      ..writeAsStringSync('not a directory');
    expect(
      openLocalDb(directory: blocked.path, spec: emailLibrarySpec),
      isNull,
    );
  });
}
