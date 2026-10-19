import 'package:flutter/foundation.dart' show immutable;

/// Where a brand record came from.
enum BrandSource {
  /// Typed in by a person.
  manual,

  /// Created from "Brands seen sponsoring": found in a creator's videos.
  seenSponsoring;

  static BrandSource fromWire(String? value) => value == 'seenSponsoring'
      ? BrandSource.seenSponsoring
      : BrandSource.manual;
}

/// One person at a brand (HC-25: a brand can have several).
@immutable
class BrandContact {
  const BrandContact({
    this.name = '',
    this.email = '',
    this.role,
    this.isPrimary = false,
  });

  final String name;
  final String email;

  /// "Partnerships", "Marketing manager", … — free text.
  final String? role;
  final bool isPrimary;

  static BrandContact? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final name = raw['name'];
    final email = raw['email'];
    final role = raw['role'];
    final contact = BrandContact(
      name: name is String ? name.trim() : '',
      email: email is String ? email.trim() : '',
      role: role is String && role.trim().isNotEmpty ? role.trim() : null,
      isPrimary: raw['primary'] == true,
    );
    return contact.name.isEmpty && contact.email.isEmpty ? null : contact;
  }

  Map<String, Object?> toJson() => {
        'name': name,
        'email': email,
        if (role != null) 'role': role,
        'primary': isPrimary,
      };

  @override
  bool operator ==(Object other) =>
      other is BrandContact &&
      other.name == name &&
      other.email == email &&
      other.role == role &&
      other.isPrimary == isPrimary;

  @override
  int get hashCode => Object.hash(name, email, role, isPrimary);
}

/// A brand/client the agency represents in a deal (the buy side of a
/// negotiation, as opposed to the influencer, who's the sell side).
class Brand {
  const Brand({
    required this.id,
    required this.name,
    required this.createdAt,
    this.contactName = '',
    this.contactEmail = '',
    this.website,
    this.contactPhone,
    this.budget,
    this.budgetCurrency = 'USD',
    this.campaignBrief,
    this.preferredCriteria = const [],
    this.notes,
    this.category,
    this.country,
    this.contacts = const [],
    this.source = BrandSource.manual,
  });

  final String id;
  final String name;

  /// The single contact every brand had before 1.4. Kept, and kept equal to
  /// the primary entry of [contacts] on every save, because older screens
  /// and older clients read these two.
  final String contactName;
  final String contactEmail;
  final String? contactPhone;
  final String? website;

  /// Campaign budget, in [budgetCurrency].
  final double? budget;
  final String budgetCurrency;

  final String? campaignBrief;

  /// What this brand looks for when the owner is shortlisting influencers
  /// on their behalf (niche, audience geography, minimum subscribers, ...).
  final List<String> preferredCriteria;

  final String? notes;
  final DateTime createdAt;

  /// What the brand sells, e.g. "AI video".
  final String? category;

  /// ISO-2, upper-case. Checked against the boycott list (HC-09).
  final String? country;

  /// Everyone the agency talks to at this brand (HC-25).
  final List<BrandContact> contacts;
  final BrandSource source;

  /// [contacts], or for a brand saved before there were several, its one
  /// contact.
  List<BrandContact> get allContacts {
    if (contacts.isNotEmpty) return contacts;
    if (contactName.isEmpty && contactEmail.isEmpty) return const [];
    return [
      BrandContact(name: contactName, email: contactEmail, isPrimary: true),
    ];
  }

  /// The one to write to first: the contact marked primary, else the first.
  BrandContact? get primaryContact {
    final all = allContacts;
    if (all.isEmpty) return null;
    return all.firstWhere((c) => c.isPrimary, orElse: () => all.first);
  }

  Brand copyWith({
    String? name,
    String? notes,
    String? website,
    double? budget,
    String? budgetCurrency,
    String? campaignBrief,
    List<String>? preferredCriteria,
    String? category,
    String? country,
    List<BrandContact>? contacts,
    BrandSource? source,
  }) {
    return Brand(
      id: id,
      name: name ?? this.name,
      contactName: contactName,
      contactEmail: contactEmail,
      createdAt: createdAt,
      website: website ?? this.website,
      contactPhone: contactPhone,
      budget: budget ?? this.budget,
      budgetCurrency: budgetCurrency ?? this.budgetCurrency,
      campaignBrief: campaignBrief ?? this.campaignBrief,
      preferredCriteria: preferredCriteria ?? this.preferredCriteria,
      notes: notes ?? this.notes,
      category: category ?? this.category,
      country: country ?? this.country,
      contacts: contacts ?? this.contacts,
      source: source ?? this.source,
    );
  }
}
