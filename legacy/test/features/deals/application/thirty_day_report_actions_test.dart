// What the 30-day report's buttons do (plan step 7): take the views snapshot
// once, add clicks, remind to pitch the brand again (HC-19), save the page.
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/url_launcher_provider.dart';
import 'package:gratovo_toolbox/core/native/video_stats_protocol.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_deliverable_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_reminder_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/deals/application/thirty_day_report_actions.dart';
import 'package:gratovo_toolbox/features/deals/application/video_stats_gateway.dart';

class _FakeStats implements VideoStatsGateway {
  _FakeStats(this.answer);

  VideoStatsResult answer;
  final asked = <String>[];

  @override
  Future<VideoStatsResult> fetch(String video) async {
    asked.add(video);
    return answer;
  }
}

class _World {
  _World({VideoStatsResult? answer})
      : stats = _FakeStats(answer ??
            VideoStatsResult(
              videoId: 'dQw4w9WgXcQ',
              views: 61000,
              fetchedAt: DateTime.utc(2026, 10, 31, 9),
            ));

  final _FakeStats stats;
  final deliverables = MockDeliverableRepository();
  final reminders = MockReminderRepository();
  final pages = <String, String>{};
  final opened = <Uri>[];
  late final ProviderContainer container = ProviderContainer(overrides: [
    videoStatsGatewayProvider.overrideWithValue(stats),
    deliverableRepositoryProvider.overrideWithValue(deliverables),
    reminderRepositoryProvider.overrideWithValue(reminders),
    reportPageWriterProvider.overrideWithValue((fileName, html) async {
      pages[fileName] = html;
      return 'C:/data/reports/$fileName';
    }),
    urlLauncherProvider.overrideWithValue((uri) async {
      opened.add(uri);
      return true;
    }),
  ]);

  ThirtyDayReportActions get actions =>
      container.read(thirtyDayReportActionsProvider);

  Future<Deliverable> published(
          {String? url = 'https://youtu.be/dQw4w9WgXcQ'}) =>
      deliverables.create(Deliverable(
        id: '',
        dealId: 'deal_r',
        type: DeliverableType.integration,
        status: DeliverableStatus.published,
        publishedUrl: url,
        publishedAt: DateTime.utc(2026, 10, 1),
        createdAt: DateTime.utc(2026, 9),
        updatedAt: DateTime.utc(2026, 9),
      ));

  Future<Deliverable> reread(String id) async =>
      (await deliverables.getForDeal('deal_r')).firstWhere((d) => d.id == id);
}

Deal _deal() => Deal(
      id: 'deal_r',
      brandId: 'brand_1',
      influencerId: 'UC_sam',
      stage: DealStage.live,
      brandPrice: 3000,
      influencerPayout: 2000,
      createdAt: DateTime.utc(2026, 9),
      updatedAt: DateTime.utc(2026, 9),
    );

void main() {
  test('taking the snapshot reads the views once and keeps them', () async {
    final world = _World();
    addTearDown(world.container.dispose);
    final video = await world.published();

    final error = await world.actions.takeSnapshot(video);

    expect(error, isNull);
    expect(world.stats.asked, ['https://youtu.be/dQw4w9WgXcQ']);
    final stored = await world.reread(video.id);
    expect(stored.reportViews, 61000);
    expect(stored.reportViewsAt, DateTime.utc(2026, 10, 31, 9));

    world.stats.answer = const VideoStatsResult(videoId: 'x', views: 99);
    await world.actions.takeSnapshot(stored);
    expect(world.stats.asked, hasLength(1), reason: 'a snapshot is kept');
  });

  test('no video link: nothing is asked and it says why', () async {
    final world = _World();
    addTearDown(world.container.dispose);
    final video = await world.published(url: null);

    final error = await world.actions.takeSnapshot(video);

    expect(error!.code, 'no_link');
    expect(world.stats.asked, isEmpty);
  });

  test('a refused fetch stores nothing and passes the reason on', () async {
    final world = _World(
        answer: const VideoStatsResult.failure(
            VideoStatsError(code: 'not_found', message: 'gone')));
    addTearDown(world.container.dispose);
    final video = await world.published();

    final error = await world.actions.takeSnapshot(video);

    expect(error!.message, 'gone');
    expect((await world.reread(video.id)).hasReport, isFalse);
  });

  test('clicks are saved beside the snapshot', () async {
    final world = _World();
    addTearDown(world.container.dispose);
    final video = await world.published();
    await world.actions.takeSnapshot(video);

    await world.actions.saveClicks(await world.reread(video.id), 420);

    final stored = await world.reread(video.id);
    expect(stored.reportClicks, 420);
    expect(stored.reportViews, 61000);
  });

  test('good results set a reminder to pitch the brand again', () async {
    final world = _World();
    addTearDown(world.container.dispose);
    final now = DateTime.utc(2026, 10, 31, 12);

    await world.actions.remindPitch(
        deal: _deal(), title: 'Pitch Notion AI its next creator', now: now);

    final reminder = (await world.reminders.getUpcoming())
        .firstWhere((r) => r.title == 'Pitch Notion AI its next creator');
    expect(reminder.dealId, 'deal_r');
    expect(reminder.kind, ReminderKind.custom);
    expect(reminder.dueAt, now.add(const Duration(days: 1)));
  });

  test('the page is saved under a fixed name and opened', () async {
    final world = _World();
    addTearDown(world.container.dispose);
    final video = await world.published();

    final path =
        await world.actions.savePage(deliverable: video, html: '<html></html>');

    expect(path, 'C:/data/reports/30-day-report-${video.id}.html');
    expect(world.pages.keys.single, '30-day-report-${video.id}.html');
    expect(world.opened.single, Uri.file(path!));
  });
}
