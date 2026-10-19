/// The daemon-backed [GeminiBridge], or a stub on web.
///
/// Same three-file split as `scraper_process.dart`: the io implementation
/// spawns a process through `dart:io`, which the web build cannot compile, so
/// this conditional export is the only thing feature code imports. The
/// shared types (`GeminiBridge`, `GeminiBridgeState`, the settings, the
/// protocol) come through either side.
library;

export 'gemini_bridge_stub.dart' if (dart.library.io) 'gemini_bridge_io.dart';
