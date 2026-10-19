/// Writing an exported skill's combined markdown to disk — the one native
/// operation `skill_markdown.dart`'s otherwise-pure logic needs. Same
/// compile-time-swap pattern as `core/local_db/local_db.dart`: import this,
/// never the `_io`/`_stub` files directly.
library;

export 'skills_markdown_export_stub.dart'
    if (dart.library.io) 'skills_markdown_export_io.dart';
