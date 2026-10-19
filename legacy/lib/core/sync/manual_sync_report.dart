import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What the last press of the global "Sync data with server" button actually
/// did.
///
/// Exists because the button's own snackbar is gone a few seconds later, and
/// the question it answers — "did that press push, pull, both, or neither?" —
/// is exactly the one somebody asks a minute afterwards when a teammate still
/// has not seen their change. The Settings sync row shows it.
///
/// In memory only, on purpose. It costs nothing — no persistence, no polling,
/// no extra request — and a result that does not survive a restart is fine:
/// the honest answer after a restart is "press it again".
class ManualSyncReport {
  const ManualSyncReport({
    required this.at,
    required this.detail,
    required this.ok,
  });

  /// When the press finished.
  final DateTime at;

  /// The same sentence the snackbar showed — a plain summary of the outcome.
  final String detail;

  /// True when every leg that ran succeeded.
  final bool ok;
}

class LastManualSyncNotifier extends Notifier<ManualSyncReport?> {
  @override
  ManualSyncReport? build() => null;

  void record(ManualSyncReport report) => state = report;
}

/// The last manual sync's outcome, or null if there has not been one this
/// session.
final lastManualSyncProvider =
    NotifierProvider<LastManualSyncNotifier, ManualSyncReport?>(
  LastManualSyncNotifier.new,
);
