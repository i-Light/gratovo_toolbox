/// "Blank means absent": the one reading of an optional text field the whole
/// app uses, so a name typed as three spaces and a name never typed at all
/// come out the same.
extension TrimmedOrNull on String? {
  /// `null` for a null or whitespace-only string, otherwise the string with
  /// its surrounding whitespace removed.
  String? get trimmedOrNull {
    final text = this?.trim();
    return text == null || text.isEmpty ? null : text;
  }
}
