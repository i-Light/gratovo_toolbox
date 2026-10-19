import 'package:gratovo_toolbox/data/models/scratchpad_note.dart';
import 'package:gratovo_toolbox/data/repositories/scratchpad_repository.dart';

/// In-memory [ScratchpadRepository] for the backend-unreachable / signed-out
/// state and for widget tests. Seeded with a couple of boxes so the page has
/// its shape — tabs, text, timestamps — without a server.
class MockScratchpadRepository implements ScratchpadRepository {
  MockScratchpadRepository({this.myUserId = 'me'});

  /// Which box [saveMine] writes to, so a test can line it up with the fake
  /// session it installs.
  final String myUserId;

  late final Map<String, ScratchpadNote> _notes = {
    'user-a': ScratchpadNote(
      userId: 'user-a',
      body:
          'Brand shortlist for the Q3 push — waiting on rates from two of them.',
      updatedAt: DateTime.now().toUtc().subtract(const Duration(minutes: 12)),
    ),
    'user-b': ScratchpadNote(
      userId: 'user-b',
      body:
          'Reminder: the creator in Cairo replied, needs a call after 6pm their time.',
      updatedAt: DateTime.now().toUtc().subtract(const Duration(hours: 3)),
    ),
  };

  @override
  Future<List<ScratchpadNote>> fetchAll() async {
    final list = _notes.values.toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return list;
  }

  @override
  Future<void> saveMine(String body) async {
    _notes[myUserId] = ScratchpadNote(
      userId: myUserId,
      body: body,
      updatedAt: DateTime.now().toUtc(),
    );
  }
}
