/// Public entry point for what the My apps card does on this machine. Import
/// this file, never the `_io`/`_stub` pair behind it, so the web build never
/// pulls in `dart:io`.
library;

export 'my_apps_host_stub.dart' if (dart.library.io) 'my_apps_host_io.dart';
