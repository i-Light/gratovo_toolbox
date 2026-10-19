import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/follow_ups_card.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/schedule_follow_up_dialog.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;

/// The thread panel's Follow-ups card (owner's note on the workflow map,
/// 2026-10-18): the alarm button back beside the reminders, a countdown on
/// each, and nothing in it that sends by itself.

const _channel = 'ch_card';

Influencer _influencer() => Influencer(
      id: _channel,
      handle: '@card',
      channelUrl: 'https://youtube.com/@card',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 1000,
      sourceKeywords: const [],
      vettingStatus: VettingStatus.newlyFound,
      discoveredAt: DateTime.utc(2026),
      contacts: const [
        InfluencerContact(method: ContactMethod.email, value: 'c@example.com'),
      ],
    );

Widget _harness({
  required MockReminderRepository reminders,
  required MockOutreachRepository outreach,
  required String threadId,
}) {
  return ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      reminderRepositoryProvider.overrideWithValue(reminders),
      outreachRepositoryProvider.overrideWithValue(outreach),
    ],
    child: MaterialApp(
      locale: const Locale('en'),
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: SingleChildScrollView(
          child: FollowUpsCard(influencer: _influencer(), threadId: threadId),
        ),
      ),
    ),
  );
}

FollowUpReminder _reminder(
  String title,
  DateTime dueAt, {
  ReminderKind kind = ReminderKind.followUp,
}) =>
    FollowUpReminder(
      id: '',
      title: title,
      dueAt: dueAt.toUtc(),
      kind: kind,
      influencerId: _channel,
    );

void main() {
  setUpAll(tzdata.initializeTimeZones);
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
      'with nothing due it says so, offers the schedule button, and '
      'says nothing sends by itself', (tester) async {
    final outreach = MockOutreachRepository();
    final thread = await outreach.getOrCreateThreadForInfluencer(_channel);
    await tester.pumpWidget(_harness(
      reminders: MockReminderRepository(),
      outreach: outreach,
      threadId: thread.id,
    ));
    await tester.pumpAndSettle();

    expect(find.text('No follow-up scheduled.'), findsOneWidget);
    expect(find.byKey(const Key('thread-schedule-follow-up')), findsOneWidget);
    expect(
      find.text("Each follow-up is written and approved when it's due. "
          'Nothing is sent by itself.'),
      findsOneWidget,
    );
  });

  testWidgets(
      'each follow-up shows the time left, an overdue one says so, '
      'and a deal deadline is not listed', (tester) async {
    final outreach = MockOutreachRepository();
    final thread = await outreach.getOrCreateThreadForInfluencer(_channel);
    final reminders = MockReminderRepository();
    final now = DateTime.now();
    await reminders.create(_reminder('Follow-up 1 of 3',
        now.add(const Duration(days: 2, hours: 3, minutes: 30))));
    await reminders.create(_reminder('Chase the brief',
        now.subtract(const Duration(days: 1, hours: 5, minutes: 30))));
    await reminders.create(_reminder(
      'Contract due',
      now.add(const Duration(days: 9)),
      kind: ReminderKind.dealDeadline,
    ));

    await tester.pumpWidget(_harness(
      reminders: reminders,
      outreach: outreach,
      threadId: thread.id,
    ));
    await tester.pumpAndSettle();

    expect(find.text('Follow-up 1 of 3'), findsOneWidget);
    expect(find.textContaining('2d 3h left'), findsOneWidget);
    expect(find.text('Chase the brief'), findsOneWidget);
    expect(find.textContaining('1d 5h overdue'), findsOneWidget);
    expect(find.text('Contract due'), findsNothing);
    expect(find.text('No follow-up scheduled.'), findsNothing);
  });

  testWidgets('the alarm button schedules a reminder from the dialog',
      (tester) async {
    final outreach = MockOutreachRepository();
    final thread = await outreach.getOrCreateThreadForInfluencer(_channel);
    final reminders = MockReminderRepository();
    await tester.pumpWidget(_harness(
      reminders: reminders,
      outreach: outreach,
      threadId: thread.id,
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('thread-schedule-follow-up')));
    await tester.pumpAndSettle();
    expect(find.byType(ScheduleFollowUpDialog), findsOneWidget);
    await tester.tap(find.widgetWithText(ChoiceChip, 'Tomorrow'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('follow-up-save')));
    await tester.pumpAndSettle();

    final open = await reminders.getForInfluencer(_channel);
    expect(open.single.kind, ReminderKind.followUp);
    expect(find.text('No follow-up scheduled.'), findsNothing);
    await tester.pump(const Duration(seconds: 5));
  });

  testWidgets(
      'after three follow-ups with no reply it says to wait and start '
      'a new thread', (tester) async {
    final outreach = MockOutreachRepository();
    final thread = await outreach.getOrCreateThreadForInfluencer(_channel);
    final start = DateTime.utc(2026, 10, 5, 10);
    for (var i = 0; i < 4; i++) {
      await outreach.recordMessage(
        threadId: thread.id,
        direction: MessageDirection.outbound,
        subject: 'Message $i',
        body: 'Body $i',
        method: ContactMethod.email,
        at: start.add(Duration(days: 2 * i)),
      );
    }

    await tester.pumpWidget(_harness(
      reminders: MockReminderRepository(),
      outreach: outreach,
      threadId: thread.id,
    ));
    await tester.pumpAndSettle();

    expect(find.textContaining('Three follow-ups sent with no reply'),
        findsOneWidget);
  });
}
