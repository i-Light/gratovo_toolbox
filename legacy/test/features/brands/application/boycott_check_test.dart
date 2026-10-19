// HC-09: a brand from a boycotted country, or on the boycott list, gets no
// pitch and no creator.
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/agency_settings.dart';
import 'package:gratovo_toolbox/data/models/brand.dart';
import 'package:gratovo_toolbox/features/brands/application/boycott_check.dart';

Brand _brand(String name, {String? country, String? website}) => Brand(
      id: 'b',
      name: name,
      createdAt: DateTime(2026),
      country: country,
      website: website,
    );

const _agency = AgencySettings(boycottBrands: ['Wix', 'Soda Stream']);

void main() {
  test('a brand from a boycotted country', () {
    final hit = boycottHit(_brand('Some Startup', country: 'il'), _agency);
    expect(hit, const BoycottHit(BoycottReason.country, 'IL'));
  });

  test('a brand on the list, however it is written', () {
    expect(boycottHit(_brand('WIX'), _agency)!.reason, BoycottReason.brand);
    expect(boycottHit(_brand('Wix.com Ltd'), _agency)!.value, 'Wix');
    expect(boycottHit(_brand('SodaStream'), _agency)!.value, 'Soda Stream');
  });

  test('a brand known by its website', () {
    final hit = boycottHit(
        _brand('Website Builder Pro', website: 'https://www.wix.com/pricing'),
        _agency);
    expect(hit!.value, 'Wix');
  });

  test('a name that only starts the same is not on the list', () {
    expect(boycottHit(_brand('Wixel Studio'), _agency), isNull);
    expect(boycottHit(_brand('Runway', country: 'US'), _agency), isNull);
  });

  test('no list, no boycott beyond the default country', () {
    expect(boycottHit(_brand('Wix'), const AgencySettings()), isNull);
    expect(boycottHit(_brand('X', country: 'IL'), const AgencySettings()),
        isNotNull);
  });
}
