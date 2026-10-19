import 'package:flutter/foundation.dart' show immutable, listEquals;

/// The agency's own facts: one shared row (`agency_settings`, id `agency`)
/// the whole team edits from Settings.
///
/// The drafting engine reads them as a case's `agency`, so [toBody] uses the
/// engine's own keys (`name`, `sender`, `what_we_do`, `true_claims`, …): the
/// claim gate in `pipeline/comms/checks.py` accepts a claim about the agency
/// only when it is among [engineClaims]. Beside them sit the boycott list
/// (house choice HC-09) and the daily target (decision `daily-target`).
///
/// Defaults are the owner's house choices, so an empty row already means what
/// they decided: the incubator line is true (HC-07), Israel is boycotted
/// (HC-09), fifty good emails a day.
@immutable
class AgencySettings {
  const AgencySettings({
    this.name = '',
    this.sender = '',
    this.whatWeDo = '',
    this.website = '',
    this.trueClaims = const [],
    this.pastCampaigns = const [],
    this.incubator = true,
    this.boycottCountries = defaultBoycottCountries,
    this.boycottBrands = const [],
    this.dailyTarget = defaultDailyTarget,
  });

  /// HC-07's true statement, said only as a last resort (FND-ETH-03).
  static const String incubatorClaim =
      'We are part of a group of experienced agency owners who review our work.';

  static const List<String> defaultBoycottCountries = ['IL'];
  static const int defaultDailyTarget = 50;

  final String name;

  /// Who signs the emails.
  final String sender;
  final String whatWeDo;
  final String website;

  /// Facts the engine may rely on, said in its own words and only when they
  /// answer something.
  final List<String> trueClaims;
  final List<String> pastCampaigns;

  /// Whether [incubatorClaim] is true for this agency (HC-07).
  final bool incubator;

  /// ISO-2 country codes, upper-case. A brand from one of these gets no pitch
  /// and no creator (HC-09).
  final List<String> boycottCountries;

  /// Brand names the agency refuses (HC-09).
  final List<String> boycottBrands;

  /// Good emails a day the team aims for, across every mailbox.
  final int dailyTarget;

  /// What the engine's claim gate may accept: the typed-in claims, plus the
  /// incubator line when it is true.
  List<String> get engineClaims =>
      [...trueClaims, if (incubator) incubatorClaim];

  factory AgencySettings.fromBody(Map<String, Object?> body) {
    final boycott = body['boycott'];
    final boycottMap = boycott is Map ? boycott : const {};
    final countries = _lines(boycottMap['countries'])
        .map((code) => code.toUpperCase())
        .toList();
    final target = body['daily_target'];
    final incubator = body['incubator'];
    return AgencySettings(
      name: _text(body['name']),
      sender: _text(body['sender']),
      whatWeDo: _text(body['what_we_do']),
      website: _text(body['website']),
      trueClaims: _lines(body['true_claims']),
      pastCampaigns: _lines(body['past_campaigns']),
      incubator: incubator is! bool || incubator,
      boycottCountries: boycottMap.containsKey('countries')
          ? countries
          : defaultBoycottCountries,
      boycottBrands: _lines(boycottMap['brands']),
      dailyTarget:
          target is num && target > 0 ? target.toInt() : defaultDailyTarget,
    );
  }

  Map<String, Object?> toBody() => {
        'name': name,
        'sender': sender,
        'what_we_do': whatWeDo,
        'website': website,
        'true_claims': trueClaims,
        'past_campaigns': pastCampaigns,
        'incubator': incubator,
        'boycott': {
          'countries': boycottCountries,
          'brands': boycottBrands,
        },
        'daily_target': dailyTarget,
      };

  AgencySettings copyWith({
    String? name,
    String? sender,
    String? whatWeDo,
    String? website,
    List<String>? trueClaims,
    List<String>? pastCampaigns,
    bool? incubator,
    List<String>? boycottCountries,
    List<String>? boycottBrands,
    int? dailyTarget,
  }) =>
      AgencySettings(
        name: name ?? this.name,
        sender: sender ?? this.sender,
        whatWeDo: whatWeDo ?? this.whatWeDo,
        website: website ?? this.website,
        trueClaims: trueClaims ?? this.trueClaims,
        pastCampaigns: pastCampaigns ?? this.pastCampaigns,
        incubator: incubator ?? this.incubator,
        boycottCountries: boycottCountries ?? this.boycottCountries,
        boycottBrands: boycottBrands ?? this.boycottBrands,
        dailyTarget: dailyTarget ?? this.dailyTarget,
      );

  @override
  bool operator ==(Object other) =>
      other is AgencySettings &&
      other.name == name &&
      other.sender == sender &&
      other.whatWeDo == whatWeDo &&
      other.website == website &&
      listEquals(other.trueClaims, trueClaims) &&
      listEquals(other.pastCampaigns, pastCampaigns) &&
      other.incubator == incubator &&
      listEquals(other.boycottCountries, boycottCountries) &&
      listEquals(other.boycottBrands, boycottBrands) &&
      other.dailyTarget == dailyTarget;

  @override
  int get hashCode => Object.hash(
        name,
        sender,
        whatWeDo,
        website,
        Object.hashAll(trueClaims),
        Object.hashAll(pastCampaigns),
        incubator,
        Object.hashAll(boycottCountries),
        Object.hashAll(boycottBrands),
        dailyTarget,
      );
}

String _text(Object? value) => value is String ? value.trim() : '';

/// A JSON list of strings, trimmed, blanks dropped. Anything else is empty.
List<String> _lines(Object? value) => value is List
    ? [
        for (final item in value)
          if (item is String && item.trim().isNotEmpty) item.trim(),
      ]
    : const [];
