import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_providers.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/sqlite_skills_library_repository.dart';
import 'package:gratovo_toolbox/features/skills/presentation/skills_library_view.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

import '../../../data/repositories/skills_library/memory_skills_db.dart';
import '../../../support/memory_outreach_file_store.dart';

/// The Skills page after the old drafting path went (decision old-files): no
/// Outreach cards tile, and only the keyword generator is a gem to upload.
///
/// Bounded pumps, as in the deck tests, so a hang fails as a hang.
void main() {
  Future<void> pumpPage(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1500, 1100);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final db = MemorySkillsDb();
    addTearDown(db.close);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          skillsLibraryRepositoryProvider
              .overrideWithValue(SqliteSkillsLibraryRepository(db)),
          skillsExportDirProvider.overrideWithValue(null),
          // A folder that still holds the old export.
          outreachFileStoreProvider.overrideWithValue(
            MemoryOutreachFileStore({'cards.json': '{"cards": []}'}),
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
          home: Scaffold(body: SkillsLibraryView()),
        ),
      ),
    );
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  testWidgets('has no Outreach cards tile, even with cards.json in the folder',
      (tester) async {
    await pumpPage(tester);

    expect(find.byKey(const ValueKey('skills-outreach-tile')), findsNothing);
    expect(find.text('Outreach'), findsNothing);
  });

  testWidgets('asks only for the keyword generator gem', (tester) async {
    await pumpPage(tester);

    expect(find.text('Keyword generator'), findsOneWidget);
    expect(find.text('Email drafter'), findsNothing);
    expect(find.text('QA optimizer'), findsNothing);
  });
}
