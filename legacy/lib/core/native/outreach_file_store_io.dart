import 'dart:io';

import 'package:gratovo_toolbox/core/native/outreach_file_store_base.dart';

/// The folder on disk. [directory] need not exist yet: every file in it then
/// reads as absent, and the first write creates it.
OutreachFileStore openOutreachFileStore(String directory) =>
    _DirectoryOutreachFileStore(directory);

class _DirectoryOutreachFileStore implements OutreachFileStore {
  const _DirectoryOutreachFileStore(this.location);

  @override
  final String location;

  File _file(String name) => File('$location${Platform.pathSeparator}$name');

  @override
  Future<String?> read(String name) async {
    final file = _file(name);
    try {
      if (!await file.exists()) return null;
      return await file.readAsString();
    } on FileSystemException catch (error) {
      throw OutreachFileException(name, error.message);
    } on FormatException catch (error) {
      // Not UTF-8: the factory always writes UTF-8, so this is damage.
      throw OutreachFileException(name, error.message);
    }
  }

  /// The same temp-then-rename as `writeSkillMarkdownFile` and the factory's
  /// own `write_atomic`: a rename is atomic where a truncate-then-write is a
  /// window in which the factory could read half a file.
  @override
  Future<void> writeAtomic(String name, String content) async {
    final target = _file(name);
    final temp =
        File('${target.path}.tmp-${DateTime.now().microsecondsSinceEpoch}');
    try {
      await Directory(location).create(recursive: true);
      await temp.writeAsString(content, flush: true);
      await temp.rename(target.path);
    } on FileSystemException catch (error) {
      // A temp file left behind would only be clutter, but the factory never
      // reads it either way.
      try {
        if (await temp.exists()) await temp.delete();
      } on FileSystemException {
        // Already reporting the write failure below.
      }
      throw OutreachFileException(name, error.message);
    }
  }
}
