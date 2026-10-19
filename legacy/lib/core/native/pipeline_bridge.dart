/// The process-backed [PipelineBridge], or a stub on web.
///
/// Same three-file split as `scraper_process.dart`: the io implementation
/// imports `dart:io` through `ScraperProcess`, which the web build cannot
/// compile, so this conditional export is the only thing `main.dart` imports.
library;

export 'pipeline_bridge_stub.dart'
    if (dart.library.io) 'pipeline_bridge_io.dart';
