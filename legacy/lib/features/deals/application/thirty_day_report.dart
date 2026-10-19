import 'dart:convert';

import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:intl/intl.dart';

/// One deliverable's results 30 days after it went live (plan step 7): its
/// views (the snapshot taken then), the CPM those views cost the brand, and
/// the tracking link's clicks when the deal has one. Shown in the app, copied
/// into an email, or saved as a page to print.
///
/// A deliverable has no price of its own: it carries an even share of the
/// deal's brand price across the deal's deliverables, and says so.
class ThirtyDayReport {
  const ThirtyDayReport({
    required this.creator,
    required this.brand,
    required this.videoUrl,
    required this.publishedAt,
    required this.views,
    required this.viewsAt,
    required this.price,
    required this.currency,
    this.deliverableCount = 1,
    this.trackingLink,
    this.clicks,
  });

  /// Built from a deliverable whose snapshot was taken ([Deliverable.hasReport]).
  factory ThirtyDayReport.of({
    required Deal deal,
    required Deliverable deliverable,
    required int deliverableCount,
    required String creator,
    required String brand,
  }) {
    final count = deliverableCount < 1 ? 1 : deliverableCount;
    return ThirtyDayReport(
      creator: creator,
      brand: brand,
      videoUrl: deliverable.publishedUrl ?? '',
      publishedAt: deliverable.publishedAt,
      views: deliverable.reportViews ?? 0,
      viewsAt: deliverable.reportViewsAt ?? DateTime.now(),
      price: deal.brandPrice / count,
      currency: deal.currency,
      deliverableCount: count,
      trackingLink: deal.trackingLink,
      clicks: deal.trackingLink == null ? null : deliverable.reportClicks,
    );
  }

  final String creator;
  final String brand;
  final String videoUrl;
  final DateTime? publishedAt;
  final int views;
  final DateTime viewsAt;

  /// This deliverable's share of the deal's brand price.
  final double price;
  final String currency;
  final int deliverableCount;
  final String? trackingLink;
  final int? clicks;

  /// What a thousand views cost the brand; null with no views.
  double? get cpm => views <= 0 ? null : price / views * 1000;

  /// The report's lines, in [l10n]'s language, dates by [dates] (the
  /// display zone's wall clock).
  List<String> lines(AppLocalizations l10n, InstantFormatter dates) {
    final count = NumberFormat.decimalPattern(l10n.localeName);
    final money = NumberFormat.simpleCurrency(
      locale: l10n.localeName,
      name: currency,
    );
    final cpm = this.cpm;
    final priceText = money.format(price);
    return [
      if (videoUrl.isNotEmpty) l10n.reportTextVideo(videoUrl),
      if (publishedAt != null) l10n.reportTextLive(dates.date(publishedAt!)),
      l10n.reportTextViews(dates.date(viewsAt), count.format(views)),
      deliverableCount > 1
          ? l10n.reportTextPriceShare(deliverableCount, priceText)
          : l10n.reportTextPrice(priceText),
      if (cpm != null) l10n.reportTextCpm(money.format(cpm)),
      if (trackingLink != null && clicks != null)
        l10n.reportTextClicks(count.format(clicks)),
    ];
  }

  String heading(AppLocalizations l10n) =>
      l10n.reportTextHeading(creator, brand);

  /// Plain text for an email.
  String text(AppLocalizations l10n, InstantFormatter dates) =>
      [heading(l10n), '', ...lines(l10n, dates)].join('\n');

  /// A whole HTML page to open in a browser and print or save as PDF. Every
  /// value is escaped: names and links are typed by people.
  String html(AppLocalizations l10n, InstantFormatter dates) {
    const escape = HtmlEscape();
    final title = escape.convert(heading(l10n));
    final items = [
      for (final line in lines(l10n, dates)) '<li>${escape.convert(line)}</li>',
    ].join('\n      ');
    final direction = l10n.localeName.startsWith('ar') ? 'rtl' : 'ltr';
    return '''<!doctype html>
<html lang="${escape.convert(l10n.localeName)}" dir="$direction">
  <head>
    <meta charset="utf-8">
    <title>$title</title>
    <style>
      body { font: 16px/1.5 system-ui, sans-serif; color: #111; max-width: 720px;
             margin: 48px auto; padding: 0 24px; }
      h1 { font-size: 22px; margin: 0 0 24px; }
      ul { list-style: none; padding: 0; }
      li { padding: 10px 0; border-bottom: 1px solid #ddd; word-break: break-word; }
      @media print { body { margin: 0 auto; } }
    </style>
  </head>
  <body>
    <h1>$title</h1>
    <ul>
      $items
    </ul>
  </body>
</html>
''';
  }
}
