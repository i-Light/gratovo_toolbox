import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/pipeline_reset.dart';

/// Parsing `reset_manifest.json` and the quarantine index.
///
/// Both run before the first frame off files that a person edits by hand, so
/// every "malformed input" case here has to resolve to "do nothing" rather
/// than throw. The path-safety cases matter most: a manifest must never be
/// able to name something outside the pipeline data dir.
void main() {
  group('ResetAction.parseManifest', () {
    test('reads a well-formed action', () {
      final actions = ResetAction.parseManifest('''
        { "actions": [
          { "id": "2026-09-08-email-lib",
            "paths": ["database/email_library.db"],
            "note": "Library restructured" } ] }
      ''');
      expect(actions, hasLength(1));
      expect(actions.single.id, '2026-09-08-email-lib');
      expect(actions.single.paths, ['database/email_library.db']);
      expect(actions.single.note, 'Library restructured');
    });

    test('malformed JSON yields no actions rather than throwing', () {
      expect(ResetAction.parseManifest('{ not json'), isEmpty);
      expect(ResetAction.parseManifest(''), isEmpty);
      expect(ResetAction.parseManifest('[]'), isEmpty);
      expect(ResetAction.parseManifest('{"actions": "nope"}'), isEmpty);
    });

    test('drops actions with a blank id or no usable paths', () {
      final actions = ResetAction.parseManifest('''
        { "actions": [
          { "id": "", "paths": ["database/x.db"] },
          { "id": "  ", "paths": ["database/x.db"] },
          { "id": "no-paths", "paths": [] },
          { "id": "paths-not-a-list", "paths": "database/x.db" },
          { "id": "ok", "paths": ["database/x.db"] } ] }
      ''');
      expect(actions.map((a) => a.id), ['ok']);
    });

    test('keeps the first of two actions sharing an id', () {
      final actions = ResetAction.parseManifest('''
        { "actions": [
          { "id": "dup", "paths": ["database/first.db"] },
          { "id": "dup", "paths": ["database/second.db"] } ] }
      ''');
      expect(actions, hasLength(1));
      expect(actions.single.paths, ['database/first.db']);
    });

    test('rejects paths that could escape the data dir', () {
      final actions = ResetAction.parseManifest(r'''
        { "actions": [
          { "id": "a", "paths": [
              "../secrets.db",
              "database/../../etc/passwd",
              "/etc/passwd",
              "C:/Windows/system32/x.db",
              "\\\\server\\share\\x.db"
          ] } ] }
      ''');
      // Every path was unsafe, so the action has nothing to do and is dropped.
      expect(actions, isEmpty);
    });

    test('normalises backslashes and strips . segments', () {
      final actions = ResetAction.parseManifest(r'''
        { "actions": [
          { "id": "a", "paths": ["database\\.\\email_library.db", "database/email_library.db"] } ] }
      ''');
      // Both forms collapse to the same safe path; the duplicate is removed.
      expect(actions.single.paths, ['database/email_library.db']);
    });
  });

  group('applied-id ledger', () {
    test('round-trips through encode/parse', () {
      final ids = {'b', 'a', 'c'};
      final text = encodeAppliedResetIds(ids);
      expect(parseAppliedResetIds(text), ids);
      // encoded sorted, for a readable diff in the file
      expect(text.indexOf('"a"'), lessThan(text.indexOf('"b"')));
    });

    test('unparseable ledger reads as "nothing applied"', () {
      expect(parseAppliedResetIds('not json'), isEmpty);
      expect(parseAppliedResetIds('{}'), isEmpty);
    });
  });

  group('MergeQuarantineIndex', () {
    QuarantinedFile file(String id, {bool resolved = false}) => QuarantinedFile(
          resetId: id,
          originalRelPath: 'database/$id.db',
          storedName: '2026-09-08T10-00-00Z__$id.db',
          quarantinedAt: DateTime.utc(2026, 9, 8, 10),
          note: 'because $id',
          resolved: resolved,
        );

    test('encode then decode preserves every field', () {
      final index =
          MergeQuarantineIndex([file('a'), file('b', resolved: true)]);
      final round = MergeQuarantineIndex.decode(index.encode());
      expect(round.files, hasLength(2));
      expect(round.files[0].originalRelPath, 'database/a.db');
      expect(round.files[0].note, 'because a');
      expect(round.files[1].resolved, isTrue);
    });

    test('pending / pendingCount ignore resolved entries', () {
      final index = MergeQuarantineIndex(
          [file('a'), file('b', resolved: true), file('c')]);
      expect(index.pendingCount, 2);
      expect(index.pending.map((f) => f.resetId), ['a', 'c']);
    });

    test('markResolved flips exactly one entry and leaves the rest', () {
      final index = MergeQuarantineIndex([file('a'), file('c')]);
      final after = index.markResolved('2026-09-08T10-00-00Z__a.db');
      expect(after.files.firstWhere((f) => f.resetId == 'a').resolved, isTrue);
      expect(after.files.firstWhere((f) => f.resetId == 'c').resolved, isFalse);
    });

    test('decode of junk is an empty index, not a throw', () {
      expect(MergeQuarantineIndex.decode('nope').files, isEmpty);
      expect(MergeQuarantineIndex.decode('{"files": 3}').files, isEmpty);
    });

    test('stemFor makes a filename-safe prefix', () {
      final stem = QuarantinedFile.stemFor(DateTime.utc(2026, 9, 8, 14, 30, 5));
      expect(stem, '2026-09-08T14-30-05Z__');
      expect(stem.contains(':'), isFalse);
    });
  });
}
