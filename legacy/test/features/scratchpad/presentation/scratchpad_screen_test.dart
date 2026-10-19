import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/scratchpad_note.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/data/repositories/scratchpad_repository.dart';
import 'package:gratovo_toolbox/features/scratchpad/presentation/scratchpad_screen.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Records every save so a test can assert the debounced write actually fired.
class _SpyScratchpadRepository implements ScratchpadRepository {
  _SpyScratchpadRepository(this._notes);

  final Map<String, ScratchpadNote> _notes;
  final List<String> savedBodies = [];

  @override
  Future<List<ScratchpadNote>> fetchAll() async {
    final list = _notes.values.toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return list;
  }

  @override
  Future<void> saveMine(String body) async {
    savedBodies.add(body);
    _notes['me-1'] = ScratchpadNote(
      userId: 'me-1',
      body: body,
      updatedAt: DateTime.now().toUtc(),
    );
  }
}

TeamMember _member(String id, String name) => TeamMember(
      id: id,
      displayName: name,
      color: const Color(0xFF3B82F6),
      accessLevel: AccessLevel.full,
    );

Widget _harness(_SpyScratchpadRepository repo) {
  final me = _member('me-1', 'Mona');
  final other = _member('zz-2', 'Zed');
  return ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      scratchpadRepositoryProvider.overrideWithValue(repo),
      currentProfileProvider.overrideWith((ref) async => me),
      teamMembersProvider.overrideWith(
        (ref) async => {me.id: me, other.id: other},
      ),
    ],
    child: const MaterialApp(
      localizationsDelegates: [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: ScratchpadView()),
    ),
  );
}

_SpyScratchpadRepository _seededRepo() => _SpyScratchpadRepository({
      'me-1': ScratchpadNote(
        userId: 'me-1',
        body: 'my starting note',
        updatedAt: DateTime.now().toUtc().subtract(const Duration(minutes: 5)),
      ),
      'zz-2': ScratchpadNote(
        userId: 'zz-2',
        body: 'note from Zed',
        updatedAt: DateTime.now().toUtc().subtract(const Duration(hours: 1)),
      ),
    });

void _sizeTo(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets('one tab per teammate, my own first and marked', (tester) async {
    _sizeTo(tester, const Size(1200, 1600));
    await tester.pumpWidget(_harness(_seededRepo()));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    // My tab carries the "you" marker; the teammate's is a plain name.
    expect(find.text('Mona · you'), findsOneWidget);
    expect(find.text('Zed'), findsWidgets);
  });

  testWidgets('my box is editable and seeded; a teammate box is read-only',
      (tester) async {
    _sizeTo(tester, const Size(1200, 1600));
    await tester.pumpWidget(_harness(_seededRepo()));
    await tester.pumpAndSettle();

    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.controller?.text, 'my starting note');

    // Switch to the teammate's tab.
    await tester.tap(find.text('Zed'));
    await tester.pumpAndSettle();

    expect(find.byType(TextField), findsNothing);
    expect(find.text('note from Zed'), findsOneWidget);
    expect(
      find.text('Read-only. You can only edit your own box.'),
      findsOneWidget,
    );
  });

  testWidgets('shows the two timestamps and the sync log', (tester) async {
    _sizeTo(tester, const Size(1200, 1600));
    await tester.pumpWidget(_harness(_seededRepo()));
    await tester.pumpAndSettle();

    expect(find.text('Last saved'), findsOneWidget);
    expect(find.text('This device last synced'), findsOneWidget);

    await tester.tap(find.text('Sync log (this device)'));
    await tester.pumpAndSettle();
    expect(find.textContaining('pulled '), findsWidgets);
  });

  testWidgets('typing autosaves after the debounce elapses', (tester) async {
    _sizeTo(tester, const Size(1200, 1600));
    final repo = _seededRepo();
    await tester.pumpWidget(_harness(repo));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'edited by the test');
    expect(
        repo.savedBodies, isEmpty); // nothing yet — still within the debounce

    await tester.pump(const Duration(milliseconds: 1300));
    await tester.pumpAndSettle();

    expect(repo.savedBodies, contains('edited by the test'));
  });
}
