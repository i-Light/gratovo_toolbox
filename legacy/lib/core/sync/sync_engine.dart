/// Public entry point for the local-first mirror. Import this file, never
/// `mirror_engine_io.dart` / `sync_engine_stub.dart` directly — the same
/// compile-time swap `core/native/local_pipeline_db.dart` and
/// `core/images/image_store.dart` use, and for the same reason: the real
/// implementation is backed by `package:sqlite3` and does not exist on web.
///
/// [openSyncEngine] returns null on any platform or configuration that cannot
/// sync, and every caller treats null as "use the network repositories" rather
/// than as a failure. That is not a degraded mode bolted on afterwards — it is
/// the mode the web build is always in, and the mode every client falls back to
/// if the mirror file cannot be opened.
library;

export 'sync_engine_stub.dart' if (dart.library.io) 'mirror_engine_io.dart';
export 'sync_engine_types.dart';
