import 'package:gratovo_toolbox/data/models/scratchpad_note.dart';

/// The team scratchpad: one shared free-text box per person.
///
/// [fetchAll] returns every box the caller may see (any authorized user sees
/// all of them — the RLS `scratchpads_read` policy). [saveMine] writes the
/// signed-in person's own box and nothing else; the database refuses a write
/// to anyone else's row, so there is no "save someone's box" method to get
/// wrong.
abstract interface class ScratchpadRepository {
  Future<List<ScratchpadNote>> fetchAll();

  /// Upsert the current user's box. Creates the row on first save.
  Future<void> saveMine(String body);
}
