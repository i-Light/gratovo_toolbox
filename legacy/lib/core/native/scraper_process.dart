/// Public entry point for launching the real Python pipeline. Import this
/// file (never `scraper_process_io.dart`/`_stub.dart` directly) -- which
/// `ScraperProcess` implementation you get is picked automatically at
/// compile time: the real `dart:io`-based one everywhere `dart:io` exists
/// (Windows/macOS/Linux/Android/iOS), a stub that throws on web (where
/// `Process` can't exist at all). See scraper_process_io.dart's doc comment
/// for why nothing on Android/iOS actually reaches the real one either,
/// even though it compiles there.
library;

export 'scraper_process_stub.dart'
    if (dart.library.io) 'scraper_process_io.dart';
