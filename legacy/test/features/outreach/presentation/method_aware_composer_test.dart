import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';
import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/core/native/url_launcher_provider.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/method_aware_composer.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;

import '../../../support/fake_gemini_bridge.dart';

Influencer _influencer(List<InfluencerContact> contacts) => Influencer(
      id: 'ch_1',
      handle: '@channel',
      channelUrl: 'https://youtube.com/@channel',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 1000,
      sourceKeywords: const [],
      vettingStatus: VettingStatus.newlyFound,
      discoveredAt: DateTime.utc(2026),
      contacts: contacts,
    );

OutreachThread _thread({String id = 't_1'}) => OutreachThread(
      id: id,
      influencerId: 'ch_1',
      status: ThreadStatus.awaitingReply,
      updatedAt: DateTime.utc(2026, 8, 1),
    );

const _email = InfluencerContact(
  method: ContactMethod.email,
  value: 'creator@example.com',
);
const _whatsapp = InfluencerContact(
  method: ContactMethod.whatsapp,
  value: '+20 100 000 0000',
);

/// The composer as the thread panel assembles it: the card, and under it the
/// action bar that used to be the card's last row.
Widget _composer({
  String threadId = 't_1',
  OutreachThread? thread,
  required Influencer influencer,
}) {
  final t = thread ?? _thread(id: threadId);
  return Column(
    children: [
      MethodAwareComposer(
        threadId: threadId,
        thread: t,
        influencer: influencer,
      ),
      ComposerActionBar(
        threadId: threadId,
        thread: t,
        influencer: influencer,
      ),
    ],
  );
}

/// A mailbox that can actually send.
const _connectedMailbox = GmailStatus(
  configured: true,
  accounts: [
    GmailAccountStatus(account: 'outreach@gratovo.test', connected: true),
  ],
);

Widget _harness(
  Widget child, {
  MockOutreachRepository? outreach,
  MockReminderRepository? reminders,
  UrlLauncher? launcher,
  GmailStatus? mailbox,
  bool withBridge = false,
}) {
  return ProviderScope(
    overrides: [
      if (withBridge)
        geminiBridgeProvider.overrideWithValue(FakeGeminiBridge()),
      if (mailbox != null)
        gmailStatusProvider.overrideWith((ref) async => mailbox),
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      influencerRepositoryProvider
          .overrideWithValue(MockInfluencerRepository()),
      if (outreach != null)
        outreachRepositoryProvider.overrideWithValue(outreach),
      if (reminders != null)
        reminderRepositoryProvider.overrideWithValue(reminders),
      if (launcher != null) urlLauncherProvider.overrideWithValue(launcher),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: SingleChildScrollView(child: child)),
    ),
  );
}

void main() {
  setUpAll(tzdata.initializeTimeZones);
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('email contact shows a subject line and the mail hand-off',
      (tester) async {
    await tester.pumpWidget(
      _harness(_composer(influencer: _influencer(const [_email]))),
    );
    await tester.pumpAndSettle();

    expect(find.text('Subject'), findsOneWidget);
    expect(find.byTooltip('Open mail app'), findsOneWidget);
    expect(find.byTooltip('Mark as sent'), findsOneWidget);
    expect(find.byTooltip('Copy message'), findsNothing);
    // The header says where this is going instead of naming itself.
    expect(find.textContaining('creator@example.com'), findsOneWidget);
    expect(find.text('Draft a message'), findsNothing);
  });

  testWidgets(
      'no follow-up is armed in the composer, and its alarm button is '
      'gone', (tester) async {
    // Owner's rule, 2026-10-18: every message waits for a person. Follow-ups
    // are reminders in the thread's Follow-ups card (follow_ups_card_test),
    // written and approved when due, never queued behind a send.
    await tester.pumpWidget(
      _harness(
        _composer(influencer: _influencer(const [_email])),
        mailbox: _connectedMailbox,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('Follow-up 1'), findsNothing);
    expect(find.textContaining('days after sending'), findsNothing);
    expect(find.byKey(const Key('composer-schedule-follow-up')), findsNothing);
  });

  // Drafting with Gemini moved to the Comms queue (decision old-files): the
  // composer keeps the copyable brief and nothing that drafts by itself.
  testWidgets(
      'the composer has no Draft with Gemini action, even with the bridge',
      (tester) async {
    await tester.pumpWidget(
      _harness(
        _composer(influencer: _influencer(const [_email])),
        withBridge: true,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byTooltip('Copy brief for AI'), findsOneWidget);
    expect(find.byTooltip('Draft with Gemini'), findsNothing);
    expect(find.byIcon(Icons.auto_fix_high_outlined), findsNothing);
  });

  testWidgets('a WhatsApp-only contact drops the subject and offers copy',
      (tester) async {
    await tester.pumpWidget(
      _harness(_composer(influencer: _influencer(const [_whatsapp]))),
    );
    await tester.pumpAndSettle();

    expect(find.text('Subject'), findsNothing);
    expect(find.byTooltip('Copy message'), findsOneWidget);
    expect(find.byTooltip('Open mail app'), findsNothing);
  });

  testWidgets('Open mail app launches a mailto: URI', (tester) async {
    final launched = <Uri>[];
    await tester.pumpWidget(
      _harness(
        _composer(influencer: _influencer(const [_email])),
        launcher: (uri) async {
          launched.add(uri);
          return true;
        },
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).last, 'Hi there');
    await tester.pump();
    await tester.tap(find.byTooltip('Open mail app'));
    await tester.pump();

    expect(launched, hasLength(1));
    expect(launched.single.scheme, 'mailto');
    expect(launched.single.path, 'creator@example.com');
  });

  testWidgets('Mark as sent records the message', (tester) async {
    final outreach = MockOutreachRepository();
    final thread = await outreach.getOrCreateThreadForInfluencer('ch_1');

    await tester.pumpWidget(
      _harness(
        _composer(
          threadId: thread.id,
          thread: thread,
          influencer: _influencer(const [_email]),
        ),
        outreach: outreach,
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).last, 'A real message');
    await tester.pump();
    await tester.tap(find.byTooltip('Mark as sent'));
    await tester.pumpAndSettle();

    final messages = await outreach.getMessages(thread.id);
    expect(messages, hasLength(1));
    expect(messages.single.body, 'A real message');
  });
}
