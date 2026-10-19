// A creator's media kit (fix #4) and what makes them ready to pitch
// (BRD-PRES-15, HC-27 / INF-QUAL-12), plus the HC-04 gold-mine read and the
// HC-18 pre-screen (INF-QUAL-07).
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/media_kit.dart';

Influencer _creator({
  int subscribers = 200000,
  int? medianViews = 80000,
  MediaKit? kit,
  CreatorGender? gender,
  List<String> foundEmails = const [],
  List<InfluencerContact> contacts = const [],
  double? engagement,
}) =>
    Influencer(
      id: 'UC_x',
      handle: '@x',
      channelUrl: '',
      platform: InfluencerPlatform.youtube,
      subscriberCount: subscribers,
      sourceKeywords: const [],
      vettingStatus: VettingStatus.newlyFound,
      discoveredAt: DateTime(2026),
      medianViewsLast30: medianViews,
      mediaKit: kit,
      creatorGender: gender,
      foundEmails: foundEmails,
      contacts: contacts,
      manualEngagementRate: engagement,
    );

const _fullKit = MediaKit(
  countries: [
    AudienceShare(code: 'US', pct: 18),
    AudienceShare(code: 'IN', pct: 15),
    AudienceShare(code: 'GB', pct: 6),
  ],
  ageBand: '18-34',
  rates: [RateCardRow(format: 'integration', price: 900, agreed: true)],
);

void main() {
  group('MediaKit', () {
    test('round-trips through the JSON the server stores', () {
      final json = _fullKit.toJson();
      expect(json, {
        'countries': [
          {'code': 'US', 'pct': 18},
          {'code': 'IN', 'pct': 15},
          {'code': 'GB', 'pct': 6},
        ],
        'ageBand': '18-34',
        'rates': [
          {'format': 'integration', 'price': 900, 'agreed': true},
        ],
      });
      expect(MediaKit.fromJson(json), _fullKit);
    });

    test('a malformed kit degrades instead of throwing', () {
      final kit = MediaKit.fromJson(const {
        'countries': [
          {'code': 'us', 'pct': '41'},
          'junk',
          {'pct': 3},
        ],
        'rates': 'none',
        'engagement': 'high',
      });
      expect(kit.countries, [const AudienceShare(code: 'US', pct: 41)]);
      expect(kit.rates, isEmpty);
      expect(kit.engagement, isNull);
    });

    test('nothing stored is no kit at all', () {
      expect(MediaKit.tryParse(null), isNull);
      expect(MediaKit.tryParse('not a map'), isNull);
    });
  });

  group('ready to pitch (BRD-PRES-15, HC-27)', () {
    test(
        'analytics, an agreed rate and enough audience in the brand\'s '
        'countries make a creator ready', () {
      final readiness = PitchReadiness.of(_creator(kit: _fullKit));
      // US 18 + GB 6 = 24%: under 30, but tech takes 20%+ (the owner's
      // niche is AI).
      expect(readiness.audienceShare, 24);
      expect(readiness.missing, isEmpty);
      expect(readiness.ready, isTrue);
    });

    test('no kit: analytics and a rate are both missing', () {
      final readiness = PitchReadiness.of(_creator());
      expect(readiness.ready, isFalse);
      expect(readiness.missing,
          containsAll([PitchGap.analytics, PitchGap.agreedRate]));
    });

    test('an asking price is not an agreed rate', () {
      const kit = MediaKit(
        countries: [AudienceShare(code: 'US', pct: 40)],
        ageBand: '18-34',
        rates: [RateCardRow(format: 'integration', price: 900)],
      );
      expect(
          PitchReadiness.of(_creator(kit: kit)).missing, [PitchGap.agreedRate]);
    });

    test('analytics need the age band as well as the countries', () {
      const kit = MediaKit(
        countries: [AudienceShare(code: 'US', pct: 40)],
        rates: [RateCardRow(format: 'integration', price: 900, agreed: true)],
      );
      expect(
          PitchReadiness.of(_creator(kit: kit)).missing, [PitchGap.analytics]);
    });

    test('under 20% in the brand\'s countries is a problem even in tech', () {
      const kit = MediaKit(
        countries: [
          AudienceShare(code: 'US', pct: 9),
          AudienceShare(code: 'IN', pct: 60),
        ],
        ageBand: '18-34',
        rates: [RateCardRow(format: 'integration', price: 900, agreed: true)],
      );
      expect(
          PitchReadiness.of(_creator(kit: kit)).missing, [PitchGap.audience]);
    });

    test('a brand\'s own countries replace the default US, UK and Canada', () {
      final readiness = PitchReadiness.of(_creator(kit: _fullKit),
          brandCountries: const ['IN']);
      expect(readiness.audienceShare, 15);
      expect(readiness.missing, [PitchGap.audience]);
    });

    test('a creator out of scope under HC-08 is never ready', () {
      final female = PitchReadiness.of(
          _creator(kit: _fullKit, gender: CreatorGender.female));
      final couple = PitchReadiness.of(
          _creator(kit: _fullKit, gender: CreatorGender.couple));
      expect(female.missing, [PitchGap.outOfScope]);
      expect(couple.ready, isFalse);
    });
  });

  group('pre-screen (HC-18, INF-QUAL-07)', () {
    test('about 50k average views qualifies, with no size cap', () {
      expect(meetsViewBar(_creator(medianViews: 48000)), isTrue);
      expect(meetsViewBar(_creator(medianViews: 3000000)), isTrue);
      expect(meetsViewBar(_creator(medianViews: 30000)), isFalse);
      expect(meetsViewBar(_creator(medianViews: null)), isFalse);
    });
  });

  group('gold mine (HC-04, INF-MGR-01/05)', () {
    test('no agent, the view bar met and strong views for their size', () {
      expect(isGoldMine(_creator(subscribers: 150000, medianViews: 90000)),
          isTrue);
    });

    test('ordinary views for their size are not exceptional', () {
      expect(isGoldMine(_creator(subscribers: 900000, medianViews: 90000)),
          isFalse);
    });

    test('strong engagement counts as well as views', () {
      expect(
          isGoldMine(
              _creator(subscribers: 900000, medianViews: 90000, engagement: 8)),
          isTrue);
    });

    test('an agency address means they have an agent', () {
      expect(
          isGoldMine(_creator(
              subscribers: 150000,
              medianViews: 90000,
              foundEmails: const ['jo@talentmgmt.com'])),
          isFalse);
      expect(
          isGoldMine(_creator(
              subscribers: 150000,
              medianViews: 90000,
              contacts: const [
                InfluencerContact(
                    method: ContactMethod.email,
                    value: 'deals@bigagency.io',
                    label: 'manager'),
              ])),
          isFalse);
    });

    test('below the view bar is never a gold mine', () {
      expect(isGoldMine(_creator(subscribers: 40000, medianViews: 30000)),
          isFalse);
    });
  });
}
