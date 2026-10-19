import 'package:gratovo_toolbox/core/native/outreach_file_store_base.dart';

/// The web build has no project folder: every file reads as absent (so there
/// is no Outreach tile), and a write fails rather than pretending to save.
OutreachFileStore openOutreachFileStore(String directory) =>
    _NoOutreachFileStore(directory);

class _NoOutreachFileStore implements OutreachFileStore {
  const _NoOutreachFileStore(this.location);

  @override
  final String location;

  @override
  Future<String?> read(String name) async => null;

  @override
  Future<void> writeAtomic(String name, String content) async =>
      throw OutreachFileException(name, 'No project folder on this platform.');
}
