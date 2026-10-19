/// Public entry point for downloading and applying an update. Import this
/// file, never the `_io`/`_stub` pair behind it — same compile-time-swap
/// pattern as `local_pipeline_db.dart`, so the web build never pulls in
/// `dart:io`.
library;

export 'update_installer_stub.dart'
    if (dart.library.io) 'update_installer_io.dart';
