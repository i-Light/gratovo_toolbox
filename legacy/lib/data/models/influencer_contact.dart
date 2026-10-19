/// How a channel can actually be reached.
///
/// A channel routinely has more than one of these and no single "the" address:
/// a business email in the About tab, a manager's email that answers faster, a
/// WhatsApp number given in a first call, an Instagram handle that is the only
/// thing they read. A single `email` column on `channels` would force whoever
/// found the second one to overwrite the first, so this is a list from the
/// start.
enum ContactMethod {
  email,
  whatsapp,
  phone,
  instagram,
  telegram,
  twitter,
  discord,
  other;

  /// The wire value stored in the `contacts` JSON. Equal to [name] for every
  /// member — spelled out as its own getter so a later rename in Dart is a
  /// compile-time decision about the stored value rather than a silent
  /// migration.
  String get wire => name;

  static ContactMethod fromWire(String? value) {
    if (value == null) return ContactMethod.other;
    for (final method in ContactMethod.values) {
      if (method.name == value) return method;
    }
    return ContactMethod.other;
  }
}

/// One way to reach a channel.
class InfluencerContact {
  const InfluencerContact({
    required this.method,
    required this.value,
    this.label,
    this.isPrimary = false,
  });

  final ContactMethod method;

  /// The address/handle/number itself, exactly as it should be used. Never
  /// normalised or reformatted on the way in: a WhatsApp number written with
  /// the country code the way the creator gave it is more useful than a
  /// "cleaned" version that drops a leading zero someone actually needs.
  final String value;

  /// Whose address this is, when that is not obvious — "manager", "agency",
  /// "personal". Null for the common case of the channel's own contact.
  final String? label;

  /// The one to try first. At most one contact in a list should carry it;
  /// [normalize] is what enforces that rather than trusting every call site.
  final bool isPrimary;

  InfluencerContact copyWith({
    ContactMethod? method,
    String? value,
    String? label,
    bool? isPrimary,
  }) {
    return InfluencerContact(
      method: method ?? this.method,
      value: value ?? this.value,
      label: label ?? this.label,
      isPrimary: isPrimary ?? this.isPrimary,
    );
  }

  Map<String, dynamic> toJson() => {
        'method': method.wire,
        'value': value,
        if (label != null && label!.trim().isNotEmpty) 'label': label!.trim(),
        if (isPrimary) 'primary': true,
      };

  /// Tolerant on the way in, like every other mapper in this project: a row
  /// written by hand, by an older build, or by an import script that used a
  /// bare string instead of an object still produces a usable contact rather
  /// than taking the profile page down.
  static InfluencerContact? fromJson(Object? raw) {
    if (raw is String) {
      final text = raw.trim();
      if (text.isEmpty) return null;
      return InfluencerContact(method: _guessMethod(text), value: text);
    }
    if (raw is! Map) return null;
    final value = raw['value']?.toString().trim() ?? '';
    if (value.isEmpty) return null;
    final label = raw['label']?.toString().trim();
    return InfluencerContact(
      method: ContactMethod.fromWire(raw['method']?.toString()),
      value: value,
      label: (label == null || label.isEmpty) ? null : label,
      isPrimary: raw['primary'] == true,
    );
  }

  /// Reads a whole `contacts` column, dropping anything unusable.
  static List<InfluencerContact> listFromJson(Object? raw) {
    if (raw is! List) return const [];
    return [
      for (final item in raw)
        if (fromJson(item) case final contact?) contact,
    ];
  }

  /// The two invariants the rest of the app is allowed to assume: no blank
  /// values, and at most one primary.
  ///
  /// Applied on every write rather than on every read, so the stored data is
  /// the thing that is correct. If several are marked primary — two people
  /// each ticking one while offline, say — the first wins, because picking a
  /// deterministic winner is what stops the list from reordering itself
  /// differently on each device.
  static List<InfluencerContact> normalize(List<InfluencerContact> contacts) {
    final result = <InfluencerContact>[];
    var seenPrimary = false;
    for (final contact in contacts) {
      final value = contact.value.trim();
      if (value.isEmpty) continue;
      final keepPrimary = contact.isPrimary && !seenPrimary;
      if (keepPrimary) seenPrimary = true;
      result.add(contact.copyWith(value: value, isPrimary: keepPrimary));
    }
    return result;
  }

  /// A best guess for a contact that arrived as a bare string with no method.
  /// Only the two shapes that are unambiguous are guessed; everything else is
  /// [ContactMethod.other], which is honest rather than wrong.
  static ContactMethod _guessMethod(String value) {
    if (value.contains('@') && value.contains('.') && !value.startsWith('@')) {
      return ContactMethod.email;
    }
    if (RegExp(r'^\+?[\d\s\-()]{7,}$').hasMatch(value)) {
      return ContactMethod.phone;
    }
    return ContactMethod.other;
  }
}
