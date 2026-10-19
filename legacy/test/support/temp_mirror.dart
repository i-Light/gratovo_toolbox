import 'dart:io';
import 'dart:math';

import 'package:gratovo_toolbox/core/sync/mirror_database.dart';

/// A real [MirrorDatabase] on a throwaway file.
///
/// A file rather than `:memory:`, because one of the things worth testing is
/// about the file itself: reopening one written by an older schema version.
/// An in-memory database cannot be reopened at all.
///
/// Every caller must [discardTempMirror] what it opens.
MirrorDatabase openTempMirror() {
  final directory = Directory.systemTemp.createTempSync('gratovo_mirror_test');
  final name = 'mirror_${Random().nextInt(1 << 32)}.db';
  return MirrorDatabase.open('${directory.path}${Platform.pathSeparator}$name');
}

/// Closes [db] and removes its file with the `-wal` and `-shm` beside it.
///
/// A test helper only. The production database is never deleted by the app —
/// it is the machine's working copy, shared with the pipeline.
void discardTempMirror(MirrorDatabase db) {
  db.close();
  for (final suffix in const ['', '-wal', '-shm']) {
    try {
      File('${db.path}$suffix').deleteSync();
    } on FileSystemException {
      // Windows keeps a handle on the -wal for a moment after close.
    }
  }
}
