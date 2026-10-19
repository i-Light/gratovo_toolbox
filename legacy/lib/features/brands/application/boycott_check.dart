import 'package:flutter/foundation.dart' show immutable;
import 'package:gratovo_toolbox/data/models/agency_settings.dart';
import 'package:gratovo_toolbox/data/models/brand.dart';

/// Why a brand is boycotted (house choice HC-09).
enum BoycottReason { country, brand }

/// The rule that matched, and the value on the list it matched — the country
/// code or the boycotted brand's name as the list writes it.
@immutable
class BoycottHit {
  const BoycottHit(this.reason, this.value);

  final BoycottReason reason;
  final String value;

  @override
  bool operator ==(Object other) =>
      other is BoycottHit && other.reason == reason && other.value == value;

  @override
  int get hashCode => Object.hash(reason, value);

  @override
  String toString() => 'BoycottHit($reason, $value)';
}

/// HC-09: a brand from a boycotted country, or on the agency's boycott list,
/// gets no pitch and no creator. Null when neither applies.
///
/// Names match whole words, however they are written: "WIX", "Wix.com Ltd"
/// and a website at wix.com are all the listed "Wix"; "SodaStream" is the
/// listed "Soda Stream"; "Wixel" is not "Wix".
BoycottHit? boycottHit(Brand brand, AgencySettings agency) {
  final country = brand.country?.trim().toUpperCase();
  if (country != null && agency.boycottCountries.contains(country)) {
    return BoycottHit(BoycottReason.country, country);
  }
  final keys = _nameKeys(brand);
  for (final listed in agency.boycottBrands) {
    final key = _key(listed);
    if (key.isNotEmpty && keys.contains(key)) {
      return BoycottHit(BoycottReason.brand, listed);
    }
  }
  return null;
}

String _key(String text) =>
    text.toLowerCase().replaceAll(RegExp('[^a-z0-9]'), '');

/// Every way the brand can be named: the whole name, each word, each two
/// adjacent words run together, and its website's name.
Set<String> _nameKeys(Brand brand) {
  final words = [
    for (final word in brand.name.split(RegExp('[^A-Za-z0-9]+')))
      if (word.isNotEmpty) word.toLowerCase(),
  ];
  final keys = <String>{
    _key(brand.name),
    ...words,
    for (var i = 0; i + 1 < words.length; i++) '${words[i]}${words[i + 1]}',
  };
  final host = Uri.tryParse(brand.website ?? '')?.host ?? '';
  final labels = host.split('.')..removeWhere((label) => label.isEmpty);
  if (labels.length >= 2) {
    keys.add(_key(labels[labels.length - 2]));
  }
  return keys..remove('');
}
