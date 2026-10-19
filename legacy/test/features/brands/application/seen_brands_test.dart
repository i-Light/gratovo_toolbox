// "Brands seen sponsoring" (fix #6): the brands the pipeline found in
// creators' videos, cleaned of promo codes and the creators' own names.
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/sponsor_sighting.dart';
import 'package:gratovo_toolbox/features/brands/application/seen_brands.dart';

SponsorSighting _s(String id, List<String> brands,
        {String? handle, String? name, DateTime? latest}) =>
    SponsorSighting(
      channelId: id,
      handle: handle ?? '@$id',
      name: name,
      latestUploadAt: latest,
      brands: brands,
    );

void main() {
  test('one entry per brand, counted by channel, most channels first', () {
    final seen = aggregateSeenBrands([
      _s('a', ['Brilliant', 'NordVPN'], latest: DateTime(2026, 9, 1)),
      _s('b', ['Brilliant'], latest: DateTime(2026, 10, 1)),
      _s('c', ['ZocDoc']),
      _s('d', ['Zocdoc']),
      _s('e', ['Zocdoc']),
    ]);

    expect([
      for (final b in seen) (b.name, b.channelIds.length)
    ], [
      ('Zocdoc', 3),
      ('Brilliant', 2),
      ('NordVPN', 1),
    ]);
    expect(seen[1].latestUploadAt, DateTime(2026, 10, 1));
    expect(seen[1].handles, ['@a', '@b']);
  });

  test('promo codes and the creator\x27s own name are not brands', () {
    final seen = aggregateSeenBrands([
      _s('a', ['JR5', 'PRESTON10', 'HOUSEOFEL', 'BUSINESS', 'LG', 'Opera GX']),
      _s('b', ['MKBHD', 'Anker'], handle: '@mkbhd', name: 'Marques Brownlee'),
      _s('c', ['Fireship'], handle: '@Fireship'),
    ]);

    expect([for (final b in seen) b.name]..sort(), ['Anker', 'LG', 'Opera GX']);
  });

  test('nothing seen is an empty list', () {
    expect(aggregateSeenBrands(const []), isEmpty);
  });
}
