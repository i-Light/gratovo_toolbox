import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/toast/toast_overlay.dart';
import 'package:gratovo_toolbox/data/models/edit_conflict.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/influencer_profile_screen.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// A repository whose writes all fail, standing in for a server that refused
/// the request or a connection that dropped mid-save.
///
/// Reads are left working on purpose — a repository that could not read either
/// would never render the page far enough to press Save, and would prove
/// nothing about what happens to a failed write.
class _WriteRefusingRepository extends MockInfluencerRepository {
  @override
  Future<EditOutcome> updateNotes(
    String id,
    String notes, {
    required String? base,
  }) async {
    throw Exception('refused');
  }

  @override
  Future<EditOutcome> updateRelevanceCriteria(
    String id,
    List<String> criteria, {
    required List<String> base,
  }) async {
    throw Exception('refused');
  }

  @override
  Future<EditOutcome> updateContacts(
    String id,
    List<InfluencerContact> contacts, {
    required List<InfluencerContact> base,
  }) async {
    throw Exception('refused');
  }

  @override
  Future<EditOutcome> updateProvidedData(
    String id,
    Map<String, dynamic>? data, {
    required Map<String, dynamic>? base,
  }) async {
    throw Exception('refused');
  }

  @override
  Future<EditOutcome> updatePipelineStage(
    String id,
    PipelineStage stage, {
    required PipelineStage base,
  }) async {
    throw Exception('refused');
  }
}

Widget _harness({required bool writesFail}) {
  return ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      influencerRepositoryProvider.overrideWithValue(
        writesFail ? _WriteRefusingRepository() : MockInfluencerRepository(),
      ),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      // Mounted the same way app.dart mounts it, so the save-result toasts
      // these tests assert on actually render.
      builder: (context, child) => ToastOverlay(child: child!),
      home: const InfluencerProfileScreen(influencerId: 'inf_001'),
    ),
  );
}

void _sizeTo(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

/// Types into the notes field and presses Save.
Future<void> _saveNotes(WidgetTester tester, String text) async {
  final field = find.ancestor(
    of: find.text('Notes'),
    matching: find.byType(Card),
  );
  final input = find.descendant(of: field, matching: find.byType(TextField));
  await tester.ensureVisible(input);
  await tester.pumpAndSettle();
  await tester.enterText(input, text);

  final save = find.text('Save notes');
  await tester.ensureVisible(save);
  await tester.pumpAndSettle();
  await tester.tap(save);
  await tester.pumpAndSettle();
}

void main() {
  // The regression this whole phase exists for. `_NotesEditorState._save` used
  // to await the repository with no try at all: a refused write threw into
  // Flutter's zone handler, the success SnackBar never ran, and the typed text
  // stayed in the field. Nothing on screen said the save had failed, so the
  // page reported success for a write that never landed.
  testWidgets('a refused notes save says so instead of failing silently',
      (tester) async {
    _sizeTo(tester, const Size(1200, 3000));
    await tester.pumpWidget(_harness(writesFail: true));
    await tester.pumpAndSettle();

    await _saveNotes(tester, 'something worth not losing');

    expect(find.text("Couldn't save that change."), findsOneWidget);
    expect(find.text('Notes saved.'), findsNothing);
  });

  // The other half of the contract: the text is NOT reverted. It is unsaved,
  // the message says so, and throwing away what someone just typed because the
  // network dropped is the worse of the two wrongs.
  testWidgets('a refused notes save keeps the typed text in the field',
      (tester) async {
    _sizeTo(tester, const Size(1200, 3000));
    await tester.pumpWidget(_harness(writesFail: true));
    await tester.pumpAndSettle();

    await _saveNotes(tester, 'something worth not losing');

    expect(find.text('something worth not losing'), findsOneWidget);
  });

  testWidgets('a successful notes save reports success, not failure',
      (tester) async {
    _sizeTo(tester, const Size(1200, 3000));
    await tester.pumpWidget(_harness(writesFail: false));
    await tester.pumpAndSettle();

    await _saveNotes(tester, 'a note that lands');

    expect(find.text('Notes saved.'), findsOneWidget);
    expect(find.text("Couldn't save that change."), findsNothing);
  });

  // `_commit` in the contacts card was `try`/`finally` with no `catch`: the
  // spinner stopped and the exception went unhandled, so a refused save was
  // signalled only by the ABSENCE of "Contacts saved" — indistinguishable from
  // not having pressed the button.
  testWidgets('a refused contact save reports the failure', (tester) async {
    _sizeTo(tester, const Size(1200, 3000));
    await tester.pumpWidget(_harness(writesFail: true));
    await tester.pumpAndSettle();

    final card = find.ancestor(
      of: find.text('How to reach them'),
      matching: find.byType(Card),
    );
    final value =
        find.descendant(of: card, matching: find.byType(TextField)).first;
    await tester.ensureVisible(value);
    await tester.pumpAndSettle();
    await tester.enterText(value, 'someone@example.com');

    final add = find.descendant(of: card, matching: find.text('Add a contact'));
    await tester.ensureVisible(add);
    await tester.pumpAndSettle();
    await tester.tap(add);
    await tester.pumpAndSettle();

    expect(find.text("Couldn't save that change."), findsOneWidget);
    expect(find.text('Contacts saved'), findsNothing);
  });
}
