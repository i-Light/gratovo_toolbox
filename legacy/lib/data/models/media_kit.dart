import 'package:flutter/foundation.dart' show immutable, listEquals;
import 'package:gratovo_toolbox/data/models/influencer.dart';

/// A creator's media kit, typed in from what they send (fix #4): where their
/// audience is, its main age band, engagement, the kit's link and the rate
/// card. Stored as `channel_state.media_kit` (jsonb), edited like the other
/// channel fields.
@immutable
class MediaKit {
  const MediaKit({
    this.countries = const [],
    this.ageBand,
    this.engagement,
    this.link,
    this.rates = const [],
  });

  /// Top audience countries with their share, largest first.
  final List<AudienceShare> countries;

  /// The main age band, e.g. "18-34".
  final String? ageBand;

  /// Engagement rate, percent.
  final double? engagement;
  final String? link;
  final List<RateCardRow> rates;

  bool get isEmpty =>
      countries.isEmpty &&
      (ageBand ?? '').isEmpty &&
      engagement == null &&
      (link ?? '').isEmpty &&
      rates.isEmpty;

  /// The kit in [raw], or null when there is none (or it is not a map).
  static MediaKit? tryParse(Object? raw) =>
      raw is Map ? MediaKit.fromJson(raw.cast<String, Object?>()) : null;

  factory MediaKit.fromJson(Map<String, Object?> json) {
    final countries = json['countries'];
    final rates = json['rates'];
    final age = json['ageBand'];
    final link = json['link'];
    return MediaKit(
      countries: [
        if (countries is List)
          for (final item in countries)
            if (AudienceShare.tryParse(item) case final share?) share,
      ],
      ageBand: age is String && age.trim().isNotEmpty ? age.trim() : null,
      engagement: _number(json['engagement'])?.toDouble(),
      link: link is String && link.trim().isNotEmpty ? link.trim() : null,
      rates: [
        if (rates is List)
          for (final item in rates)
            if (RateCardRow.tryParse(item) case final row?) row,
      ],
    );
  }

  Map<String, Object?> toJson() => {
        'countries': [for (final share in countries) share.toJson()],
        if (ageBand != null) 'ageBand': ageBand,
        if (engagement != null) 'engagement': engagement,
        if (link != null) 'link': link,
        'rates': [for (final row in rates) row.toJson()],
      };

  @override
  bool operator ==(Object other) =>
      other is MediaKit &&
      listEquals(other.countries, countries) &&
      other.ageBand == ageBand &&
      other.engagement == engagement &&
      other.link == link &&
      listEquals(other.rates, rates);

  @override
  int get hashCode => Object.hash(Object.hashAll(countries), ageBand,
      engagement, link, Object.hashAll(rates));
}

/// One country's share of the audience.
@immutable
class AudienceShare {
  const AudienceShare({required this.code, required this.pct});

  /// ISO-2, upper-case.
  final String code;

  /// Percent of the audience, 0-100.
  final num pct;

  static AudienceShare? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final code = raw['code'];
    final pct = _number(raw['pct']);
    if (code is! String || code.trim().length != 2 || pct == null) return null;
    return AudienceShare(code: code.trim().toUpperCase(), pct: pct);
  }

  Map<String, Object?> toJson() => {'code': code, 'pct': pct};

  @override
  bool operator ==(Object other) =>
      other is AudienceShare && other.code == code && other.pct == pct;

  @override
  int get hashCode => Object.hash(code, pct);
}

/// One line of the rate card. [agreed] marks a price settled with the creator
/// (INF-CLOSE-01: an agreement on the rate by email is enough), as opposed to
/// what their kit asks.
@immutable
class RateCardRow {
  const RateCardRow({
    required this.format,
    required this.price,
    this.agreed = false,
  });

  /// integration, dedicated, short, communityPost or other — the deliverable
  /// types `deliverables.type` uses.
  final String format;

  /// USD.
  final num price;
  final bool agreed;

  static RateCardRow? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final format = raw['format'];
    final price = _number(raw['price']);
    if (format is! String || format.trim().isEmpty || price == null) {
      return null;
    }
    return RateCardRow(
      format: format.trim(),
      price: price,
      agreed: raw['agreed'] == true,
    );
  }

  Map<String, Object?> toJson() =>
      {'format': format, 'price': price, 'agreed': agreed};

  @override
  bool operator ==(Object other) =>
      other is RateCardRow &&
      other.format == format &&
      other.price == price &&
      other.agreed == agreed;

  @override
  int get hashCode => Object.hash(format, price, agreed);
}

num? _number(Object? value) => switch (value) {
      final num n => n,
      final String s => num.tryParse(s.trim()),
      _ => null,
    };

// ---------------------------------------------------------------------------
// Ready to pitch (BRD-PRES-15, HC-27 / INF-QUAL-12)
// ---------------------------------------------------------------------------

/// The countries a brand targets when nobody has said otherwise: US, UK and
/// Canada together (INF-QUAL-12).
const List<String> kDefaultBrandCountries = ['US', 'GB', 'CA'];

/// HC-27: about 30% in the brand's countries is good; in tech 20%+ is fine.
const double kAudienceShareGood = 30;
const double kAudienceShareTech = 20;

/// The agency's niche is AI, which counts as tech for HC-27 (the owner's
/// niche; see the memory note "Owner's niche is AI").
const bool kAgencyNicheIsTech = true;

enum PitchGap {
  /// No audience analytics: top countries and age band (BRD-PRES-15).
  analytics,

  /// No price agreed with the creator (INF-CLOSE-01).
  agreedRate,

  /// Too little of the audience in the brand's countries (HC-27).
  audience,

  /// Female or couple channel: out of scope under HC-08.
  outOfScope,
}

/// Whether a creator may go into a brand pitch, and if not, what is missing.
@immutable
class PitchReadiness {
  const PitchReadiness({required this.missing, this.audienceShare});

  final List<PitchGap> missing;

  /// Percent of the audience in the brand's countries, when the kit says.
  final num? audienceShare;

  bool get ready => missing.isEmpty;

  factory PitchReadiness.of(
    Influencer creator, {
    List<String> brandCountries = kDefaultBrandCountries,
    bool tech = kAgencyNicheIsTech,
  }) {
    if (creator.creatorGender?.outOfScope ?? false) {
      return const PitchReadiness(missing: [PitchGap.outOfScope]);
    }
    final kit = creator.mediaKit ?? const MediaKit();
    final targets = {for (final code in brandCountries) code.toUpperCase()};
    final share = kit.countries.isEmpty
        ? null
        : kit.countries
            .where((c) => targets.contains(c.code))
            .fold<num>(0, (sum, c) => sum + c.pct);
    final threshold = tech ? kAudienceShareTech : kAudienceShareGood;
    return PitchReadiness(
      audienceShare: share,
      missing: [
        if (kit.countries.isEmpty || (kit.ageBand ?? '').isEmpty)
          PitchGap.analytics,
        if (!kit.rates.any((row) => row.agreed)) PitchGap.agreedRate,
        if (share != null && share < threshold) PitchGap.audience,
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Pre-screen (HC-18 / INF-QUAL-07) and gold mine (HC-04 / INF-MGR-01, 05)
// ---------------------------------------------------------------------------

/// HC-18: no size cap, anyone with about 50k average views. "About" lets a
/// channel within a tenth of it through.
const int kViewBar = 50000;
const int _viewBarFloor = 45000;

bool meetsViewBar(Influencer creator) =>
    (creator.medianViewsLast30 ?? 0) >= _viewBarFloor;

/// Views per subscriber that count as strong for a channel's size, and the
/// engagement rate that does — rare on purpose (INF-MGR-01: "very rare").
const double kGoldMineViewsPerSubscriber = 0.3;
const double kGoldMineEngagement = 6;

final RegExp _agencyWords = RegExp(
    'agency|agent|mgmt|management|talent|represent',
    caseSensitive: false);

/// INF-MGR-05: an agent shows in the signature or the address (@agency.com).
bool hasAgent(Influencer creator) {
  final addresses = [
    ...creator.foundEmails,
    for (final contact in creator.contacts) contact.value,
  ];
  if (addresses.any(_agencyWords.hasMatch)) return true;
  return creator.contacts.any((contact) =>
      _agencyWords.hasMatch(contact.label ?? '') ||
      (contact.label ?? '').toLowerCase().contains('manager'));
}

/// HC-04: an unmanaged creator with exceptional potential — no agent, the
/// view bar met, and strong views or engagement for their size. After 2-3
/// deals that prove we deliver, a person may propose exclusive management at
/// 20-40% (about 25% to start).
bool isGoldMine(Influencer creator) {
  if (!meetsViewBar(creator) || hasAgent(creator)) return false;
  final views = creator.medianViewsLast30 ?? 0;
  final subscribers = creator.subscriberCount;
  final strongViews =
      subscribers > 0 && views / subscribers >= kGoldMineViewsPerSubscriber;
  final engagement =
      creator.manualEngagementRate ?? creator.mediaKit?.engagement;
  final strongEngagement =
      engagement != null && engagement >= kGoldMineEngagement;
  return strongViews || strongEngagement;
}
