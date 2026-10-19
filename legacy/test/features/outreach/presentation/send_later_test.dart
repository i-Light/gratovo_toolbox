import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/localization/locale_provider.dart';
import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/core/notifications/notification_service.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/time/tz_clock.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/models/scheduled_email.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/data/repositories/scheduled_email_store.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_compose_controller.dart';
import 'package:gratovo_toolbox/features/outreach/application/scheduled_send_controller.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/method_aware_composer.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/scheduled_sends.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/send_later_dialog.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

import '../scheduled_send_fakes.dart';

/// "Send later" on screen: the clock button, the time it resolves to, the
/// list on the thread, and the strip that asks about late ones.

const _connectedMailbox = GmailStatus(
  configured: true,
  accounts: [
    GmailAccountStatus(account: 'outreach@gratovo.test', connected: true),
  ],
);

Influencer _influencer() => Influencer(
      id: 'ch_1',
      handle: '@channel',
      channelUrl: 'https://youtube.com/@channel',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 1000,
      sourceKeywords: const [],
      vettingStatus: VettingStatus.newlyFound,
      discoveredAt: DateTime.utc(2026),
      contacts: const [
        InfluencerContact(
          method: ContactMethod.email,
          value: 'creator@example.com',
        ),
      ],
    );

final _thread = OutreachThread(
  id: 't_1',
  influencerId: 'ch_1',
  status: ThreadStatus.awaitingReply,
  updatedAt: DateTime.utc(2026, 8, 1),
);

// 2026-10-01 20:30 UTC is already Friday 2 October, 02:00, in Kolkata.
final _now = DateTime.utc(2026, 10, 1, 20, 30);

ScheduledEmail _queued({
  String threadId = 't_1',
  String influencerId = 'ch_1',
  DateTime? sendAt,
}) =>
    ScheduledEmail(
      id: 'e1',
      threadId: threadId,
      influencerId: influencerId,
      handle: '@channel',
      to: 'creator@example.com',
      subject: 'Collab',
      body: 'Hello there.',
      sendAt: sendAt ?? DateTime.utc(2026, 10, 3, 3, 30),
      createdAt: _now,
    );

ProviderContainer _container({
  required MemoryScheduledEmailStore store,
  FakeKeyedMailbox? mailbox,
  GmailStatus? gmail,
  DateTime? now,
}) {
  final container = ProviderContainer(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      if (gmail != null) gmailStatusProvider.overrideWith((ref) async => gmail),
      gmailGatewayProvider.overrideWithValue(mailbox ?? FakeKeyedMailbox()),
      influencerRepositoryProvider
          .overrideWithValue(MockInfluencerRepository()),
      outreachRepositoryProvider.overrideWithValue(MockOutreachRepository()),
      reminderRepositoryProvider.overrideWithValue(MockReminderRepository()),
      scheduledEmailStoreProvider.overrideWithValue(store),
      scheduledSendClockProvider.overrideWithValue(() => now ?? _now),
      notificationServiceProvider
          .overrideWithValue(const NoopNotificationService()),
      localeProvider.overrideWith(_EnglishLocale.new),
      tzClockProvider
          .overrideWithValue(TzClock(tz.getLocation('Asia/Kolkata'))),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

class _EnglishLocale extends LocaleNotifier {
  @override
  Locale build() => const Locale('en');
}

Widget _app(ProviderContainer container, Widget child) {
  return UncontrolledProviderScope(
    container: container,
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      locale: const Locale('en'),
      home: Scaffold(body: SingleChildScrollView(child: child)),
    ),
  );
}

void _tall(WidgetTester tester) {
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

Widget _composer() => Column(
      children: [
        MethodAwareComposer(
          threadId: 't_1',
          thread: _thread,
          influencer: _influencer(),
        ),
        ComposerActionBar(
          threadId: 't_1',
          thread: _thread,
          influencer: _influencer(),
        ),
      ],
    );

void main() {
  setUpAll(tzdata.initializeTimeZones);
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('the times the presets mean, in the display zone', () {
    late TzClock kolkata;
    setUp(() => kolkata = TzClock(tz.getLocation('Asia/Kolkata')));

    test('tomorrow is tomorrow on the display clock, not the machine\'s', () {
      // Still Thursday in UTC; already Friday in Kolkata. Tomorrow is
      // Saturday, 09:00 there.
      expect(
        resolveSendLater(SendLaterPreset.tomorrowMorning, kolkata,
            nowUtc: _now),
        DateTime.utc(2026, 10, 3, 3, 30),
      );
    });

    test('Monday is the next Monday, never today', () {
      expect(
        resolveSendLater(SendLaterPreset.mondayMorning, kolkata, nowUtc: _now),
        DateTime.utc(2026, 10, 5, 3, 30),
      );
      final mondayMorning = DateTime.utc(2026, 10, 5, 4); // 09:30 Monday there
      expect(
        resolveSendLater(SendLaterPreset.mondayMorning, kolkata,
            nowUtc: mondayMorning),
        DateTime.utc(2026, 10, 12, 3, 30),
      );
    });

    test('a picked time is read on the display clock', () {
      expect(
        resolveSendLater(SendLaterPreset.custom, kolkata,
            nowUtc: _now, customWall: DateTime(2026, 10, 10, 14, 15)),
        DateTime.utc(2026, 10, 10, 8, 45),
      );
    });

    test('in an hour is an hour from now, to the minute', () {
      expect(
        resolveSendLater(SendLaterPreset.inAnHour, kolkata,
            nowUtc: _now.add(const Duration(seconds: 42))),
        DateTime.utc(2026, 10, 1, 21, 30),
      );
    });
  });

  group('in the composer', () {
    testWidgets('no clock without a mailbox that can send', (tester) async {
      _tall(tester);
      final container = _container(store: MemoryScheduledEmailStore());
      await tester.pumpWidget(_app(container, _composer()));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('composer-send-later')), findsNothing);
      // Lets the confirmation toasts run out.
      await tester.pump(const Duration(seconds: 5));
    });

    testWidgets('the clock schedules the draft and lists it on the thread',
        (tester) async {
      _tall(tester);
      final store = MemoryScheduledEmailStore();
      final container = _container(store: store, gmail: _connectedMailbox);
      await tester.pumpWidget(_app(container, _composer()));
      await tester.pumpAndSettle();

      container.read(composeControllerProvider('t_1').notifier)
        ..setSubject('Collab')
        ..setBody('Hello there.');
      await tester.pump();

      await tester.tap(find.byKey(const Key('composer-send-later')));
      await tester.pumpAndSettle();
      // Tomorrow at 09:00 is the default; on the display clock that is
      // Saturday 3 October.
      expect(find.text('3 Oct 2026, 09:00'), findsOneWidget);
      expect(find.text('Times are in Asia/Kolkata.'), findsOneWidget);

      await tester.tap(find.byKey(const Key('send-later-confirm')));
      await tester.pumpAndSettle();

      final saved = store.saved.single;
      expect(saved.sendAt, DateTime.utc(2026, 10, 3, 3, 30));
      expect(saved.body, 'Hello there.');
      expect(container.read(composeControllerProvider('t_1')).body, '');
      expect(find.byKey(const Key('composer-scheduled-sends')), findsOneWidget);
      expect(find.text('Scheduled for 3 Oct 2026, 09:00'), findsOneWidget);
      // Lets the confirmation toasts run out.
      await tester.pump(const Duration(seconds: 5));
    });

    testWidgets(
        'Edit puts it back in the composer; a draft in the way '
        'is not overwritten', (tester) async {
      _tall(tester);
      final store = MemoryScheduledEmailStore([_queued()]);
      final container = _container(store: store, gmail: _connectedMailbox);
      await container.read(scheduledSendProvider.notifier).ensureLoaded();
      await tester.pumpWidget(_app(container, _composer()));
      await tester.pumpAndSettle();

      container
          .read(composeControllerProvider('t_1').notifier)
          .setBody('Something else.');
      await tester.pump();
      await tester.tap(find.byKey(const Key('scheduled-edit')));
      await tester.pumpAndSettle();
      expect(store.saved, hasLength(1), reason: 'the draft would be lost');

      container.read(composeControllerProvider('t_1').notifier).clearDraft();
      await tester.pump();
      await tester.tap(find.byKey(const Key('scheduled-edit')));
      await tester.pumpAndSettle();

      expect(store.saved, isEmpty);
      final state = container.read(composeControllerProvider('t_1'));
      expect(state.subject, 'Collab');
      expect(state.body, 'Hello there.');
      expect(find.byKey(const Key('composer-scheduled-sends')), findsNothing);
      // Lets the confirmation toasts run out.
      await tester.pump(const Duration(seconds: 5));
    });

    testWidgets("Don't send takes it off the thread", (tester) async {
      _tall(tester);
      final store = MemoryScheduledEmailStore([_queued()]);
      final container = _container(store: store, gmail: _connectedMailbox);
      await container.read(scheduledSendProvider.notifier).ensureLoaded();
      await tester.pumpWidget(_app(container, _composer()));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('scheduled-dont-send')));
      await tester.pumpAndSettle();

      expect(store.saved, isEmpty);
      expect(find.byKey(const Key('composer-scheduled-sends')), findsNothing);
      // Lets the confirmation toasts run out.
      await tester.pump(const Duration(seconds: 5));
    });
  });

  testWidgets(
      'a late email raises the strip; Review lists it and Send now '
      'sends it', (tester) async {
    _tall(tester);
    final mailbox = FakeKeyedMailbox();
    // A seeded mock thread and channel, so the send can look them up.
    final store = MemoryScheduledEmailStore([
      _queued(
        threadId: 'thread_002',
        influencerId: 'inf_007',
        sendAt: _now.subtract(const Duration(hours: 5)),
      ),
    ]);
    final container = _container(store: store, mailbox: mailbox);
    await tester
        .pumpWidget(_app(container, const ScheduledSendsAttentionStrip()));
    expect(find.byKey(const Key('scheduled-attention-strip')), findsNothing,
        reason: 'nothing is claimed before the list is read');

    await container.read(scheduledSendProvider.notifier).tick();
    await tester.pumpAndSettle();
    expect(mailbox.calls, 0, reason: 'five hours late: a person decides');
    expect(find.text('1 scheduled email is waiting for a decision'),
        findsOneWidget);

    await tester.tap(find.byKey(const Key('scheduled-attention-review')));
    await tester.pumpAndSettle();
    expect(find.text('Was due 1 Oct 2026, 21:00'), findsOneWidget);

    await tester.tap(find.byKey(const Key('scheduled-send-now')));
    await tester.pumpAndSettle();

    expect(mailbox.delivered, hasLength(1));
    expect(store.saved, isEmpty);
    expect(find.text('Nothing is waiting.'), findsOneWidget);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('scheduled-attention-strip')), findsNothing);
    // Lets the confirmation toasts run out.
    await tester.pump(const Duration(seconds: 5));
  });

  testWidgets('a thread with an email waiting shows a clock on its row',
      (tester) async {
    _tall(tester);
    final container = _container(store: MemoryScheduledEmailStore([_queued()]));
    await container.read(scheduledSendProvider.notifier).ensureLoaded();
    await tester.pumpWidget(_app(
      container,
      const Column(
        children: [
          ScheduledSendChip(threadId: 't_1'),
          ScheduledSendChip(threadId: 't_other'),
        ],
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('thread-scheduled-chip')), findsOneWidget);
    expect(find.text('Sat 3, 09:00'), findsOneWidget);
    // Lets the confirmation toasts run out.
    await tester.pump(const Duration(seconds: 5));
  });
}
