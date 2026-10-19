// The agency's own facts (agency_settings, one shared row): what the drafting
// engine may say about the agency, the boycott list and the daily target.
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/agency_settings.dart';

void main() {
  test('an empty row carries the owner\'s house choices as defaults', () {
    final settings = AgencySettings.fromBody(const {});

    expect(settings.name, '');
    expect(settings.trueClaims, isEmpty);
    expect(settings.incubator, isTrue, reason: 'HC-07 picked "incubator"');
    expect(settings.boycottCountries, ['IL'], reason: 'HC-09');
    expect(settings.boycottBrands, isEmpty);
    expect(settings.dailyTarget, 50, reason: 'decision daily-target');
  });

  test('the body uses the keys the engine reads from a case\'s "agency"', () {
    const settings = AgencySettings(
      name: 'Gratovo',
      sender: 'Moustafa',
      whatWeDo: 'We find sponsors for AI YouTube creators.',
      website: 'https://gratovo.com',
      trueClaims: ['We are a small agency.'],
      pastCampaigns: ['Notion x @aiexplained'],
      incubator: false,
      boycottCountries: ['IL'],
      boycottBrands: ['Wix'],
      dailyTarget: 40,
    );

    final body = settings.toBody();
    expect(body, {
      'name': 'Gratovo',
      'sender': 'Moustafa',
      'what_we_do': 'We find sponsors for AI YouTube creators.',
      'website': 'https://gratovo.com',
      'true_claims': ['We are a small agency.'],
      'past_campaigns': ['Notion x @aiexplained'],
      'incubator': false,
      'boycott': {
        'countries': ['IL'],
        'brands': ['Wix'],
      },
      'daily_target': 40,
    });
    expect(AgencySettings.fromBody(body), settings);
  });

  test('the incubator line joins the true claims only when it is true', () {
    const off = AgencySettings(trueClaims: ['We are small.'], incubator: false);
    const on = AgencySettings(trueClaims: ['We are small.'], incubator: true);

    expect(off.engineClaims, ['We are small.']);
    expect(on.engineClaims, ['We are small.', AgencySettings.incubatorClaim]);
  });

  test('a malformed body degrades to the defaults instead of throwing', () {
    final settings = AgencySettings.fromBody(const {
      'true_claims': 'not a list',
      'boycott': ['wrong shape'],
      'daily_target': 'fifty',
      'incubator': 'yes',
    });

    expect(settings.trueClaims, isEmpty);
    expect(settings.boycottCountries, ['IL']);
    expect(settings.dailyTarget, 50);
    expect(settings.incubator, isTrue);
  });

  test('blank lines and stray spaces are dropped from lists', () {
    final settings = AgencySettings.fromBody(const {
      'true_claims': ['  We are small.  ', '', '   '],
      'boycott': {
        'countries': [' il ', ''],
        'brands': [' Wix ', ''],
      },
    });

    expect(settings.trueClaims, ['We are small.']);
    expect(settings.boycottCountries, ['IL'],
        reason: 'country codes are upper-case ISO-2');
    expect(settings.boycottBrands, ['Wix']);
  });
}
