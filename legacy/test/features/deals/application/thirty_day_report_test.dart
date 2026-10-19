// The 30-day report (plan step 7): views, CPM achieved, clicks when there is
// a tracking link; as text for an email and as a page to print.
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/time/tz_clock.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/features/deals/application/thirty_day_report.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

final _en = lookupAppLocalizations(const Locale('en'));
late final InstantFormatter _dates;

Deal _deal({double price = 3000, String? trackingLink}) => Deal(
      id: 'deal_1',
      brandId: 'brand_1',
      influencerId: 'UC_sam',
      stage: DealStage.live,
      brandPrice: price,
      influencerPayout: 2000,
      currency: 'USD',
      trackingLink: trackingLink,
      createdAt: DateTime.utc(2026, 9),
      updatedAt: DateTime.utc(2026, 9),
    );

Deliverable _video({int views = 60000, int? clicks}) => Deliverable(
      id: 'del_1',
      dealId: 'deal_1',
      type: DeliverableType.integration,
      status: DeliverableStatus.published,
      publishedUrl: 'https://youtu.be/dQw4w9WgXcQ',
      publishedAt: DateTime.utc(2026, 10, 1),
      reportViews: views,
      reportViewsAt: DateTime.utc(2026, 10, 31),
      reportClicks: clicks,
      createdAt: DateTime.utc(2026, 9),
      updatedAt: DateTime.utc(2026, 9),
    );

ThirtyDayReport _report({
  Deal? deal,
  Deliverable? video,
  int deliverables = 1,
  String brand = 'Notion AI',
}) =>
    ThirtyDayReport.of(
      deal: deal ?? _deal(),
      deliverable: video ?? _video(),
      deliverableCount: deliverables,
      creator: '@sam',
      brand: brand,
    );

void main() {
  setUpAll(() async {
    tzdata.initializeTimeZones();
    await initializeDateFormatting();
    _dates = InstantFormatter(locale: 'en', clock: TzClock(tz.UTC));
  });

  test('CPM achieved is the price per thousand views', () {
    expect(_report().cpm, 50);
  });

  test('with several deliverables, each gets an even share of the price', () {
    final report = _report(deliverables: 3);

    expect(report.price, 1000);
    expect(report.cpm, closeTo(16.67, 0.01));
  });

  test('no views means no CPM rather than a division by zero', () {
    expect(_report(video: _video(views: 0)).cpm, isNull);
  });

  test('the email text has the views, the CPM and the video', () {
    final text = _report().text(_en, _dates);

    expect(text, contains('@sam'));
    expect(text, contains('Notion AI'));
    expect(text, contains('https://youtu.be/dQw4w9WgXcQ'));
    expect(text, contains('60,000'));
    expect(text, contains(r'$50.00'));
    expect(text, isNot(contains('Clicks')));
  });

  test('clicks appear only when the deal has a tracking link', () {
    final withLink = _report(
      deal: _deal(trackingLink: 'https://bit.ly/x'),
      video: _video(clicks: 420),
    ).text(_en, _dates);
    final withoutLink = _report(video: _video(clicks: 420)).text(_en, _dates);

    expect(withLink, contains('420'));
    expect(withoutLink, isNot(contains('420')));
  });

  test('the page is a whole HTML document and escapes what people typed', () {
    final html = _report(brand: '<script>alert(1)</script>').html(_en, _dates);

    expect(html, startsWith('<!doctype html>'));
    expect(html, isNot(contains('<script>')));
    expect(html, contains('&lt;script&gt;'));
    expect(html, contains('60,000'));
  });
}
