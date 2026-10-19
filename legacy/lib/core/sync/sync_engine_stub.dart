import 'package:gratovo_toolbox/core/sync/pipeline_bridge.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine_types.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

export 'package:gratovo_toolbox/core/sync/sync_engine_types.dart';

/// The web build's answer: there is no local database.
///
/// `package:sqlite3` is FFI-backed and reaches the desktop targets only. The
/// web build exists so the app can be opened in a browser for a quick look;
/// it runs on the in-memory mocks and says so in Settings.
Future<SyncEngine?> openSyncEngine({
  required SupabaseClient client,
  required String databasePath,
  required String logDirectory,
  PipelineBridge? pipeline,
}) async =>
    null;
