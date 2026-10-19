/// What a person currently has open for editing.
///
/// Two levels of granularity, both carried in the same object:
///
///   * `type` + `id` — the entity, e.g. the channel `UC8aFE…`. Drives the
///     border around that influencer's row in the list.
///   * `field` — optionally, which control inside it, e.g. `notes`. Drives
///     the border around that one field on the detail page, which is what
///     lets two people work on the same channel without colliding.
class EditingTarget {
  const EditingTarget({required this.type, required this.id, this.field});

  /// 'channel' | 'keyword' | 'deal' | 'brand' | 'thread'
  final String type;
  final String id;
  final String? field;

  /// Key for the entity as a whole, ignoring which field is focused.
  String get entityKey => '$type:$id';

  /// Key including the field, when there is one.
  String get fieldKey => field == null ? entityKey : '$entityKey#$field';

  Map<String, dynamic> toJson() => {
        'type': type,
        'id': id,
        if (field != null) 'field': field,
      };

  static EditingTarget? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final type = raw['type'];
    final id = raw['id'];
    if (type is! String || id is! String || type.isEmpty || id.isEmpty) {
      return null;
    }
    final field = raw['field'];
    return EditingTarget(
      type: type,
      id: id,
      field: field is String && field.isNotEmpty ? field : null,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is EditingTarget &&
      other.type == type &&
      other.id == id &&
      other.field == field;

  @override
  int get hashCode => Object.hash(type, id, field);

  @override
  String toString() => fieldKey;
}

/// A teammate, and what they have open. Built from a presence payload.
class EditingPeer {
  const EditingPeer({
    required this.userId,
    required this.displayName,
    required this.colorHex,
    required this.target,
  });

  final String userId;
  final String displayName;
  final String colorHex;
  final EditingTarget target;
}
