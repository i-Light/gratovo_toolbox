/// Reading and writing the skill factory's outreach files. Same
/// compile-time-swap pattern as `skills_markdown_export.dart`: import this,
/// never the `_io`/`_stub` files directly.
library;

export 'outreach_file_store_base.dart';
export 'outreach_file_store_stub.dart'
    if (dart.library.io) 'outreach_file_store_io.dart';
