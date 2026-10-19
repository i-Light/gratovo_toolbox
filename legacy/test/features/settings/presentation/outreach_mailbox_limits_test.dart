// The mailbox card's daily cap and warm-up (house choices HC-02, HC-03).
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/core/toast/notification_center.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/settings/application/mailbox_limits_store.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/outreach_mailbox_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

class _RecordingStore implements MailboxLimitsStore {
  final saves = <(String, int, DateTime?)>[];

  @override
  Future<void> save(
    String account, {
    required int dailyCap,
    required DateTime? warmupStartedOn,
  }) async =>
      saves.add((account, dailyCap, warmupStartedOn));
}

GmailStatus _status(GmailLimits? limits) => GmailStatus(
      configured: true,
      accounts: [
        GmailAccountStatus(
          account: 'mailbox@gratovo.test',
          connected: true,
          limits: limits,
        ),
      ],
    );

Future<void> _pump(
  WidgetTester tester,
  GmailStatus status, {
  MailboxLimitsStore? store,
  DateTime? today,
}) async {
  tester.view.physicalSize = const Size(1000, 1600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      gmailStatusProvider.overrideWith((ref) async => status),
      mailboxLimitsStoreProvider.overrideWithValue(store ?? _RecordingStore()),
      mailboxLimitsClockProvider
          .overrideWithValue(() => today ?? DateTime(2026, 10, 10)),
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
      home: Scaffold(
        body: SingleChildScrollView(
          child: OutreachMailboxCard(
            titleColors: LinearGradient(colors: [Colors.white, Colors.white]),
          ),
        ),
      ),
    ),
  ));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Outreach mailbox'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a mailbox shows its cap, what is left today and its warm-up',
      (tester) async {
    await _pump(
      tester,
      _status(GmailLimits(
        dailyCap: 35,
        sentToday: 12,
        leftToday: 23,
        warmupStartedOn: DateTime(2026, 10, 1),
      )),
    );

    expect(find.text('35 cold emails a day · 23 left today'), findsOneWidget);
    // Day 9 of the 14-day minimum: said in words, with a warning icon.
    expect(find.text('Warming up: day 9 of at least 14'), findsOneWidget);
    expect(find.byIcon(Icons.local_fire_department_outlined), findsOneWidget);
  });

  testWidgets('a mailbox past the minimum reads as warmed up', (tester) async {
    await _pump(
      tester,
      _status(GmailLimits(
        dailyCap: 20,
        sentToday: 0,
        leftToday: 20,
        warmupStartedOn: DateTime(2026, 9, 1),
      )),
      today: DateTime(2026, 10, 18),
    );

    expect(find.text('Warmed up 47 days'), findsOneWidget);
  });

  testWidgets('a tool that reports no limits shows none', (tester) async {
    await _pump(tester, _status(null));

    expect(find.textContaining('cold emails a day'), findsNothing);
    expect(find.text('Daily cap and warm-up'), findsNothing);
  });

  testWidgets('the cap and warm-up are edited per mailbox and saved',
      (tester) async {
    final store = _RecordingStore();
    await _pump(
      tester,
      _status(const GmailLimits(dailyCap: 35, sentToday: 0, leftToday: 35)),
      store: store,
    );
    expect(find.text('Warm-up start not set'), findsOneWidget);

    await tester.tap(find.text('Daily cap and warm-up'));
    await tester.pumpAndSettle();

    expect(find.text('Daily cap and warm-up for mailbox@gratovo.test'),
        findsOneWidget);
    expect(find.text('Cold emails a day: 35'), findsOneWidget);
    final slider = tester.widget<Slider>(find.byType(Slider));
    expect(slider.min, 10);
    expect(slider.max, 50);
    slider.onChanged!(20);
    await tester.pumpAndSettle();
    expect(find.text('Cold emails a day: 20'), findsOneWidget);

    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(store.saves, [('mailbox@gratovo.test', 20, null)]);
    final toasts = ProviderScope.containerOf(
            tester.element(find.byType(OutreachMailboxCard)))
        .read(notificationCenterProvider)
        .history;
    expect(toasts.first.message, 'Saved. The next send uses the new limits.');
  });
}
