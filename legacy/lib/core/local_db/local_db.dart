/// Public entry point for local-only SQLite files — data that is typed on one
/// machine, lives only there, and has no server behind it.
///
/// Import this, never `local_db_io.dart` / `local_db_stub.dart` directly. Same
/// compile-time-swap pattern as `core/native/local_pipeline_db.dart` and
/// `core/sync/sync_engine.dart`; see `local_db_types.dart` for the model.
library;

export 'local_db_stub.dart' if (dart.library.io) 'local_db_io.dart';
