import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/data/models/scratchpad_note.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';

/// One line in the per-device sync log the page shows for debugging.
class ScratchpadSyncEvent {
  const ScratchpadSyncEvent(this.at, this.message);

  /// Wall-clock time on THIS device — the log is a local trace, not a shared
  /// record, so it is fine that it is the device clock rather than the
  /// server's.
  final DateTime at;
  final String message;
}

/// Everything the Scratchpad page renders from.
class ScratchpadBoard {
  const ScratchpadBoard({
    this.notes = const {},
    this.lastSyncedAt,
    this.pulledAt = const {},
    this.log = const [],
  });

  /// Every box the signed-in user may see, keyed by owner id.
  final Map<String, ScratchpadNote> notes;

  /// When this device last finished pulling the whole table.
  final DateTime? lastSyncedAt;

  /// Per box: when this device last saw that person's row in a pull. Distinct
  /// from the note's own `updatedAt` (the owner's last save on the server) —
  /// the gap between the two is what tells you a sync is stuck.
  final Map<String, DateTime> pulledAt;

  /// Newest first, capped. Local to this device.
  final List<ScratchpadSyncEvent> log;

  ScratchpadNote? noteFor(String userId) => notes[userId];

  ScratchpadBoard copyWith({
    Map<String, ScratchpadNote>? notes,
    DateTime? lastSyncedAt,
    Map<String, DateTime>? pulledAt,
    List<ScratchpadSyncEvent>? log,
  }) {
    return ScratchpadBoard(
      notes: notes ?? this.notes,
      lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
      pulledAt: pulledAt ?? this.pulledAt,
      log: log ?? this.log,
    );
  }
}

/// Loads every scratchpad box, re-loads whenever a realtime push says the
/// table changed (via [DataDomain.scratchpad]), and debounces the signed-in
/// user's own edits into `saveMine` writes.
///
/// The write is deliberately debounced to ~1.2s with a [flush] on blur: every
/// save is a realtime message to every connected client, and a box is typed
/// into far more often than the other live tables are touched.
class ScratchpadBoardController extends AsyncNotifier<ScratchpadBoard> {
  Timer? _saveTimer;
  String? _pendingBody;
  final List<ScratchpadSyncEvent> _log = [];

  static const _saveDebounce = Duration(milliseconds: 1200);
  static const _logCap = 40;

  @override
  Future<ScratchpadBoard> build() async {
    // Re-run this whole method when a push announces the table moved. The
    // announcement is already debounced upstream (LiveDataController), so a
    // burst of keystroke-saves across the team is one re-read, not many.
    ref.watch(dataRevisionProvider(DataDomain.scratchpad));
    ref.onDispose(() => _saveTimer?.cancel());

    final repo = ref.watch(scratchpadRepositoryProvider);

    final List<ScratchpadNote> notes;
    try {
      notes = await repo.fetchAll();
    } catch (error) {
      _pushLog('sync failed · $error');
      rethrow;
    }

    final now = DateTime.now();
    _pushLog('pulled ${notes.length} box${notes.length == 1 ? '' : 'es'}');

    return ScratchpadBoard(
      notes: {for (final n in notes) n.userId: n},
      lastSyncedAt: now,
      pulledAt: {for (final n in notes) n.userId: now},
      log: List.unmodifiable(_log),
    );
  }

  void _pushLog(String message) {
    _log.insert(0, ScratchpadSyncEvent(DateTime.now(), message));
    if (_log.length > _logCap) _log.removeRange(_logCap, _log.length);
  }

  void _syncLogIntoState() {
    final current = state.value;
    if (current != null) {
      state = AsyncData(current.copyWith(log: List.unmodifiable(_log)));
    }
  }

  /// Call on every change to the user's own box. Arms the debounced save.
  void edit(String body) {
    _pendingBody = body;
    _saveTimer?.cancel();
    _saveTimer = Timer(_saveDebounce, () => unawaited(_flushSave()));
  }

  /// Send any pending edit now — on focus loss, or when leaving the page.
  Future<void> flush() async {
    _saveTimer?.cancel();
    _saveTimer = null;
    await _flushSave();
  }

  Future<void> _flushSave() async {
    _saveTimer = null;
    final body = _pendingBody;
    if (body == null) return;
    _pendingBody = null;

    final repo = ref.read(scratchpadRepositoryProvider);
    try {
      await repo.saveMine(body);
      _pushLog('saved · ${body.length} chars');
    } catch (error) {
      _pendingBody ??= body; // let a later flush retry the last text
      _pushLog('save failed · $error');
    }
    _syncLogIntoState();
  }
}

final scratchpadBoardControllerProvider =
    AsyncNotifierProvider<ScratchpadBoardController, ScratchpadBoard>(
  ScratchpadBoardController.new,
);
