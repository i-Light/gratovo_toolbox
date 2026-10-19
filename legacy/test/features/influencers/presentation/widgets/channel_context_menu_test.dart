// Right-click on a list row: Shortlist and Add to campaign (fix #10), with
// HC-08's out-of-scope creators refused.
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/toast/notification_center.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_campaign_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_campaign_shortlist_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/channel_context_menu.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

Influencer _channel({
  VettingStatus vetting = VettingStatus.newlyFound,
  CreatorGender? gender,
}) =>
    Influencer(
      id: 'UC_m',
      handle: '@menu',
      channelUrl: '',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 100000,
      sourceKeywords: const [],
      vettingStatus: vetting,
      discoveredAt: DateTime(2026),
      creatorGender: gender,
    );

class _Repos {
  final influencers = MockInfluencerRepository();
  final shortlist = MockCampaignShortlistRepository();
}

Future<_Repos> _pump(WidgetTester tester, Influencer channel) async {
  tester.view.physicalSize = const Size(900, 900);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final repos = _Repos();
  repos.influencers.replaceAllForTesting([channel]);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      influencerRepositoryProvider.overrideWithValue(repos.influencers),
      campaignRepositoryProvider.overrideWithValue(MockCampaignRepository()),
      campaignShortlistRepositoryProvider.overrideWithValue(repos.shortlist),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      locale: const Locale('en'),
      home: Scaffold(
        body: ChannelContextMenu(
          influencer: channel,
          child: const SizedBox(width: 400, height: 60, child: Text('row')),
        ),
      ),
    ),
  ));
  await tester.pumpAndSettle();
  return repos;
}

Future<void> _rightClick(WidgetTester tester) async {
  await tester.tap(find.text('row'), buttons: kSecondaryButton);
  await tester.pumpAndSettle();
}

List<String> _toasts(WidgetTester tester) => [
      for (final entry in ProviderScope.containerOf(
              tester.element(find.byType(ChannelContextMenu)))
          .read(notificationCenterProvider)
          .history)
        entry.message,
    ];

void main() {
  testWidgets('Shortlist puts the channel on the shortlist', (tester) async {
    final repos = await _pump(tester, _channel());

    await _rightClick(tester);
    await tester.tap(find.text('Shortlist'));
    await tester.pumpAndSettle();

    expect((await repos.influencers.getById('UC_m'))!.vettingStatus,
        VettingStatus.shortlisted);
  });

  testWidgets('a shortlisted channel can be taken off it', (tester) async {
    final repos =
        await _pump(tester, _channel(vetting: VettingStatus.shortlisted));

    await _rightClick(tester);
    await tester.tap(find.text('Remove from shortlist'));
    await tester.pumpAndSettle();

    expect((await repos.influencers.getById('UC_m'))!.vettingStatus,
        VettingStatus.newlyFound);
  });

  testWidgets('Add to campaign offers the active campaigns and adds it',
      (tester) async {
    final repos = await _pump(tester, _channel());
    final before =
        (await repos.shortlist.getForCampaign('campaign_001')).length;

    await _rightClick(tester);
    await tester.tap(find.text('Add to campaign'));
    await tester.pumpAndSettle();
    expect(find.text('Template gallery launch'), findsNothing,
        reason: 'a closed campaign takes no new channels');
    await tester.tap(find.text('Spring safe-travel push'));
    await tester.pumpAndSettle();

    final entries = await repos.shortlist.getForCampaign('campaign_001');
    expect(entries.length, before + 1);
    expect(entries.last.channelId, 'UC_m');
    // Not ready to pitch yet: added, with a reminder of what is missing.
    expect(_toasts(tester).first, contains('not ready to pitch'));
  });

  testWidgets('an out-of-scope creator is neither shortlisted nor added',
      (tester) async {
    final repos = await _pump(tester, _channel(gender: CreatorGender.couple));
    final before =
        (await repos.shortlist.getForCampaign('campaign_001')).length;

    await _rightClick(tester);
    await tester.tap(find.text('Shortlist'));
    await tester.pumpAndSettle();
    await _rightClick(tester);
    await tester.tap(find.text('Add to campaign'));
    await tester.pumpAndSettle();

    expect((await repos.influencers.getById('UC_m'))!.vettingStatus,
        VettingStatus.newlyFound);
    expect(
        (await repos.shortlist.getForCampaign('campaign_001')).length, before);
    expect(_toasts(tester), everyElement(contains('Out of scope')));
  });
}
