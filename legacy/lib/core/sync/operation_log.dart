import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine_types.dart';
import 'package:gratovo_toolbox/core/sync/sync_providers.dart';

/// Writes an app operation into the machine's flight recorder.
///
/// The mirror already keeps one ([SyncDiagnostics]): an on-disk, one-line-per-
/// event log that survives a restart and is readable from Settings. Nothing
/// outside the sync wrote to it, which meant every other operation in the app
/// failed the way the bulk clean did -- a red sentence in a dialog, no record
/// of what was asked for, what the server said, or whether it had ever worked,
/// and nothing at all left behind once the dialog was closed.
///
/// So the destructive and long-running operations write here too. Same file,
/// same format, same "copy the log" button; the dotted event names
/// (`bulkClean.apply`, `bulkClean.sweep`) are what separates them from the
/// sync's own lines when somebody greps it.
///
/// Falls back to `dart:developer` when there is no mirror engine — a
/// network-only machine is exactly where a failure is most likely, and losing
/// the record there would defeat the point.
extension OperationLog on Ref {
  void logOperation(
    String event,
    String message, {
    SyncLogLevel level = SyncLogLevel.info,
    Map<String, Object?> fields = const {},
    Object? error,
    StackTrace? stackTrace,
  }) {
    final diagnostics = read(syncEngineProvider)?.diagnostics;
    if (diagnostics != null) {
      diagnostics.log(
        event,
        message,
        level: level,
        fields: fields,
        error: error,
        stackTrace: stackTrace,
      );
      return;
    }
    developer.log(
      SyncLogEntry(
        at: DateTime.now().toUtc(),
        level: level,
        event: event,
        message: message,
        fields: {
          ...fields,
          if (error != null) ...SyncDiagnostics.describeError(error),
        },
      ).format(),
      name: 'gratovo.app',
      level: switch (level) {
        SyncLogLevel.error => 1000,
        SyncLogLevel.warn => 900,
        SyncLogLevel.info => 800,
        SyncLogLevel.debug => 700,
      },
      error: error,
      stackTrace: stackTrace,
    );
  }
}
