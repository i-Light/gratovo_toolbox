import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/outreach_file_store.dart';

/// The real outreach folder on disk. The cards deck that wrote here is gone
/// (decision old-files); the email library's bench import still reads
/// `bench/latest.json` through it.
void main() {
  late Directory dir;

  setUp(() => dir = Directory.systemTemp.createTempSync('outreach_store_'));
  tearDown(() => dir.deleteSync(recursive: true));

  test('a file that is not there reads as null, even in a missing folder',
      () async {
    expect(await openOutreachFileStore(dir.path).read('bench/latest.json'),
        isNull);
    expect(
      await openOutreachFileStore('${dir.path}/not-yet').read('cards.json'),
      isNull,
    );
  });

  test('reads a nested file as it is on disk', () async {
    Directory('${dir.path}/bench').createSync();
    File('${dir.path}/bench/latest.json').writeAsStringSync('{"drafts": []}');

    final store = openOutreachFileStore(dir.path);
    expect(await store.read('bench/latest.json'), '{"drafts": []}');
  });

  test('writes atomically and leaves no temp file behind', () async {
    final store = openOutreachFileStore(dir.path);
    await store.writeAtomic('notes.json', '{"a": 1}');
    await store.writeAtomic('notes.json', '{"a": 2}');

    expect(await store.read('notes.json'), '{"a": 2}');
    expect(
      dir.listSync().map((e) => e.uri.pathSegments.last),
      ['notes.json'],
    );
  });
}
