import 'package:gratovo_toolbox/core/native/outreach_file_store.dart';

/// The skill factory's outreach folder in memory, for widget tests: the real
/// store does disk I/O, which never completes inside a widget test's fake
/// clock. `test/core/native/outreach_file_store_test.dart` covers the real
/// one on a temp folder.
///
/// [writes] records every write in order, so a test can assert both what
/// was written and that a refused write wrote nothing.
class MemoryOutreachFileStore implements OutreachFileStore {
  MemoryOutreachFileStore([Map<String, String>? files]) : files = {...?files};

  final Map<String, String> files;
  final writes = <({String name, String content})>[];

  @override
  String get location => 'memory://outreach';

  @override
  Future<String?> read(String name) async => files[name];

  @override
  Future<void> writeAtomic(String name, String content) async {
    writes.add((name: name, content: content));
    files[name] = content;
  }
}
