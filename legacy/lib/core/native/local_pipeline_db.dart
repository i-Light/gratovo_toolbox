/// Public entry point for reading `data/database/gratovo.db` directly. Import
/// this file (never `local_pipeline_db_io.dart`/`_stub.dart` directly) --
/// see local_pipeline_db_io.dart's doc comment for why this is safe to read
/// this way, and scraper_process.dart for the same compile-time-swap
/// pattern applied there.
library;

export 'local_pipeline_db_stub.dart'
    if (dart.library.io) 'local_pipeline_db_io.dart';
