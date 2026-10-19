/// The two independent vocabularies an email record is filed under.
///
/// One table, two kinds, rather than two tables: they are the same shape and
/// the same operations (list, add, rename, delete), and the only thing that
/// differs is which control renders them. A second table would double every
/// query for no gain.
enum EmailTagKind {
  /// Where in the sequence the email sits — "Initial cold outreach",
  /// "follow-up", "closing". A short, slow-growing list, shown as one
  /// horizontal row.
  stage('stage'),

  /// What industry the recipient is in. Open-ended and expected to grow into
  /// the hundreds, which is why its control has a search box.
  niche('niche'),

  /// The `@` placeholders an email body is written against — `@receiver`,
  /// `@brand`. Not a filing vocabulary like the other two: nothing is ever
  /// tagged with one, and no record carries them. They live in this table
  /// because they are a list of labels that has to persist, be unique
  /// case-insensitively, and be addable mid-typing — which is this table's
  /// entire job — and because keeping them in the same file means the corpus
  /// still travels as one `.db`.
  placeholder('placeholder');

  const EmailTagKind(this.storageValue);

  /// What goes in the database. Written out rather than using `name`, so
  /// renaming an enum constant can never silently orphan every stored row.
  final String storageValue;

  static EmailTagKind fromStorage(String value) => EmailTagKind.values
      .firstWhere((kind) => kind.storageValue == value, orElse: () => niche);
}

/// One label in one of the [EmailTagKind] vocabularies.
class EmailTag {
  const EmailTag({
    required this.id,
    required this.kind,
    required this.label,
    this.sortOrder = 0,
  });

  final String id;
  final EmailTagKind kind;

  /// Exactly as it was typed. Matching is case-insensitive (see [labelKey]),
  /// but display never is — "SaaS" is not "saas".
  final String label;

  /// Ties within a kind are broken by this before falling back to the label.
  /// The three seeded stage tags use it to hold sequence order, which is the
  /// order the work happens in and not the order the alphabet is in.
  final int sortOrder;

  /// The value the uniqueness constraint is on: two people typing "Fitness"
  /// and "fitness" a week apart mean the same tag, and a vocabulary that lets
  /// both exist stops being a vocabulary.
  String get labelKey => label.trim().toLowerCase();

  EmailTag copyWith({String? label, int? sortOrder}) => EmailTag(
        id: id,
        kind: kind,
        label: label ?? this.label,
        sortOrder: sortOrder ?? this.sortOrder,
      );

  @override
  bool operator ==(Object other) => other is EmailTag && other.id == id;

  @override
  int get hashCode => id.hashCode;
}

/// Orders a vocabulary for display: [sortOrder] first, then the label,
/// case-insensitively.
///
/// The "normal sort order" the selection controls fall back to for tags that
/// are not currently selected — selected ones are lifted to the front by the
/// control itself, not by this.
int compareEmailTags(EmailTag a, EmailTag b) {
  final byOrder = a.sortOrder.compareTo(b.sortOrder);
  if (byOrder != 0) return byOrder;
  return a.labelKey.compareTo(b.labelKey);
}
