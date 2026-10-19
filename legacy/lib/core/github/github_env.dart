/// This machine's environment, for the two GitHub build-time values.
///
/// Import this file, never the `_io`/`_stub` pair behind it — same
/// compile-time-swap pattern as `local_pipeline_db.dart`, so the web build
/// never pulls in `dart:io`.
library;

export 'github_env_stub.dart' if (dart.library.io) 'github_env_io.dart';
