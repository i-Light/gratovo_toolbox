/// Public entry point for appending to `data/all_keywords.txt`. Import this
/// file (never `all_keywords_export_io.dart`/`_stub.dart` directly) -- see
/// scraper_process.dart for the same compile-time-swap pattern applied here.
library;

export 'all_keywords_export_stub.dart'
    if (dart.library.io) 'all_keywords_export_io.dart';
