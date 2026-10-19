import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/channel_rate_history_entry.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_channel_rate_history_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/rate_history_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

Widget _harness(MockChannelRateHistoryRepository repository, String channelId) {
  return ProviderScope(
    overrides: [
      channelRateHistoryRepositoryProvider.overrideWithValue(repository),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: RateHistoryCard(channelId: channelId)),
    ),
  );
}

void main() {
  testWidgets('shows the empty state for a channel with no closed deals',
      (tester) async {
    final repository = MockChannelRateHistoryRepository();

    await tester.pumpWidget(_harness(repository, 'no_history_channel'));
    await tester.pumpAndSettle();

    expect(find.text('Rate history'), findsOneWidget);
    expect(
      find.text('No closed deals yet for this channel.'),
      findsOneWidget,
    );
  });

  testWidgets(
      "lists a channel's closed-deal rates with brand price, payout, margin "
      'and median views', (tester) async {
    final repository = MockChannelRateHistoryRepository();
    // Seeded by the mock itself under 'UC_sample_channel_1': brandPrice
    // 1200, influencerPayout 900, medianViewsAtDeal 45000.
    await tester.pumpWidget(_harness(repository, 'UC_sample_channel_1'));
    await tester.pumpAndSettle();

    expect(find.text('Rate history'), findsOneWidget);
    expect(find.text('Brand pays'), findsOneWidget);
    expect(find.text('\$1,200'), findsOneWidget);
    expect(find.text('Influencer receives'), findsOneWidget);
    expect(find.text('\$900'), findsOneWidget);
    expect(find.text('Agency margin'), findsOneWidget);
    expect(find.text('\$300'), findsOneWidget);
    expect(find.text('Median views at deal'), findsOneWidget);
    expect(find.text('45K'), findsOneWidget);
  });

  testWidgets('shows "Not measured" when a closed deal has no median views',
      (tester) async {
    final repository = MockChannelRateHistoryRepository();
    await repository.record(
      ChannelRateHistoryEntry(
        id: '',
        channelId: 'chan_unmeasured',
        dealId: 'deal_unmeasured',
        brandPrice: 500,
        influencerPayout: 400,
        closedAt: DateTime.now(),
      ),
    );

    await tester.pumpWidget(_harness(repository, 'chan_unmeasured'));
    await tester.pumpAndSettle();

    expect(find.text('Not measured'), findsOneWidget);
  });
}
