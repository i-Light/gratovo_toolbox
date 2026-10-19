// The Outreach page: its conversation rows lay out whatever they carry, and
// its view menu opens the Comms queue (plan step 6).
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_agency_settings_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_comms_proposal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/outreach_screen.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/comms_queue_page.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_gemini_bridge.dart';
import '../../../support/fake_gmail_gateway.dart';

Future<void> _pump(WidgetTester tester,
    {AccessLevel access = AccessLevel.full}) async {
  tester.view.physicalSize = const Size(1400, 1000);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(const SupabaseBoot(
        config: SupabaseConfig(url: '', anonKey: ''),
        error: 'no server configured in this test',
      )),
      accessLevelProvider.overrideWithValue(access),
      geminiBridgeProvider.overrideWithValue(FakeGeminiBridge()),
      gmailGatewayProvider.overrideWithValue(FakeGmailGateway()),
      commsProposalRepositoryProvider
          .overrideWithValue(MockCommsProposalRepository()),
      outreachRepositoryProvider.overrideWithValue(MockOutreachRepository()),
      influencerRepositoryProvider
          .overrideWithValue(MockInfluencerRepository()),
      agencySettingsRepositoryProvider
          .overrideWithValue(MockAgencySettingsRepository()),
      reminderRepositoryProvider.overrideWithValue(MockReminderRepository()),
    ],
    child: const MaterialApp(
      localizationsDelegates: [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      locale: Locale('en'),
      home: OutreachScreen(),
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('a conversation row with a reply waiting and a reminder lays out',
      (tester) async {
    await _pump(tester);

    expect(tester.takeException(), isNull);
  });

  testWidgets('the view menu opens the Comms queue', (tester) async {
    await _pump(tester);
    expect(find.byType(CommsQueuePage), findsNothing);

    await tester.tap(find.byWidgetPredicate(
        (w) => w is Icon && w.icon == Icons.arrow_drop_down && w.size == null));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Comms queue'));
    await tester.pumpAndSettle();

    expect(find.byType(CommsQueuePage), findsOneWidget);
    expect(find.text('New replies'), findsOneWidget);
  });

  testWidgets('a basic account, which cannot write, has no Comms queue',
      (tester) async {
    await _pump(tester, access: AccessLevel.basic);

    await tester.tap(find.byWidgetPredicate(
        (w) => w is Icon && w.icon == Icons.arrow_drop_down && w.size == null));
    await tester.pumpAndSettle();

    expect(find.text('Comms queue'), findsNothing);
    expect(find.text('Scratchpad'), findsWidgets);
  });
}
