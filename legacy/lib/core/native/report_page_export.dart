/// Writing a 30-day report page to disk — the one native operation the
/// otherwise-pure report needs. Same compile-time-swap pattern as
/// `skills_markdown_export.dart`: import this, never the `_io`/`_stub` files
/// directly.
library;

export 'report_page_export_stub.dart'
    if (dart.library.io) 'report_page_export_io.dart';
