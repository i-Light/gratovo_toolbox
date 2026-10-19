// Outreach -> Comms queue (plan step 6): four sections, Draft on a click,
// Send / Edit / Redo / Skip, the Steer panel, "N of 50 today".
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/toast/notification_center.dart';
import 'package:gratovo_toolbox/data/models/agency_settings.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_agency_settings_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_comms_proposal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/comms_queue_page.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_gemini_bridge.dart';
import '../../../support/fake_gmail_gateway.dart';

Map<String, Object?> _answer({List<Map<String, Object?>> gates = const []}) => {
      'status': 'ready',
      'proposal': {
        'situation': {'side': 'influencer', 'stage': 'replied'},
        'decision': {
          'action': 'send_message',
          'why': 'Ask their rate before naming ours.',
          'rules': ['INF-PRICE-09'],
        },
        'message': {'subject': 'Re: your test', 'body': 'What do you charge?'},
        'needs_human': [],
      },
      'gates': gates,
      'findings': [],
    };

class _World {
  final bridge = FakeGeminiBridge();
  final gmail = FakeGmailGateway();
  final outreach = MockOutreachRepository();
}

Future<_World> _pump(WidgetTester tester,
    {Size size = const Size(1100, 1800),
    Locale locale = const Locale('en'),
    double textScale = 1,
    ThemeMode themeMode = ThemeMode.light,
    bool foundOnly = false}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final world = _World();
  final influencers = MockInfluencerRepository()
    ..replaceAllForTesting([
      Influencer(
        id: 'UC_sam',
        handle: '@sam',
        channelUrl: '',
        platform: InfluencerPlatform.youtube,
        subscriberCount: 100000,
        sourceKeywords: const [],
        vettingStatus: VettingStatus.newlyFound,
        discoveredAt: DateTime(2026),
        // A found-only creator has no contact a person entered, just an
        // address the pipeline found on the channel.
        contacts: foundOnly
            ? const []
            : const [
                InfluencerContact(
                    method: ContactMethod.email,
                    value: 'sam@sam.tv',
                    isPrimary: true),
              ],
        foundEmails: foundOnly ? const ['press@sam.tv'] : const [],
      ),
    ]);
  final thread = await world.outreach.getOrCreateThreadForInfluencer('UC_sam');
  await world.outreach.recordMessage(
      threadId: thread.id,
      direction: MessageDirection.outbound,
      subject: 'Your test',
      body: 'Hi Sam');
  await world.outreach.recordMessage(
      threadId: thread.id,
      direction: MessageDirection.inbound,
      subject: 'Re: your test',
      body: 'What do you pay?');
  await world.outreach.updateThreadStatus(thread.id, ThreadStatus.replied);
  final agency = MockAgencySettingsRepository();
  await agency.save(const AgencySettings(dailyTarget: 50));

  await tester.pumpWidget(ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(const SupabaseBoot(
        config: SupabaseConfig(url: '', anonKey: ''),
        error: 'no server configured in this test',
      )),
      geminiBridgeProvider.overrideWithValue(world.bridge),
      gmailGatewayProvider.overrideWithValue(world.gmail),
      commsProposalRepositoryProvider
          .overrideWithValue(MockCommsProposalRepository()),
      outreachRepositoryProvider.overrideWithValue(world.outreach),
      influencerRepositoryProvider.overrideWithValue(influencers),
      agencySettingsRepositoryProvider.overrideWithValue(agency),
      reminderRepositoryProvider.overrideWithValue(MockReminderRepository()),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      locale: locale,
      theme: ThemeData.light(),
      darkTheme: ThemeData.dark(),
      themeMode: themeMode,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context)
            .copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: const Scaffold(body: CommsQueuePage()),
    ),
  ));
  await tester.pumpAndSettle();
  return world;
}

List<String> _toasts(WidgetTester tester) => [
      for (final entry in ProviderScope.containerOf(
              tester.element(find.byType(CommsQueuePage)))
          .read(notificationCenterProvider)
          .history)
        entry.message,
    ];

Future<void> _draft(WidgetTester tester) async {
  await tester.tap(find.text('Draft').first);
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('the sections, today\x27s count, and a reply to draft',
      (tester) async {
    await _pump(tester);

    // The setup's own first email went out today.
    expect(find.text('1 of 50 today'), findsOneWidget);
    for (final title in [
      'New replies',
      'Follow-ups due',
      'Decisions',
      'New outreach'
    ]) {
      expect(find.text(title), findsOneWidget);
    }
    expect(find.text('@sam'), findsOneWidget);
    expect(find.textContaining('What do you pay?'), findsOneWidget);
    expect(find.text('Draft'), findsOneWidget);
  });

  testWidgets('a drafted reply shows its why, its lessons and its text',
      (tester) async {
    final world = await _pump(tester);
    world.bridge.answer('action.comms_propose', _answer());

    await _draft(tester);

    expect(find.text('Ask their rate before naming ours.'), findsOneWidget);
    expect(find.text('INF-PRICE-09'), findsOneWidget);
    expect(find.text('What do you charge?'), findsOneWidget);
    for (final action in ['Send', 'Edit', 'Redo', 'Skip']) {
      expect(find.text(action), findsOneWidget);
    }
  });

  // Final review I3: the card shows where it goes before anyone presses Send.
  testWidgets('the card says who it goes to', (tester) async {
    final world = await _pump(tester);
    world.bridge.answer('action.comms_propose', _answer());
    await _draft(tester);

    expect(find.text('To: sam@sam.tv'), findsOneWidget);
    expect(find.textContaining('not been confirmed'), findsNothing);
  });

  testWidgets('an address the search found is flagged as not confirmed',
      (tester) async {
    final world = await _pump(tester, foundOnly: true);
    world.bridge.answer('action.comms_propose', _answer());
    await _draft(tester);

    expect(find.text('To: press@sam.tv'), findsOneWidget);
    expect(find.textContaining('not been confirmed'), findsOneWidget);
    expect(find.byIcon(Icons.warning_amber_outlined), findsOneWidget);
  });

  testWidgets('Send sends it, and says so', (tester) async {
    final world = await _pump(tester);
    world.bridge.answer('action.comms_propose', _answer());
    world.bridge.answer('action.comms_check',
        const {'blocking': false, 'findings': [], 'gates': []});
    await _draft(tester);

    await tester.tap(find.text('Send'));
    await tester.pumpAndSettle();

    expect(world.gmail.sent.single.to, 'sam@sam.tv');
    expect(_toasts(tester), contains('Sent.'));
  });

  testWidgets('a price waits for a person\x27s yes', (tester) async {
    final world = await _pump(tester);
    world.bridge.answer(
        'action.comms_propose',
        _answer(gates: [
          {'what': 'price', 'detail': 'the message names a price'}
        ]));
    world.bridge.answer('action.comms_check',
        const {'blocking': false, 'findings': [], 'gates': []});
    await _draft(tester);

    await tester.tap(find.text('Send'));
    await tester.pumpAndSettle();
    expect(find.text('Confirm before it goes'), findsOneWidget);
    expect(
        find.descendant(
            of: find.byType(AlertDialog),
            matching: find.textContaining('the message names a price')),
        findsOneWidget);
    expect(world.gmail.sent, isEmpty);

    await tester.tap(find.text('Confirm and send'));
    await tester.pumpAndSettle();
    expect(world.gmail.sent, hasLength(1));
  });

  testWidgets('a send that errors says so and frees the card', (tester) async {
    final world = await _pump(tester);
    world.bridge
      ..answer('action.comms_propose', _answer())
      ..failWith('action.comms_check', 'timeout', 'Gemini did not answer');
    await _draft(tester);
    await tester.tap(find.text('Edit'));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.widgetWithText(TextField, 'What do you charge?'), 'Your rate?');

    await tester.tap(find.text('Send'));
    await tester.pumpAndSettle();

    expect(world.gmail.sent, isEmpty);
    expect(find.byType(LinearProgressIndicator), findsNothing);
    expect(_toasts(tester).single, contains('Gemini did not answer'));
  });

  testWidgets('Redo opens the Steer panel and asks again with it',
      (tester) async {
    final world = await _pump(tester);
    world.bridge.answer('action.comms_propose', _answer());
    await _draft(tester);

    await tester.tap(find.text('Redo'));
    await tester.pumpAndSettle();
    expect(find.text('Steer and redo'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('steer-english')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Non-native').last);
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byKey(const ValueKey('steer-note')), 'Keep it short.');
    await tester.tap(find.widgetWithText(FilledButton, 'Redo'));
    await tester.pumpAndSettle();

    final asked = world.bridge.calls
        .lastWhere((c) => c.method == 'action.comms_propose')
        .params['request']! as Map;
    expect(asked['steer'], {'english': 'nonnative', 'note': 'Keep it short.'});
  });

  testWidgets('a refused item says why and cannot be sent', (tester) async {
    final world = await _pump(tester);
    world.bridge.answer('action.comms_propose', const {
      'status': 'blocked',
      'proposal': null,
      'findings': [
        {
          'code': 'HC08_OUT_OF_SCOPE',
          'severity': 'block',
          'rule': 'HC-08',
          'detail': 'the creator is flagged female or couple'
        }
      ],
    });
    await _draft(tester);

    expect(find.textContaining('the creator is flagged female or couple'),
        findsOneWidget);
    expect(find.text('Send'), findsNothing);
    expect(find.text('Skip'), findsOneWidget);
  });

  testWidgets('it lays out on a small phone in Arabic with large text',
      (tester) async {
    final world = await _pump(tester,
        size: const Size(375, 2400),
        locale: const Locale('ar'),
        textScale: 1.6,
        themeMode: ThemeMode.dark,
        // The longest card: the To line and the not-confirmed warning.
        foundOnly: true);
    world.bridge.answer('action.comms_propose', _answer());
    await tester.tap(find.byKey(const ValueKey('comms-draft')).first);
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.warning_amber_outlined), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('drafts keep a readable width on a wide window', (tester) async {
    final world = await _pump(tester, size: const Size(1900, 1400));
    world.bridge.answer('action.comms_propose', _answer());
    await _draft(tester);

    expect(tester.getSize(find.byType(Card).first).width, lessThan(1000));
  });
}
